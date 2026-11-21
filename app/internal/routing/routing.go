package routing

import (
	"context"
	"strings"

	"app.carbonink.desktop/internal/store"
)

// Modes a lookup accepts.
const (
	ModeDriving = "driving"
	ModeTransit = "transit"
	ModeAir     = "air"
)

// Sources a result can come from.
const (
	SourceAMap      = "amap"
	SourceHaversine = "haversine"
)

// KeySetting is the setting row holding the AMap web-service key.
const KeySetting = "routing.amap.apikey"

// Result is one distance lookup.
type Result struct {
	DistanceKM int
	Source     string
	Cached     bool
}

// StoredKey reads the AMap key; missing rows read as "".
func StoredKey(ctx context.Context, db *store.Store) (string, error) {
	value, _, err := db.Setting(ctx, KeySetting)
	return strings.TrimSpace(value), err
}

// SaveKey stores or clears the AMap key.
func SaveKey(ctx context.Context, db *store.Store, value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return db.DeleteSetting(ctx, KeySetting)
	}
	return db.SetSetting(ctx, KeySetting, value)
}

// Lookup resolves mode/origin/destination, preferring the workspace cache.
func Lookup(ctx context.Context, db *store.Store, mode, origin, destination string) (Result, error) {
	mode = strings.TrimSpace(mode)
	origin = strings.TrimSpace(origin)
	destination = strings.TrimSpace(destination)
	if mode != ModeDriving && mode != ModeTransit && mode != ModeAir {
		return Result{}, &Error{Kind: KindAPI, Detail: "unknown mode " + mode}
	}
	if origin == "" || destination == "" {
		return Result{}, &Error{Kind: KindAPI, Detail: "origin and destination are required"}
	}

	if hit, ok, err := db.CachedRoute(ctx, mode, origin, destination); err != nil {
		return Result{}, err
	} else if ok {
		return Result{DistanceKM: hit.DistanceKM, Source: hit.Source, Cached: true}, nil
	}

	if mode == ModeAir {
		km, err := airportDistance(origin, destination)
		if err != nil {
			return Result{}, err
		}
		if err := db.SaveRoute(ctx, mode, origin, destination, km, SourceHaversine); err != nil {
			return Result{}, err
		}
		return Result{DistanceKM: km, Source: SourceHaversine}, nil
	}

	key, err := StoredKey(ctx, db)
	if err != nil {
		return Result{}, err
	}
	if key == "" {
		return Result{}, &Error{Kind: KindKeyMissing}
	}
	km, err := amapDistance(ctx, key, mode, origin, destination)
	if err != nil {
		return Result{}, err
	}
	if err := db.SaveRoute(ctx, mode, origin, destination, km, SourceAMap); err != nil {
		return Result{}, err
	}
	return Result{DistanceKM: km, Source: SourceAMap}, nil
}

// InferMode maps the extraction stage and travel mode onto a lookup mode.
func InferMode(stage, travelMode string) string {
	if stage == "freight" {
		return ModeDriving
	}
	switch travelMode {
	case "air":
		return ModeAir
	case "rail":
		return ModeTransit
	default:
		return ModeDriving
	}
}

// IsKeyError reports whether err is a missing-key failure.
func IsKeyError(err error) bool {
	return KindOf(err) == KindKeyMissing
}

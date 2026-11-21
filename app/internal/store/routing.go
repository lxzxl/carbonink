package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// RoutingHit is one cached distance lookup.
type RoutingHit struct {
	DistanceKM int
	Source     string
}

// CachedRoute reads a distance lookup. Origins and destinations are matched
// case-insensitively after trimming, the same key 1.x wrote.
func (s *Store) CachedRoute(ctx context.Context, mode, origin, destination string) (RoutingHit, bool, error) {
	var hit RoutingHit
	err := s.db.QueryRowContext(ctx, `SELECT distance_km, source FROM routing_cache
		WHERE origin_norm = ? AND destination_norm = ? AND mode = ?`,
		normalizePlace(origin), normalizePlace(destination), mode).
		Scan(&hit.DistanceKM, &hit.Source)
	if errors.Is(err, sql.ErrNoRows) {
		return RoutingHit{}, false, nil
	}
	if err != nil {
		return RoutingHit{}, false, err
	}
	return hit, true, nil
}

// SaveRoute caches a lookup so the same leg never calls AMap twice.
func (s *Store) SaveRoute(ctx context.Context, mode, origin, destination string,
	distanceKM int, source string) error {
	_, err := s.db.ExecContext(ctx, `INSERT OR REPLACE INTO routing_cache
		(origin_norm, destination_norm, mode, distance_km, source, fetched_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		normalizePlace(origin), normalizePlace(destination), mode, distanceKM, source,
		time.Now().UTC().Format(time.RFC3339Nano))
	return err
}

func normalizePlace(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

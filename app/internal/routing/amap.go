package routing

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// AMapBase is the web-service root; tests point it at a local server.
var AMapBase = "https://restapi.amap.com/v3"

// AMapClient is the HTTP client every lookup uses. It is a variable so tests
// can shorten the timeout or inject a transport.
var AMapClient = &http.Client{Timeout: 10 * time.Second}

type amapResponse struct {
	Status   string `json:"status"`
	Info     string `json:"info"`
	Infocode string `json:"infocode"`
	Route    *struct {
		Paths []struct {
			Distance string `json:"distance"`
		} `json:"paths"`
		Transits []struct {
			Distance string `json:"distance"`
		} `json:"transits"`
	} `json:"route"`
}

func amapDistance(ctx context.Context, key, mode, origin, destination string) (int, error) {
	endpoint := "/direction/driving"
	if mode == ModeTransit {
		endpoint = "/direction/transit/integrated"
	}
	query := url.Values{}
	query.Set("origin", origin)
	query.Set("destination", destination)
	query.Set("key", key)
	target := AMapBase + endpoint + "?" + query.Encode()

	var last error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return 0, ctx.Err()
			case <-time.After(time.Duration(200<<(attempt-1)) * time.Millisecond):
			}
		}
		km, err := amapCall(ctx, target, mode)
		if err == nil {
			return km, nil
		}
		last = err
		// Rate limits and unknown routes will not improve on retry.
		if KindOf(err) != KindAPI {
			return 0, err
		}
	}
	return 0, last
}

func amapCall(ctx context.Context, target, mode string) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return 0, err
	}
	res, err := AMapClient.Do(req)
	if err != nil {
		return 0, &Error{Kind: KindAPI, Detail: err.Error()}
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 0, &Error{Kind: KindAPI, Detail: fmt.Sprintf("HTTP %d", res.StatusCode)}
	}
	var body amapResponse
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return 0, &Error{Kind: KindAPI, Detail: "unexpected response shape"}
	}
	if body.Status != "1" {
		switch body.Infocode {
		case "10003", "10004":
			return 0, &Error{Kind: KindRateLimited}
		case "20800":
			return 0, &Error{Kind: KindRouteNotFound}
		}
		return 0, &Error{Kind: KindAPI, Detail: strings.TrimSpace(body.Info)}
	}
	meters := ""
	if body.Route != nil {
		if mode == ModeTransit {
			if len(body.Route.Transits) > 0 {
				meters = body.Route.Transits[0].Distance
			}
		} else if len(body.Route.Paths) > 0 {
			meters = body.Route.Paths[0].Distance
		}
	}
	value, err := strconv.ParseFloat(meters, 64)
	if err != nil || math.IsNaN(value) || value < 0 {
		return 0, &Error{Kind: KindAPI, Detail: "unexpected response shape"}
	}
	return int(math.Round(value / 1000)), nil
}

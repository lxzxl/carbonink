// Package routing resolves the distance between two places for travel and
// freight activities. Air legs use the built-in airport table and a great
// circle distance; road and rail legs ask AMap when the user configured a
// key. Results are cached per workspace, so a repeated leg never pays for a
// second request.
package routing

import "errors"

// ErrorKind says what went wrong, so the UI can show a localized message.
type ErrorKind string

const (
	KindKeyMissing     ErrorKind = "key_missing"
	KindRateLimited    ErrorKind = "rate_limited"
	KindRouteNotFound  ErrorKind = "route_not_found"
	KindAirportUnknown ErrorKind = "airport_unknown"
	KindAPI            ErrorKind = "api"
)

// Error is a routing failure with a stable kind.
type Error struct {
	Kind    ErrorKind
	Airport string
	Detail  string
}

func (e *Error) Error() string {
	switch e.Kind {
	case KindKeyMissing:
		return "AMap API key not configured. Open Settings to set it up."
	case KindRateLimited:
		return "AMap rate limit reached. Try again later."
	case KindRouteNotFound:
		return "AMap could not find a route between these locations."
	case KindAirportUnknown:
		return "Unknown airport: " + e.Airport
	default:
		if e.Detail != "" {
			return "AMap API error: " + e.Detail
		}
		return "AMap API error. Check the address format and try again."
	}
}

// KindOf reports the kind of a routing error, or "" for another error.
func KindOf(err error) ErrorKind {
	var e *Error
	if errors.As(err, &e) {
		return e.Kind
	}
	return ""
}

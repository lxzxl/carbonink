package routing

import (
	_ "embed"
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"sync"
)

//go:embed airports.json
var airportJSON []byte

type airport struct {
	IATA string  `json:"iata"`
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
}

var (
	airportsOnce   sync.Once
	airportsByIATA map[string]airport
	iataPattern    = regexp.MustCompile(`\b[A-Z]{3}\b`)
)

func loadAirports() map[string]airport {
	airportsOnce.Do(func() {
		var rows []airport
		if err := json.Unmarshal(airportJSON, &rows); err != nil {
			airportsByIATA = map[string]airport{}
			return
		}
		airportsByIATA = make(map[string]airport, len(rows))
		for _, row := range rows {
			airportsByIATA[strings.ToUpper(row.IATA)] = row
		}
	})
	return airportsByIATA
}

// AirportCodes returns the IATA codes in table order, for tests and docs.
func AirportCodes() []string {
	loadAirports()
	codes := make([]string, 0, len(airportsByIATA))
	for code := range airportsByIATA {
		codes = append(codes, code)
	}
	return codes
}

func airportDistance(origin, destination string) (int, error) {
	from, ok := parseIATA(origin)
	if !ok {
		return 0, &Error{Kind: KindAirportUnknown, Airport: origin}
	}
	to, ok := parseIATA(destination)
	if !ok {
		return 0, &Error{Kind: KindAirportUnknown, Airport: destination}
	}
	a := loadAirports()[from]
	b := loadAirports()[to]
	if a.IATA == "" {
		return 0, &Error{Kind: KindAirportUnknown, Airport: from}
	}
	if b.IATA == "" {
		return 0, &Error{Kind: KindAirportUnknown, Airport: to}
	}
	return haversineKM(a.Lat, a.Lng, b.Lat, b.Lng), nil
}

// parseIATA accepts an airport name or code and returns the first three
// uppercase letters, matching "PEK", "Beijing PEK" and "北京首都国际机场 PEK".
func parseIATA(value string) (string, bool) {
	code := iataPattern.FindString(strings.ToUpper(value))
	return code, code != ""
}

func haversineKM(lat1, lon1, lat2, lon2 float64) int {
	const radius = 6371.0
	toRad := func(deg float64) float64 { return deg * math.Pi / 180 }
	dLat := toRad(lat2 - lat1)
	dLon := toRad(lon2 - lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*math.Sin(dLon/2)*math.Sin(dLon/2)
	return int(math.Round(2 * radius * math.Asin(math.Sqrt(a))))
}

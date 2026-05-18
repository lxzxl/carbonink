#!/usr/bin/env node
// Build script for airports.json. Run with --network when you want the full
// OpenFlights set; otherwise the committed JSON in src/main/services/routing/
// is the runtime data.
//
// Usage:
//   node scripts/build-airports.mjs > src/main/services/routing/airports.json
//
// Source: https://openflights.org/data.html (ODC-BY 1.0)
//
// CSV columns: id, name, city, country, IATA, ICAO, lat, lng, alt, tz_offset, dst, tz_name, type, source

import { writeFileSync } from 'node:fs';

const SOURCE = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat';

const res = await fetch(SOURCE);
const csv = await res.text();
const rows = csv.split('\n').filter(Boolean);

const airports = [];
for (const row of rows) {
  // Naive CSV split — OpenFlights data has quoted-comma values; use a real CSV parser in production.
  const cols = row.match(/(?:[^,"]+|"[^"]*")+/g) ?? [];
  const iata = cols[4]?.replace(/"/g, '');
  if (!iata || iata === '\\N' || iata.length !== 3) continue;
  const lat = Number(cols[6]);
  const lng = Number(cols[7]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  airports.push({
    iata,
    lat: Math.round(lat * 10000) / 10000,
    lng: Math.round(lng * 10000) / 10000,
    city: cols[2]?.replace(/"/g, ''),
    country: cols[3]?.replace(/"/g, ''),
  });
}

writeFileSync(process.stdout.fd, JSON.stringify(airports, null, 2));
console.error(`Wrote ${airports.length} airports`);

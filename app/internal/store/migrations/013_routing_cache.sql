CREATE TABLE routing_cache (
  origin_norm      TEXT NOT NULL,
  destination_norm TEXT NOT NULL,
  mode             TEXT NOT NULL CHECK(mode IN ('driving', 'transit', 'air')),
  distance_km      INTEGER NOT NULL,
  source           TEXT NOT NULL CHECK(source IN ('amap', 'haversine')),
  fetched_at       TEXT NOT NULL,
  PRIMARY KEY (origin_norm, destination_norm, mode)
);

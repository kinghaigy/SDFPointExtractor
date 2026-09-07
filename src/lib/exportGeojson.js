export function buildGeojson(points) {
  const features = points
    .filter((p) => p.lon !== null && p.lat !== null)
    .map((p, idx) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: p.alt !== null && p.alt !== undefined ? [p.lon, p.lat, p.alt] : [p.lon, p.lat],
      },
      properties: {
        id: p.id || `POINT_${idx + 1}`,
        code: p.code ?? null,
        description: p.description ?? null,
        timestamp: p.timestamp ?? null,
        easting: p.easting,
        northing: p.northing,
        source_table: p.sourceTable,
      },
    }));

  return JSON.stringify(
    {
      type: "FeatureCollection",
      features,
    },
    null,
    2,
  );
}

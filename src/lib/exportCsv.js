function esc(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const s = String(value);
  if (s.includes(",") || s.includes("\n") || s.includes("\"")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function toCsv(rows, headers) {
  const out = [headers.join(",")];
  for (const row of rows) {
    out.push(headers.map((h) => esc(row[h])).join(","));
  }
  return `${out.join("\n")}\n`;
}

function cleanName(value, fallback) {
  const ascii = String(value ?? "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/[^A-Za-z0-9 _.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chosen = ascii || fallback;
  return chosen.slice(0, 50);
}

function buildName(point, idx) {
  const fallback = `POINT_${idx + 1}`;
  const raw = point.code || point.id || fallback;
  return cleanName(raw, fallback);
}

function resolveElevation(value, defaultElevation) {
  if (value !== null && value !== undefined && value !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  const d = Number(defaultElevation);
  if (Number.isFinite(d)) {
    return d;
  }
  return 0;
}

export function buildEmlidGlobalCsv(points, options = {}) {
  const defaultElevation = options.defaultElevation ?? 0;
  const headers = ["Name", "Longitude", "Latitude", "Ellipsoidal height"];
  const rows = points
    .filter((p) => p.lon !== null && p.lat !== null)
    .map((p, idx) => ({
      Name: buildName(p, idx),
      Longitude: p.lon,
      Latitude: p.lat,
      "Ellipsoidal height": resolveElevation(p.alt, defaultElevation),
    }));
  return toCsv(rows, headers);
}

export function buildEmlidLocalCsv(points, options = {}) {
  const defaultElevation = options.defaultElevation ?? 0;
  const headers = ["Name", "Easting", "Northing", "Elevation"];
  const rows = points
    .filter((p) => p.easting !== null && p.northing !== null)
    .map((p, idx) => ({
      Name: buildName(p, idx),
      Easting: p.easting,
      Northing: p.northing,
      Elevation: resolveElevation(p.alt, defaultElevation),
    }));
  return toCsv(rows, headers);
}

export function buildBricscadCsv(points) {
  const rows = points
    .filter((p) => p.easting !== null && p.northing !== null)
    .map((p, idx) => ({
      Name: buildName(p, idx),
      E: p.easting,
      N: p.northing,
      Z: p.alt ?? "",
    }));

  const out = rows.map((row) => [row.Name, row.E, row.N, row.Z].map(esc).join(","));
  return `${out.join("\n")}\n`;
}

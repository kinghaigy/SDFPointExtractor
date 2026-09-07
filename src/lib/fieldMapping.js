function normalized(name) {
  return String(name || "").trim().toLowerCase();
}

const FIELD_CANDIDATES = {
  id: ["id", "point_id", "pointid", "name", "number", "pid"],
  code: ["code", "point_code", "pcode", "symbol"],
  description: ["description", "desc", "notes", "comment", "label"],
  timestamp: ["timestamp", "datetime", "created", "time", "obs_time", "date"],
  lat: ["lat", "latitude", "y_lat"],
  lon: ["lon", "lng", "long", "longitude", "x_lon"],
  alt: ["alt", "elev", "elevation", "height", "z"],
  easting: ["easting", "east", "x", "x_coord"],
  northing: ["northing", "north", "y", "y_coord"],
};

function pickColumn(columns, candidates) {
  for (const c of candidates) {
    const exact = columns.find((col) => normalized(col) === c);
    if (exact) {
      return exact;
    }
  }
  for (const c of candidates) {
    const fuzzy = columns.find((col) => normalized(col).includes(c));
    if (fuzzy) {
      return fuzzy;
    }
  }
  return "";
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function inLatRange(v) {
  return v !== null && v >= -90 && v <= 90;
}

function inLonRange(v) {
  return v !== null && v >= -180 && v <= 180;
}

export function autoMapping(columns) {
  return {
    id: pickColumn(columns, FIELD_CANDIDATES.id),
    code: pickColumn(columns, FIELD_CANDIDATES.code),
    description: pickColumn(columns, FIELD_CANDIDATES.description),
    timestamp: pickColumn(columns, FIELD_CANDIDATES.timestamp),
    lat: pickColumn(columns, FIELD_CANDIDATES.lat),
    lon: pickColumn(columns, FIELD_CANDIDATES.lon),
    alt: pickColumn(columns, FIELD_CANDIDATES.alt),
    easting: pickColumn(columns, FIELD_CANDIDATES.easting),
    northing: pickColumn(columns, FIELD_CANDIDATES.northing),
  };
}

function getByColumn(rowObj, columnName) {
  if (!columnName) {
    return null;
  }
  return rowObj[columnName] ?? null;
}

export function toCanonicalPoints(rows, mapping, sourceTable) {
  const canonical = [];
  const dropped = [];

  for (const rowObj of rows) {
    const lat = toNumber(getByColumn(rowObj, mapping.lat));
    const lon = toNumber(getByColumn(rowObj, mapping.lon));
    const easting = toNumber(getByColumn(rowObj, mapping.easting));
    const northing = toNumber(getByColumn(rowObj, mapping.northing));

    const hasWgs84 = inLatRange(lat) && inLonRange(lon);
    const hasProjected = easting !== null && northing !== null;

    if (!hasWgs84 && !hasProjected) {
      dropped.push(rowObj);
      continue;
    }

    canonical.push({
      id: getByColumn(rowObj, mapping.id),
      code: getByColumn(rowObj, mapping.code),
      description: getByColumn(rowObj, mapping.description),
      timestamp: getByColumn(rowObj, mapping.timestamp),
      lat: hasWgs84 ? lat : null,
      lon: hasWgs84 ? lon : null,
      alt: toNumber(getByColumn(rowObj, mapping.alt)),
      easting,
      northing,
      sourceTable,
      raw: rowObj,
    });
  }

  return {
    points: canonical,
    dropped,
  };
}

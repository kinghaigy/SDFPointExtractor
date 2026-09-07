function deg(value) {
  return (value * 180) / Math.PI;
}

export function utmToLatLon(easting, northing, zoneNumber, southernHemisphere = false) {
  if (!Number.isFinite(easting) || !Number.isFinite(northing) || !Number.isFinite(zoneNumber)) {
    return { lat: null, lon: null };
  }

  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);

  let x = easting - 500000.0;
  let y = northing;
  if (southernHemisphere) {
    y -= 10000000.0;
  }

  const m = y / k0;
  const mu =
    m /
    (a *
      (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const j1 = (3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32;
  const j2 = (21 * e1 * e1) / 16 - (55 * Math.pow(e1, 4)) / 32;
  const j3 = (151 * Math.pow(e1, 3)) / 96;
  const j4 = (1097 * Math.pow(e1, 4)) / 512;

  const fp =
    mu +
    j1 * Math.sin(2 * mu) +
    j2 * Math.sin(4 * mu) +
    j3 * Math.sin(6 * mu) +
    j4 * Math.sin(8 * mu);

  const sinFp = Math.sin(fp);
  const cosFp = Math.cos(fp);
  const tanFp = Math.tan(fp);

  const c1 = ep2 * cosFp * cosFp;
  const t1 = tanFp * tanFp;
  const n1 = a / Math.sqrt(1 - e2 * sinFp * sinFp);
  const r1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinFp * sinFp, 1.5);
  const d = x / (n1 * k0);

  const latRad =
    fp -
    ((n1 * tanFp) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * Math.pow(d, 4)) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * Math.pow(d, 6)) /
          720);

  const lonOrigin = ((zoneNumber - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const lonRad =
    lonOrigin +
    (d -
      ((1 + 2 * t1 + c1) * Math.pow(d, 3)) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * Math.pow(d, 5)) / 120) /
      cosFp;

  const lat = deg(latRad);
  const lon = deg(lonRad);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { lat: null, lon: null };
  }

  return { lat, lon };
}

export function parseUtmHint(text) {
  if (!text) {
    return null;
  }

  const m = text.match(/UTM[^0-9]{0,8}(\d{1,2})([NS])/i);
  if (m) {
    return {
      zone: Number(m[1]),
      south: m[2].toUpperCase() === "S",
    };
  }

  const m2 = text.match(/zone\s*(\d{1,2})\s*([NS])/i);
  if (m2) {
    return {
      zone: Number(m2[1]),
      south: m2[2].toUpperCase() === "S",
    };
  }

  return null;
}

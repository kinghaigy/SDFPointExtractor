import { parseUtmHint, utmToLatLon } from "./crs.js";

function readVarint(bytes, offset) {
  let value = 0n;
  for (let i = 0; i < 8; i += 1) {
    const c = bytes[offset + i];
    if (c === undefined) {
      return { ok: false, value: 0n, size: 1 };
    }
    value = (value << 7n) | BigInt(c & 0x7f);
    if ((c & 0x80) === 0) {
      return { ok: true, value, size: i + 1 };
    }
  }
  const c = bytes[offset + 8];
  if (c === undefined) {
    return { ok: false, value: 0n, size: 1 };
  }
  value = (value << 8n) | BigInt(c);
  return { ok: true, value, size: 9 };
}

function decodeMasterRecord(payload) {
  const hdr = readVarint(payload, 0);
  if (!hdr.ok) {
    return null;
  }
  const headerSize = Number(hdr.value);
  if (headerSize < 1 || headerSize > payload.length) {
    return null;
  }

  const serials = [];
  let p = hdr.size;
  while (p < headerSize) {
    const s = readVarint(payload, p);
    if (!s.ok) {
      return null;
    }
    serials.push(Number(s.value));
    p += s.size;
  }

  const out = [];
  let d = headerSize;
  for (const st of serials) {
    let len = 0;
    if (st === 0 || st === 8 || st === 9) {
      len = 0;
    } else if (st === 1) {
      len = 1;
    } else if (st === 2) {
      len = 2;
    } else if (st === 3) {
      len = 3;
    } else if (st === 4) {
      len = 4;
    } else if (st === 5) {
      len = 6;
    } else if (st === 6 || st === 7) {
      len = 8;
    } else if (st >= 12) {
      len = Math.floor((st - 12 - (st % 2)) / 2);
    }

    const chunk = payload.slice(d, d + len);
    d += len;

    if (st >= 13 && st % 2 === 1) {
      out.push(new TextDecoder("utf-8", { fatal: false }).decode(chunk));
    } else if (st === 4 && chunk.length === 4) {
      out.push(new DataView(chunk.buffer, chunk.byteOffset, 4).getInt32(0, false));
    } else {
      out.push(chunk);
    }
  }

  return out;
}

function parseMaster(bytes, pageSize) {
  const pageStart = 0;
  const headerStart = 100;
  const nCell = (bytes[headerStart + 3] << 8) | bytes[headerStart + 4];
  const entries = [];

  for (let i = 0; i < nCell; i += 1) {
    const ptr = (bytes[headerStart + 8 + i * 2] << 8) | bytes[headerStart + 8 + i * 2 + 1];
    let c = pageStart + ptr;
    const payloadVar = readVarint(bytes, c);
    if (!payloadVar.ok) {
      continue;
    }
    c += payloadVar.size;

    const rowidVar = readVarint(bytes, c);
    if (!rowidVar.ok) {
      continue;
    }
    c += rowidVar.size;

    const payloadSize = Number(payloadVar.value);
    const payload = bytes.slice(c, c + payloadSize);
    const rec = decodeMasterRecord(payload);
    if (!rec || rec.length < 5) {
      continue;
    }

    const [type, name, tableName, rootPage, sql] = rec;
    if (typeof type === "string" && typeof name === "string") {
      entries.push({ type, name, tableName, rootPage, sql });
    }
  }

  const dataSurveyPoint = entries.find((e) => e.name === "DATA_SurveyPoint");
  const keySurveyPoint = entries.find((e) => e.name === "KEY_SurveyPoint");
  return {
    entries,
    dataSurveyPointRoot: Number(dataSurveyPoint?.rootPage || 0),
    keySurveyPointRoot: Number(keySurveyPoint?.rootPage || 0),
    pageSize,
  };
}

function pageOffset(page, pageSize) {
  return (page - 1) * pageSize;
}

function pageType(bytes, page, pageSize) {
  return bytes[pageOffset(page, pageSize)];
}

function readLeafRowsRaw(bytes, page, pageSize) {
  const h = pageOffset(page, pageSize);
  const nCell = (bytes[h + 3] << 8) | bytes[h + 4];
  const rows = [];

  for (let i = 0; i < nCell; i += 1) {
    const ptr = (bytes[h + 8 + i * 2] << 8) | bytes[h + 8 + i * 2 + 1];
    let c = pageOffset(page, pageSize) + ptr;

    const payloadVar = readVarint(bytes, c);
    if (!payloadVar.ok) {
      continue;
    }
    c += payloadVar.size;

    const rowidVar = readVarint(bytes, c);
    if (!rowidVar.ok) {
      continue;
    }
    c += rowidVar.size;

    const payloadSize = Number(payloadVar.value);
    const raw = bytes.slice(c, c + payloadSize);
    rows.push({ rowid: Number(rowidVar.value), raw });
  }

  return rows;
}

function walkDataRows(bytes, rootPage, pageSize) {
  if (!rootPage) {
    return [];
  }

  const rows = [];
  const stack = [rootPage];

  while (stack.length) {
    const page = stack.pop();
    if (!page || page < 1) {
      continue;
    }
    const type = pageType(bytes, page, pageSize);
    const h = pageOffset(page, pageSize);

    if (type === 0x0d) {
      rows.push(...readLeafRowsRaw(bytes, page, pageSize));
      continue;
    }

    if (type === 0x05) {
      const nCell = (bytes[h + 3] << 8) | bytes[h + 4];
      const right =
        (bytes[h + 8] << 24) |
        (bytes[h + 9] << 16) |
        (bytes[h + 10] << 8) |
        bytes[h + 11];
      if (right > 0) {
        stack.push(right >>> 0);
      }

      for (let i = 0; i < nCell; i += 1) {
        const ptr = (bytes[h + 12 + i * 2] << 8) | bytes[h + 12 + i * 2 + 1];
        const off = pageOffset(page, pageSize) + ptr;
        const child =
          (bytes[off] << 24) |
          (bytes[off + 1] << 16) |
          (bytes[off + 2] << 8) |
          bytes[off + 3];
        if (child > 0) {
          stack.push(child >>> 0);
        }
      }
    }
  }

  rows.sort((a, b) => a.rowid - b.rowid);
  return rows;
}

function extractPrintableTokens(raw) {
  const text = new TextDecoder("latin1").decode(raw).replace(/[^\x20-\x7e]/g, " ");
  return text
    .split(/\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function choosePointName(tokens) {
  const banned = /(calculated|stake out|user entered point|control point|assistance point)/i;
  const options = tokens.filter((t) => /[A-Za-z]/.test(t) && !banned.test(t));
  if (!options.length) {
    return null;
  }
  options.sort((a, b) => b.length - a.length);
  return options[0];
}

function extractNumericCandidates(raw) {
  const candidates = [];
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i <= raw.byteLength - 8; i += 1) {
    const value = view.getFloat64(i, true);
    if (!Number.isFinite(value) || Math.abs(value) < 1e-10 || Math.abs(value) > 1e8) {
      continue;
    }
    candidates.push({ offset: i, value });
  }
  return candidates;
}

function pickProjected(candidates) {
  const east = candidates.filter((c) => c.value > 100000 && c.value < 900000);
  const north = candidates.filter((c) => c.value > 5000000 && c.value < 9000000);
  if (!east.length || !north.length) {
    return { easting: null, northing: null };
  }

  let best = null;
  for (const e of east) {
    for (const n of north) {
      const gap = Math.abs(n.offset - e.offset);
      if (!best || gap < best.gap) {
        best = { easting: e.value, northing: n.value, gap };
      }
    }
  }
  return best ? { easting: best.easting, northing: best.northing } : { easting: null, northing: null };
}

function pickWgs84(candidates) {
  const latCandidates = candidates.filter((c) => c.value >= -90 && c.value <= 90);
  const lonCandidates = candidates.filter((c) => c.value >= -180 && c.value <= 180);
  let best = null;
  for (const lat of latCandidates) {
    for (const lon of lonCandidates) {
      const gap = Math.abs(lat.offset - lon.offset);
      if (gap > 24) {
        continue;
      }
      if (!best || gap < best.gap) {
        best = { lat: lat.value, lon: lon.value, gap };
      }
    }
  }
  if (!best) {
    return { lat: null, lon: null };
  }
  if (Math.abs(best.lat) < 0.000001 && Math.abs(best.lon) < 0.000001) {
    return { lat: null, lon: null };
  }
  return { lat: best.lat, lon: best.lon };
}

function parseCrsText(bytes) {
  const text = new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.length, 1_400_000)));
  const proj = text.match(/PROJCS\[[^\]]+\]/i)?.[0] || null;
  const utm = parseUtmHint(text);
  return {
    projectionText: proj,
    utm,
  };
}

export function extractAutodeskFdoSurveyPoints(fileBytes) {
  if (!fileBytes || fileBytes.length < 200) {
    return { points: [], warning: "File is too small for Autodesk SDF parsing." };
  }

  const rawPageSize = (fileBytes[16] << 8) | fileBytes[17];
  const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
  if (!pageSize || pageSize < 512) {
    return { points: [], warning: "Could not determine SDF page size." };
  }

  const parsedMaster = parseMaster(fileBytes, pageSize);
  const root = parsedMaster.dataSurveyPointRoot;
  if (!root) {
    return { points: [], warning: "DATA_SurveyPoint table was not found in SDF master schema." };
  }

  const rows = walkDataRows(fileBytes, root, pageSize);
  if (!rows.length) {
    return { points: [], warning: "DATA_SurveyPoint exists but no readable rows were found." };
  }

  const crs = parseCrsText(fileBytes);
  const points = rows.map((row) => {
    const tokens = extractPrintableTokens(row.raw);
    const name = choosePointName(tokens);
    const candidates = extractNumericCandidates(row.raw);
    const projected = pickProjected(candidates);
    const directWgs84 = pickWgs84(candidates);

    let lat = directWgs84.lat;
    let lon = directWgs84.lon;
    if (projected.easting !== null && projected.northing !== null && crs.utm) {
      const converted = utmToLatLon(projected.easting, projected.northing, crs.utm.zone, crs.utm.south);
      lat = converted.lat;
      lon = converted.lon;
    }

    return {
      id: row.rowid,
      code: name,
      description: name,
      timestamp: null,
      lat,
      lon,
      alt: null,
      easting: projected.easting,
      northing: projected.northing,
      sourceTable: "DATA_SurveyPoint",
      raw: {
        tokens: tokens.slice(0, 12),
      },
    };
  });

  const filtered = points.filter((p) => p.easting !== null && p.northing !== null);
  return {
    points: filtered,
    warning: null,
    details: {
      pageSize,
      rootPage: root,
      keyRootPage: parsedMaster.keySurveyPointRoot,
      projectionText: crs.projectionText,
      utm: crs.utm,
      totalRows: rows.length,
      extractedRows: filtered.length,
    },
  };
}

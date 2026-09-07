import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

let sqlPromise;

function getSqlModule() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => (file.endsWith(".wasm") ? wasmUrl : file),
    });
  }
  return sqlPromise;
}

function valueAt(values, rowIdx, colIdx) {
  return values[rowIdx] ? values[rowIdx][colIdx] : null;
}

function normalizeName(name) {
  return String(name || "").toLowerCase();
}

export async function loadSdfFile(file) {
  const SQL = await getSqlModule();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const diagnosis = diagnoseSdfBytes(bytes);
  try {
    const db = new SQL.Database(bytes);
    return { db, diagnosis };
  } catch (err) {
    err.sdfDiagnosis = diagnosis;
    throw err;
  }
}

export function diagnoseSdfBytes(bytes) {
  const header = bytes.slice(0, 16);
  const headerText = new TextDecoder("ascii").decode(header);
  const sqliteHeader = headerText === "SQLite format 3\u0000";

  let pageSize = null;
  if (bytes.length >= 18) {
    const hi = bytes[16];
    const lo = bytes[17];
    const v = (hi << 8) | lo;
    pageSize = v === 1 ? 65536 : v;
  }

  const probeBytes = bytes.slice(0, Math.min(bytes.length, 2 * 1024 * 1024));
  const probeText = new TextDecoder("iso-8859-1").decode(probeBytes);
  const looksLikeAutodeskFdoSurvey =
    probeText.includes("DATA_SurveyPoint") &&
    probeText.includes("KEY_SurveyPoint") &&
    (probeText.includes("CREATE TABLE 'DATA_SurveyPoint'(data blob)") ||
      probeText.includes("RTREE_SurveyPoint"));

  return {
    sqliteHeader,
    pageSize,
    looksLikeAutodeskFdoSurvey,
  };
}

export function queryRows(db, sql) {
  const result = db.exec(sql);
  if (!result.length) {
    return { columns: [], rows: [] };
  }
  return { columns: result[0].columns, rows: result[0].values };
}

export function inspectDatabase(db) {
  const tableRows = queryRows(
    db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
  ).rows;

  const tables = tableRows.map((r) => r[0]);
  const report = [];

  for (const table of tables) {
    const info = queryRows(db, `PRAGMA table_info(\"${table}\");`);
    let rowCount = 0;
    try {
      rowCount = Number(queryRows(db, `SELECT COUNT(*) AS n FROM \"${table}\";`).rows[0][0] || 0);
    } catch (_err) {
      rowCount = 0;
    }
    report.push({
      table,
      rowCount,
      columns: info.rows.map((r) => ({
        cid: r[0],
        name: r[1],
        type: r[2],
        notNull: Boolean(r[3]),
        defaultValue: r[4],
        pk: Boolean(r[5]),
      })),
    });
  }

  return report;
}

export function findCandidateTables(report) {
  const scoreWords = [
    "lat",
    "latitude",
    "lon",
    "long",
    "longitude",
    "x",
    "y",
    "z",
    "east",
    "north",
    "easting",
    "northing",
    "point",
    "coord",
    "height",
    "elev",
    "alt",
  ];

  return report
    .map((entry) => {
      const names = entry.columns.map((c) => normalizeName(c.name));
      let score = 0;
      for (const n of names) {
        for (const w of scoreWords) {
          if (n.includes(w)) {
            score += 1;
          }
        }
      }
      if (entry.rowCount > 0) {
        score += 1;
      }
      return { ...entry, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.rowCount - a.rowCount);
}

export function sampleTable(db, table, limit = 2000) {
  const q = `SELECT * FROM \"${table}\" LIMIT ${Math.max(1, Math.min(limit, 10000))};`;
  return queryRows(db, q);
}

export function detectCrsHints(db) {
  const hints = [];
  const tables = queryRows(
    db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
  ).rows.map((r) => r[0]);

  const crsWords = ["epsg", "srid", "coord", "projection", "wkt", "crs", "datum"];
  for (const table of tables) {
    const cols = queryRows(db, `PRAGMA table_info(\"${table}\");`).rows.map((r) => r[1]);
    const maybe = cols.filter((c) => crsWords.some((w) => normalizeName(c).includes(w)));
    if (!maybe.length) {
      continue;
    }
    const col = maybe[0];
    try {
      const rows = queryRows(db, `SELECT \"${col}\" FROM \"${table}\" WHERE \"${col}\" IS NOT NULL LIMIT 5;`)
        .rows
        .map((r) => r[0]);
      if (rows.length) {
        hints.push({ table, column: col, values: rows });
      }
    } catch (_err) {
      // Ignore lookup failures on exotic column types.
    }
  }
  return hints;
}

export function mapRow(columns, row) {
  const result = {};
  for (let i = 0; i < columns.length; i += 1) {
    result[columns[i]] = valueAt([row], 0, i);
  }
  return result;
}

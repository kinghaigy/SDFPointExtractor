import { useEffect, useMemo, useRef, useState } from "react";
import {
  findCandidateTables,
  inspectDatabase,
  loadSdfFile,
  mapRow,
  sampleTable,
} from "./lib/sdfClient";
import { autoMapping, toCanonicalPoints } from "./lib/fieldMapping";
import { buildBricscadCsv, buildEmlidGlobalCsv, buildEmlidLocalCsv } from "./lib/exportCsv";
import { buildGeojson } from "./lib/exportGeojson";
import { buildDxf } from "./lib/exportDxf";
import { downloadTextFile } from "./lib/download";
import { extractAutodeskFdoSurveyPoints } from "./lib/fdoBlobFallback";
import { buildPointHierarchy, pointKey } from "./lib/hierarchy";
import PointMap from "./components/PointMap";

const EMPTY_MAPPING = {
  id: "",
  code: "",
  description: "",
  timestamp: "",
  lat: "",
  lon: "",
  alt: "",
  easting: "",
  northing: "",
};

function mappingRow(label, key, mapping, setMapping, columns) {
  return (
    <label className="mapping-field">
      <span>{label}</span>
      <select
        value={mapping[key] || ""}
        onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}
      >
        <option value="">Unmapped</option>
        {columns.map((col) => (
          <option key={`${key}-${col}`} value={col}>
            {col}
          </option>
        ))}
      </select>
    </label>
  );
}

function HierarchyNode({ node, selectedPointKeys, onToggle }) {
  const checkboxRef = useRef(null);
  const selectedCount = node.pointKeys.filter((k) => selectedPointKeys.has(k)).length;
  const fullySelected = selectedCount > 0 && selectedCount === node.pointKeys.length;
  const partiallySelected = selectedCount > 0 && selectedCount < node.pointKeys.length;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = partiallySelected;
    }
  }, [partiallySelected]);

  return (
    <div className="hier-node">
      <label className="hier-label">
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={fullySelected}
          onChange={(e) => onToggle(node, e.target.checked)}
        />
        <span>{node.name}</span>
        <span className="hier-count">{selectedCount}/{node.pointKeys.length}</span>
      </label>
      {node.children.length > 0 && (
        <div className="hier-children">
          {node.children.map((child) => (
            <HierarchyNode
              key={child.id}
              node={child}
              selectedPointKeys={selectedPointKeys}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const dbRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("Load an SDF file to begin.");
  const [schema, setSchema] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [mapping, setMapping] = useState(EMPTY_MAPPING);
  const [points, setPoints] = useState([]);
  const [dropCount, setDropCount] = useState(0);
  const [diagnostic, setDiagnostic] = useState(null);
  const [fallbackInfo, setFallbackInfo] = useState(null);
  const [isFileLoaded, setIsFileLoaded] = useState(false);
  const [loadSummary, setLoadSummary] = useState("");
  const [defaultElevation, setDefaultElevation] = useState("0");
  const [selectedPointKeys, setSelectedPointKeys] = useState(new Set());
  const [highlightedPointKeys, setHighlightedPointKeys] = useState(new Set());

  const hierarchy = useMemo(() => buildPointHierarchy(points), [points]);

  useEffect(() => {
    const all = new Set(points.map((p, idx) => pointKey(p, idx)));
    setSelectedPointKeys(all);
    setHighlightedPointKeys(new Set());
  }, [points]);

  const activePoints = useMemo(
    () => points.filter((p, idx) => selectedPointKeys.has(pointKey(p, idx))),
    [points, selectedPointKeys],
  );

  function toggleHierarchyNode(node, checked) {
    setSelectedPointKeys((prev) => {
      const next = new Set(prev);
      for (const key of node.pointKeys) {
        if (checked) {
          next.add(key);
        } else {
          next.delete(key);
        }
      }
      return next;
    });
  }

  function toggleSinglePoint(pointSelectionKey, checked) {
    setSelectedPointKeys((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(pointSelectionKey);
      } else {
        next.delete(pointSelectionKey);
      }
      return next;
    });
  }

  function selectAllPoints() {
    setSelectedPointKeys(new Set(points.map((p, idx) => pointKey(p, idx))));
  }

  function clearAllPoints() {
    setSelectedPointKeys(new Set());
  }

  function selectHighlightedPoints() {
    if (!highlightedPointKeys.size) {
      setStatus("No highlighted points to select. Hold Shift and drag on the map first.");
      return;
    }
    setSelectedPointKeys((prev) => {
      const next = new Set(prev);
      for (const key of highlightedPointKeys) {
        next.add(key);
      }
      return next;
    });
    setStatus(`Selected ${highlightedPointKeys.size} highlighted points.`);
  }

  function deselectHighlightedPoints() {
    if (!highlightedPointKeys.size) {
      setStatus("No highlighted points to deselect. Hold Shift and drag on the map first.");
      return;
    }
    setSelectedPointKeys((prev) => {
      const next = new Set(prev);
      for (const key of highlightedPointKeys) {
        next.delete(key);
      }
      return next;
    });
    setStatus(`Deselected ${highlightedPointKeys.size} highlighted points.`);
  }

  function clearHighlightedPoints() {
    setHighlightedPointKeys(new Set());
    setStatus("Cleared highlighted points.");
  }

  function formatLoadSummary(pointsCount, extractorName, utmLabel) {
    return `Loaded ${pointsCount} points using ${extractorName} extractor using UTM ${utmLabel}.`;
  }

  function getInputFileStem(name) {
    const stem = String(name || "points")
      .replace(/\.[^.]+$/, "")
      .trim();
    const safe = stem
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9_.-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    return safe || "points";
  }

  function getProjectionTag() {
    if (fallbackInfo?.utm?.zone) {
      const hemi = fallbackInfo.utm.south ? "s" : "n";
      return `utm${fallbackInfo.utm.zone}${hemi}`;
    }

    const hasProjected = points.some((p) => p.easting !== null && p.northing !== null);
    if (hasProjected) {
      return "projected";
    }

    const hasWgs84 = points.some((p) => p.lat !== null && p.lon !== null);
    if (hasWgs84) {
      return "wgs84";
    }

    return "unknown-crs";
  }

  function buildExportFileName(formatTag, extension) {
    const stem = getInputFileStem(fileName);
    const projection = getProjectionTag();
    return `${stem}_${projection}_${formatTag}.${extension}`;
  }

  async function onFileChange(file) {
    if (!file) {
      return;
    }
    setIsFileLoaded(false);
    setLoadSummary("");
    setStatus("Opening SDF locally in your browser...");
    setFileName(file.name);

    try {
      const { db, diagnosis } = await loadSdfFile(file);
      dbRef.current = db;
      setDiagnostic(diagnosis);
      setFallbackInfo(null);
      const report = inspectDatabase(db);
      const candidateTables = findCandidateTables(report);

      setSchema(report);
      setCandidates(candidateTables);
      setIsFileLoaded(true);

      if (!candidateTables.length) {
        setLoadSummary(formatLoadSummary(0, "SQLite table", "unknown"));
        setStatus("No obvious point table detected. Pick any table from schema review.");
        return;
      }

      const top = candidateTables[0].table;
      setSelectedTable(top);
      loadTableData(db, top);
      setStatus("SDF parsed locally. Review mapping and generate exports.");
    } catch (err) {
      const d = err.sdfDiagnosis || null;
      setDiagnostic(d);
      const dbMessage = String(err?.message || "").toLowerCase();
      const shouldTryFallback =
        d?.looksLikeAutodeskFdoSurvey ||
        dbMessage.includes("file is not a database") ||
        dbMessage.includes("malformed database schema");

      if (shouldTryFallback) {
        try {
          const fileBytes = new Uint8Array(await file.arrayBuffer());
          const extracted = extractAutodeskFdoSurveyPoints(fileBytes);
          if (extracted.points.length) {
            setSchema([]);
            setCandidates([]);
            setSelectedTable("DATA_SurveyPoint (blob fallback)");
            setRows([]);
            setColumns([]);
            setMapping(EMPTY_MAPPING);
            setPoints(extracted.points);
            setDropCount(0);
            setFallbackInfo(extracted.details || null);
            setIsFileLoaded(true);
            const utmLabel = extracted.details?.utm
              ? `${extracted.details.utm.zone}${extracted.details.utm.south ? "S" : "N"}`
              : "unknown";
            setLoadSummary(
              formatLoadSummary(extracted.points.length, "Autodesk blob fallback", utmLabel),
            );
            setStatus(
              `Loaded ${extracted.points.length} points using Autodesk blob fallback decoder.`,
            );
            return;
          }
          const pageText = d?.pageSize ? ` Detected page size: ${d.pageSize}.` : "";
          const fallbackWarning = extracted.warning ? ` ${extracted.warning}` : "";
          setStatus(
            "This SDF uses a non-standard Autodesk blob layout."
              + pageText
              + fallbackWarning,
          );
          setLoadSummary("");
          return;
        } catch (fallbackErr) {
          setIsFileLoaded(false);
          setLoadSummary("");
          setStatus(`Fallback decode failed: ${fallbackErr.message}`);
          return;
        }
      }
      setIsFileLoaded(false);
      setLoadSummary("");
      setStatus(`Failed to read SDF: ${err.message}`);
    }
  }

  async function loadTableData(db, tableName) {
    const sample = sampleTable(db, tableName, 5000);
    const rowObjects = sample.rows.map((r) => mapRow(sample.columns, r));
    const mapped = autoMapping(sample.columns);
    const built = toCanonicalPoints(rowObjects, mapped, tableName);

    setRows(rowObjects);
    setColumns(sample.columns);
    setMapping(mapped);
    setPoints(built.points);
    setDropCount(built.dropped.length);
    setLoadSummary(formatLoadSummary(built.points.length, "SQLite table", "unknown"));
  }

  function remapAndRebuild() {
    const built = toCanonicalPoints(rows, mapping, selectedTable);
    setPoints(built.points);
    setDropCount(built.dropped.length);
    setLoadSummary(formatLoadSummary(built.points.length, "SQLite table", "unknown"));
  }

  function exportEmlidGlobal() {
    if (!activePoints.length) {
      setStatus("No mapped points to export.");
      return;
    }
    const csv = buildEmlidGlobalCsv(activePoints, { defaultElevation });
    downloadTextFile(buildExportFileName("emlid-global", "csv"), csv, "text/csv;charset=utf-8");
    setStatus("Downloaded Emlid global CSV (Name, Longitude, Latitude, Ellipsoidal height).");
  }

  function exportEmlidLocal() {
    if (!activePoints.length) {
      setStatus("No mapped points to export.");
      return;
    }
    const csv = buildEmlidLocalCsv(activePoints, { defaultElevation });
    downloadTextFile(buildExportFileName("emlid-local", "csv"), csv, "text/csv;charset=utf-8");
    setStatus("Downloaded Emlid local CSV (Name, Easting, Northing, Elevation).");
  }

  function exportBricscadCsv() {
    if (!activePoints.length) {
      setStatus("No mapped points to export.");
      return;
    }
    downloadTextFile(
      buildExportFileName("cad-points", "csv"),
      buildBricscadCsv(activePoints),
      "text/csv;charset=utf-8",
    );
    setStatus("Downloaded BricsCAD CSV in NameENZ format.");
  }

  function exportGeojsonFile() {
    if (!activePoints.length) {
      setStatus("No mapped points to export.");
      return;
    }
    downloadTextFile(
      buildExportFileName("points", "geojson"),
      buildGeojson(activePoints),
      "application/geo+json;charset=utf-8",
    );
    setStatus("Downloaded GeoJSON.");
  }

  function exportDxfFile() {
    if (!activePoints.length) {
      setStatus("No mapped points to export.");
      return;
    }
    const projectedCount = activePoints.filter((p) => p.easting !== null && p.northing !== null).length;
    if (!projectedCount) {
      setStatus("DXF export requires projected coordinates (Easting/Northing).");
      return;
    }
    downloadTextFile(
      buildExportFileName("points", "dxf"),
      buildDxf(activePoints, { baseLayerName: getInputFileStem(fileName) }),
      "application/dxf;charset=utf-8",
    );
    setStatus("Downloaded DXF point file.");
  }

  return (
    <div className="app-shell">
      <header className="hero mega-hero">
        <div className="hero-art" aria-hidden="true">
          <div className="hero-grid"></div>
          <div className="poi poi-a"></div>
          <div className="poi poi-b"></div>
          <div className="poi poi-c"></div>
          <div className="poi poi-d"></div>
        </div>
        <div className="hero-content">
          <p className="eyebrow">Browser-Local Survey Extractor</p>
          <h1>SDF to Emlid, BricsCAD, GeoJSON</h1>
          <p>
            Your file is parsed in-browser only. Data never leaves your machine.
          </p>
          <section className="load-spotlight">
            <h2>Load Your Survey File</h2>
            <p className="muted">Open an Autodesk Map3D SDF (SQLite-backed) file.</p>
            <div className="upload-row">
              <input
                id="sdf-upload"
                className="file-input-native"
                type="file"
                accept=".sdf,.sqlite,.db"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) {
                    return;
                  }
                  onFileChange(file);
                }}
              />
              <label htmlFor="sdf-upload" className="action file-trigger">
                Choose Survey File
              </label>
              <span className="file-types">Accepts .sdf, .sqlite, .db</span>
            </div>
            {!isFileLoaded && <p className="status">{status}</p>}
          </section>
        </div>
      </header>

      <main className="grid">
        {isFileLoaded && (
          <>
            <section className="card full">
              <h2>File summary</h2>
              {fileName && <p className="file">Loaded files: {fileName}</p>}
              {loadSummary && <p className="status">{loadSummary}</p>}
              <p className="muted small-note">Detected point tables:</p>
              <div className="table-list">
                {candidates.slice(0, 8).map((t) => (
                  <button
                    key={t.table}
                    type="button"
                    className={selectedTable === t.table ? "table-pill active" : "table-pill"}
                    onClick={() => {
                      if (!dbRef.current) {
                        setStatus("Database is not loaded yet.");
                        return;
                      }
                      setSelectedTable(t.table);
                      loadTableData(dbRef.current, t.table);
                      setStatus(`Selected table ${t.table}. Mapping refreshed.`);
                    }}
                  >
                    {t.table} ({t.rowCount})
                  </button>
                ))}
              </div>
              {!candidates.length && fallbackInfo && (
                <p className="small-note">Using direct Autodesk blob parsing mode for this file.</p>
              )}
            </section>

            <section className="card full">
              <h2>Points Overview</h2>
              <p className="muted">
                Use hierarchy or map interactions to control exactly which points are selected for export.
              </p>
              <div className="selection-actions">
                <button type="button" className="action secondary" onClick={selectAllPoints}>Select All</button>
                <button type="button" className="action secondary" onClick={clearAllPoints}>Clear All</button>
                <button type="button" className="action secondary" onClick={selectHighlightedPoints}>
                  Select Highlighted
                </button>
                <button type="button" className="action secondary" onClick={deselectHighlightedPoints}>
                  Deselect Highlighted
                </button>
                <button type="button" className="action secondary" onClick={clearHighlightedPoints}>
                  Clear Highlight
                </button>
              </div>
              <div className="points-overview-layout">
                <div className="points-overview-map-panel">
                  <p className="muted small-note map-instruction">
                    Click markers to toggle selection. Hold Shift and drag to highlight an area.
                  </p>
                  <PointMap
                    points={points}
                    selectedPointKeys={selectedPointKeys}
                    highlightedPointKeys={highlightedPointKeys}
                    pointKeyFn={pointKey}
                    onPointToggle={toggleSinglePoint}
                    onHighlightedKeysChange={(keys) => setHighlightedPointKeys(new Set(keys))}
                  />
                  <div className="map-footer-row">
                    <span className="points-selected-count">
                      Points selected: {selectedPointKeys.size} of {points.length}
                    </span>
                  </div>
                </div>
                <div className="points-overview-hierarchy-panel">
                  <h3 className="subhead">Hierarchy</h3>
                  <p className="muted small-note">
                    Points are grouped by source, inferred group name, and inferred role.
                  </p>
                  <div className="hier-tree">
                    {hierarchy.map((node) => (
                      <HierarchyNode
                        key={node.id}
                        node={node}
                        selectedPointKeys={selectedPointKeys}
                        onToggle={toggleHierarchyNode}
                      />
                    ))}
                    {!hierarchy.length && <p className="small-note">No points available for hierarchy selection yet.</p>}
                  </div>
                </div>
              </div>
            </section>

            <section className="card full">
              <h2>Field Mapping</h2>
              <p className="muted">Adjust mappings when autodetection is not correct, then rebuild points.</p>
              {!fallbackInfo && (
                <>
                  <div className="mapping-grid">
                    {mappingRow("Point ID", "id", mapping, setMapping, columns)}
                    {mappingRow("Code", "code", mapping, setMapping, columns)}
                    {mappingRow("Description", "description", mapping, setMapping, columns)}
                    {mappingRow("Timestamp", "timestamp", mapping, setMapping, columns)}
                    {mappingRow("Latitude", "lat", mapping, setMapping, columns)}
                    {mappingRow("Longitude", "lon", mapping, setMapping, columns)}
                    {mappingRow("Altitude", "alt", mapping, setMapping, columns)}
                    {mappingRow("Easting", "easting", mapping, setMapping, columns)}
                    {mappingRow("Northing", "northing", mapping, setMapping, columns)}
                  </div>
                  <button type="button" className="action" onClick={remapAndRebuild}>
                    Rebuild Mapped Points
                  </button>
                </>
              )}
              {fallbackInfo && (
                <div className="diag-box">
                  <p><strong>Autodesk blob parser details</strong></p>
                  <p>Root page: {fallbackInfo.rootPage}</p>
                  <p>Rows discovered: {fallbackInfo.totalRows}</p>
                  <p>Rows extracted: {fallbackInfo.extractedRows}</p>
                  <p>
                    UTM hint: {fallbackInfo.utm ? `${fallbackInfo.utm.zone}${fallbackInfo.utm.south ? "S" : "N"}` : "not found"}
                  </p>
                </div>
              )}
            </section>

            <section className="card full downloads-spotlight">
              <h2>Downloads</h2>
              <p className="muted">Export the currently selected points in your preferred format.</p>
              <label className="mapping-field">
                <span>Default elevation for missing heights (Emlid)</span>
                <input
                  type="number"
                  step="0.001"
                  value={defaultElevation}
                  onChange={(e) => setDefaultElevation(e.target.value)}
                />
              </label>
              <div className="download-grid">
                <button type="button" className="action" onClick={exportEmlidGlobal}>
                  Download Emlid Global CSV
                </button>
                <button type="button" className="action" onClick={exportEmlidLocal}>
                  Download Emlid Local CSV
                </button>
                <button type="button" className="action" onClick={exportBricscadCsv}>
                  Download BricsCAD CSV
                </button>
                <button type="button" className="action" onClick={exportGeojsonFile}>
                  Download GeoJSON
                </button>
                <button type="button" className="action" onClick={exportDxfFile}>
                  Download DXF
                </button>
              </div>
              <p className="muted small-note">
                DXF export contains projected coordinates only. For reliable XREF workflows, assign CRS in BricsCAD/AutoCAD,
                then Save As DWG before attaching as an external reference. UTM projected coordinates are exported in meters,
                referenced to the projection origin.
              </p>
            </section>
          </>
        )}

      </main>
    </div>
  );
}

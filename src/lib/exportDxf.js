function sanitizeLayerName(rawName) {
  const base = String(rawName || "").trim() || "SURVEY_POINTS";
  let safe = base
    .replace(/[<>\\/\":;?*|,='`]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_.-]/g, "_");

  if (!safe) {
    safe = "SURVEY_POINTS";
  }

  if (safe.startsWith("*")) {
    safe = `LAYER${safe.slice(1)}`;
  }

  if (safe.startsWith("$")) {
    safe = `LAYER_${safe.slice(1)}`;
  }

  return safe.slice(0, 255);
}

function dxfHeader(layers) {
  return [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$ACADVER",
    "1",
    "AC1009",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "TABLES",
    "0",
    "TABLE",
    "2",
    "LTYPE",
    "70",
    "1",
    "0",
    "LTYPE",
    "2",
    "CONTINUOUS",
    "70",
    "0",
    "3",
    "Solid line",
    "72",
    "65",
    "73",
    "0",
    "40",
    "0.0",
    "0",
    "ENDTAB",
    "0",
    "TABLE",
    "2",
    "LAYER",
    "70",
    String(layers.length),
    ...layers.flatMap((layerName) => [
      "0",
      "LAYER",
      "2",
      layerName,
      "70",
      "0",
      "62",
      "7",
      "6",
      "CONTINUOUS",
    ]),
    "0",
    "ENDTAB",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
  ];
}

function dxfFooter() {
  return ["0", "ENDSEC", "0", "EOF"];
}

function pointEntity(x, y, z, layer) {
  return [
    "0",
    "POINT",
    "8",
    String(layer || "SURVEY_POINTS"),
    "10",
    String(x),
    "20",
    String(y),
    "30",
    String(z ?? 0),
  ];
}

function textEntity(text, x, y, z, layer) {
  return [
    "0",
    "TEXT",
    "8",
    String(layer),
    "10",
    String(x),
    "20",
    String(y),
    "30",
    String(z ?? 0),
    "40",
    "1.0",
    "1",
    String(text),
  ];
}

function sanitizeLabelText(value) {
  return String(value || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasLetters(value) {
  return /[A-Za-z]/.test(String(value || ""));
}

function pointLabel(point, index) {
  const candidates = [point.code, point.description, point.id];

  for (const candidate of candidates) {
    const label = sanitizeLabelText(candidate);
    if (label && hasLetters(label)) {
      return label;
    }
  }

  for (const candidate of candidates) {
    const label = sanitizeLabelText(candidate);
    if (label) {
      return label;
    }
  }
  return `PT_${index + 1}`;
}

export function buildDxf(points, options = {}) {
  const baseLayer = sanitizeLayerName(options.baseLayerName || "SURVEY_POINTS");
  const labelLayer = sanitizeLayerName(`${baseLayer}_LABELS`);
  const entities = points
    .filter((p) => p.easting !== null && p.northing !== null)
    .map((p, index) => ({
      x: p.easting,
      y: p.northing,
      z: p.alt,
      layer: baseLayer,
      label: pointLabel(p, index),
    }));

  const layers = Array.from(new Set(["0", baseLayer, labelLayer]));
  const lines = dxfHeader(layers);
  for (const entity of entities) {
    lines.push(...pointEntity(entity.x, entity.y, entity.z, entity.layer));
    lines.push(...textEntity(entity.label, entity.x, entity.y, entity.z, labelLayer));
  }
  lines.push(...dxfFooter());
  return `${lines.join("\n")}\n`;
}

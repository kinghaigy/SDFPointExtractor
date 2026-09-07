import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Popup, Rectangle, TileLayer, useMap, useMapEvents } from "react-leaflet";

function FitBounds({ bounds }) {
  const map = useMap();

  useEffect(() => {
    if (!bounds) {
      return;
    }
    map.fitBounds(bounds, { padding: [26, 26] });
  }, [map, bounds]);

  return null;
}

const selectedStyle = {
  color: "#0f6f44",
  fillColor: "#1ec27a",
  fillOpacity: 0.9,
  weight: 2,
};

const unselectedStyle = {
  color: "#67767d",
  fillColor: "#cfd7dc",
  fillOpacity: 0.75,
  weight: 1,
};

const highlightedSelectedStyle = {
  color: "#a84300",
  fillColor: "#ffb26b",
  fillOpacity: 0.95,
  weight: 2,
};

const highlightedUnselectedStyle = {
  color: "#7a4b21",
  fillColor: "#ffd9b8",
  fillOpacity: 0.95,
  weight: 2,
};

function boundsFromLatLng(start, end) {
  const minLat = Math.min(start.lat, end.lat);
  const maxLat = Math.max(start.lat, end.lat);
  const minLon = Math.min(start.lng, end.lng);
  const maxLon = Math.max(start.lng, end.lng);
  return {
    minLat,
    maxLat,
    minLon,
    maxLon,
    leafletBounds: [
      [minLat, minLon],
      [maxLat, maxLon],
    ],
  };
}

function pointInBounds(point, bounds) {
  return point.lat >= bounds.minLat
    && point.lat <= bounds.maxLat
    && point.lon >= bounds.minLon
    && point.lon <= bounds.maxLon;
}

function DragHighlightTool({ points, pointKeyFn, onHighlightedKeysChange }) {
  const map = useMap();
  const [startLatLng, setStartLatLng] = useState(null);
  const [currentLatLng, setCurrentLatLng] = useState(null);

  useEffect(() => () => map.dragging.enable(), [map]);

  useMapEvents({
    mousedown(event) {
      if (!event.originalEvent.shiftKey) {
        return;
      }
      setStartLatLng(event.latlng);
      setCurrentLatLng(event.latlng);
      map.dragging.disable();
      event.originalEvent.preventDefault();
    },
    mousemove(event) {
      if (!startLatLng) {
        return;
      }
      setCurrentLatLng(event.latlng);
    },
    mouseup(event) {
      if (!startLatLng) {
        return;
      }
      const finalLatLng = currentLatLng || event.latlng;
      const bounds = boundsFromLatLng(startLatLng, finalLatLng);
      const highlighted = points
        .map((point, idx) => ({ point, idx }))
        .filter(({ point }) => point.lat !== null && point.lon !== null)
        .filter(({ point }) => pointInBounds(point, bounds))
        .map(({ point, idx }) => pointKeyFn(point, idx));
      onHighlightedKeysChange(highlighted);
      setStartLatLng(null);
      setCurrentLatLng(null);
      map.dragging.enable();
    },
  });

  if (!startLatLng || !currentLatLng) {
    return null;
  }

  const bounds = boundsFromLatLng(startLatLng, currentLatLng).leafletBounds;
  return <Rectangle bounds={bounds} pathOptions={{ color: "#d45c2f", weight: 2, fillOpacity: 0.1 }} />;
}

export default function PointMap({
  points,
  selectedPointKeys,
  highlightedPointKeys,
  pointKeyFn,
  onPointToggle,
  onHighlightedKeysChange,
}) {
  const geoPoints = useMemo(
    () => points.filter((p) => p.lat !== null && p.lon !== null),
    [points],
  );

  const bounds = useMemo(() => {
    if (!geoPoints.length) {
      return null;
    }
    const lats = geoPoints.map((p) => p.lat);
    const lons = geoPoints.map((p) => p.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    return [
      [minLat, minLon],
      [maxLat, maxLon],
    ];
  }, [geoPoints]);

  if (!geoPoints.length) {
    return <p className="small-note">No latitude/longitude available for map display.</p>;
  }

  return (
    <div className="map-wrap">
      <MapContainer
        center={[geoPoints[0].lat, geoPoints[0].lon]}
        zoom={18}
        minZoom={2}
        maxZoom={24}
        preferCanvas
        className="leaflet-map"
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxNativeZoom={19}
          maxZoom={24}
        />
        <DragHighlightTool
          points={points}
          pointKeyFn={pointKeyFn}
          onHighlightedKeysChange={onHighlightedKeysChange}
        />
        <FitBounds bounds={bounds} />
        {points.map((point, idx) => {
          if (point.lat === null || point.lon === null) {
            return null;
          }
          const key = pointKeyFn(point, idx);
          const selected = selectedPointKeys.has(key);
          const highlighted = highlightedPointKeys.has(key);
          let style = selected ? selectedStyle : unselectedStyle;
          if (highlighted && selected) {
            style = highlightedSelectedStyle;
          } else if (highlighted) {
            style = highlightedUnselectedStyle;
          }
          return (
            <CircleMarker
              key={key}
              center={[point.lat, point.lon]}
              radius={highlighted ? 7 : selected ? 6 : 5}
              pathOptions={style}
              eventHandlers={{
                click: () => onPointToggle(key, !selected),
              }}
            >
              <Popup>
                <div>
                  <strong>{point.code || point.id || "Point"}</strong>
                  <br />
                  Selected: {selected ? "Yes" : "No"}
                  <br />
                  Highlighted: {highlighted ? "Yes" : "No"}
                  <br />
                  Lon: {point.lon}
                  <br />
                  Lat: {point.lat}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="map-legend">
        <span className="legend-dot selected" /> Selected for export
        <span className="legend-dot unselected" /> Not selected
        <span className="legend-dot highlighted" /> Highlighted area pick
      </div>
    </div>
  );
}

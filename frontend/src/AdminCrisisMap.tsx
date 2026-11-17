import { useEffect } from 'react';
import { geoJSON } from 'leaflet';
import type { MultiPolygon, Polygon } from 'geojson';
import { CircleMarker, GeoJSON, MapContainer, Tooltip, useMap } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import type { Crisis } from './types';
import boundaries from './admin-country-boundaries.json';
import 'leaflet/dist/leaflet.css';

// Natural Earth 1:50m Admin 0 Countries, v5.1.2 (public domain).
type CountryBoundary = MultiPolygon | Polygon;
const countryBoundaries = boundaries as Record<string, CountryBoundary | undefined>;

function FitCountry({ boundary }: { boundary: CountryBoundary }) {
  const map = useMap();
  useEffect(() => {
    const bounds = geoJSON(boundary).getBounds();
    const container = map.getContainer();
    const padding = 12;
    function fit() {
      // Navigation can temporarily hide the map while the next page loads.
      if (container.clientWidth <= padding * 2 || container.clientHeight <= padding * 2) return;
      map.invalidateSize({ pan: false });
      map.fitBounds(bounds, { padding: [padding, padding], animate: false });
    }
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [map, boundary]);
  return null;
}

export default function AdminCrisisMap({ country, crises }: { country: string; crises: Crisis[] }) {
  const navigate = useNavigate();
  const boundary = countryBoundaries[country];
  if (!boundary) return null;

  return (
    <MapContainer
      className="overview-crisis-map"
      center={[0, 0]}
      zoom={1}
      zoomSnap={0.1}
      zoomControl={false}
      attributionControl={false}
      scrollWheelZoom={false}
    >
      <FitCountry boundary={boundary} />
      <GeoJSON data={boundary} interactive={false} style={{ color: '#6485ae', weight: 1, fillColor: '#496b98', fillOpacity: 0.85 }} />
      {crises.filter(({ latitude, longitude }) => Number.isFinite(latitude) && Number.isFinite(longitude)
        && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && (latitude !== 0 || longitude !== 0))
        .map(crisis => (
          <CircleMarker
            key={crisis.id}
            center={[crisis.latitude, crisis.longitude]}
            radius={crisis.active ? 5 : 4}
            pathOptions={{ color: '#132036', weight: 1, fillColor: crisis.active ? '#55bdff' : '#adbad0', fillOpacity: 1 }}
            eventHandlers={{ click: () => navigate(`/admin/crises?crisisId=${crisis.id}`) }}
          >
            <Tooltip>{crisis.name} · {crisis.active ? 'Active' : 'Ended'}</Tooltip>
          </CircleMarker>
        ))}
    </MapContainer>
  );
}

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap, useMapEvents } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import type { PublicShelter } from './types';
import 'leaflet/dist/leaflet.css';

export const countryMapCenters: Record<string, [number, number]> = {
  LK: [7.8, 80.7], IN: [22, 79], NP: [28.3, 84],
};
interface MapPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
}

function Picker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}
function MapCenter({ latitude, longitude, zoom, hasPoint, bounds }: {
  latitude: number; longitude: number; zoom: number; hasPoint: boolean; bounds?: [[number, number], [number, number]];
}) {
  const map = useMap();
  const south = bounds?.[0][0], west = bounds?.[0][1], north = bounds?.[1][0], east = bounds?.[1][1];
  useEffect(() => {
    if (south !== undefined && west !== undefined && north !== undefined && east !== undefined) {
      map.fitBounds([[south, west], [north, east]], { padding: [28, 28], maxZoom: zoom, animate: false });
    } else {
      map.setView([latitude, longitude], hasPoint ? Math.max(zoom, map.getZoom()) : zoom, { animate: false });
    }
  }, [map, latitude, longitude, zoom, hasPoint, south, west, north, east]);
  return null;
}
export function MapView({
  shelters = [],
  places = [],
  point,
  onPick,
  initialCenter,
  initialZoom = 12,
  height = 320,
  failureMessage,
}: {
  shelters?: PublicShelter[];
  places?: MapPlace[];
  point?: [number, number];
  onPick?: (lat: number, lng: number) => void;
  initialCenter?: [number, number];
  initialZoom?: number;
  height?: number;
  failureMessage?: string;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const locations = [...shelters.map(shelter => ({
    ...shelter, description: `${shelter.available} ${t('spaces')}`, color: shelter.open ? '#16865c' : '#bc4040',
  })), ...places.map(place => ({ ...place, color: '#1769e0' }))];
  const first = locations[0];
  const center = point ?? initialCenter ?? (first ? [first.latitude, first.longitude] : [6.94, 79.9]);
  const bounds: [[number, number], [number, number]] | undefined = !point && !initialCenter && locations.length > 1 ? [
    [Math.min(...locations.map(s => s.latitude)), Math.min(...locations.map(s => s.longitude))],
    [Math.max(...locations.map(s => s.latitude)), Math.max(...locations.map(s => s.longitude))],
  ] : undefined;
  const zoom = point ? 12 : initialZoom;
  return (
    <div className="map-wrap">
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom={false}
        style={{ height, width: '100%' }}
      >
        <MapCenter latitude={center[0]} longitude={center[1]} zoom={zoom} hasPoint={!!point} bounds={bounds} />
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          eventHandlers={{ tileerror: () => setFailed(true) }}
        />
        {onPick && <Picker onPick={onPick} />}
        {point && (
          <CircleMarker
            center={point}
            radius={10}
            pathOptions={{ color: '#1769e0', fillOpacity: 0.6 }}
          />
        )}
        {locations.map((s) => (
          <CircleMarker
            key={s.id}
            center={[s.latitude, s.longitude]}
            radius={9}
            pathOptions={{ color: s.color, fillOpacity: 0.8 }}
          >
            <Popup>
              <strong>{s.name}</strong>
              <br />
              {s.description}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      {onPick && <small className="map-note">{t('mapHint')}</small>}
      {failed && <small className="map-note" role="status">{failureMessage ?? t('mapFailure')}</small>}
    </div>
  );
}

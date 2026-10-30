import { useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import type { Shelter } from './types';
import 'leaflet/dist/leaflet.css';
function Picker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}
export function MapView({
  shelters = [],
  point,
  onPick,
}: {
  shelters?: Shelter[];
  point?: [number, number];
  onPick?: (lat: number, lng: number) => void;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  return (
    <div className="map-wrap">
      <MapContainer
        key={point ? `${point[0].toFixed(2)},${point[1].toFixed(2)}` : 'default'}
        center={point || [6.94, 79.9]}
        zoom={12}
        scrollWheelZoom={false}
        style={{ height: 320, width: '100%' }}
      >
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
        {shelters.map((s) => (
          <CircleMarker
            key={s.id}
            center={[s.latitude, s.longitude]}
            radius={9}
            pathOptions={{ color: s.open ? '#16865c' : '#bc4040', fillOpacity: 0.8 }}
          >
            <Popup>
              <strong>{s.name}</strong>
              <br />
              {s.available} {t('spaces')}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      {onPick && <small className="map-note">{t('mapHint')}</small>}
      {failed && <small className="map-note">{t('mapFailure')}</small>}
    </div>
  );
}

import { useState } from 'react';
import { geoJSON } from 'leaflet';
import type { MultiPolygon, Polygon } from 'geojson';
import { Button, Field } from './components';
import { MapView } from './MapView';
import boundariesJson from './admin-country-boundaries.json';

const boundaries = boundariesJson as Record<string, Polygon | MultiPolygon | undefined>;

export function ResourceLocationFields({ country, latitude, longitude }: {
  country: string; latitude?: number; longitude?: number;
}) {
  const [lat, setLat] = useState(latitude?.toString() ?? '');
  const [lng, setLng] = useState(longitude?.toString() ?? '');
  const [mapOpen, setMapOpen] = useState(false);
  const boundary = boundaries[country];
  const center = mapOpen && boundary ? geoJSON(boundary).getBounds().getCenter() : undefined;
  const point: [number, number] | undefined = lat && lng && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180
    ? [Number(lat), Number(lng)] : undefined;
  return <>
    <Field label="Latitude"><input name="latitude" type="number" min={-90} max={90} step="any" required value={lat}
      onChange={(event) => setLat(event.target.value)} /></Field>
    <Field label="Longitude"><input name="longitude" type="number" min={-180} max={180} step="any" required value={lng}
      onChange={(event) => setLng(event.target.value)} /></Field>
    {boundary && <div className="stack" style={{ gridColumn: '1 / -1' }}>
      <Button type="button" variant="secondary" aria-expanded={mapOpen} onClick={() => setMapOpen(!mapOpen)}>
        {mapOpen ? 'Hide location map' : 'Choose location on map'}
      </Button>
      {center && <MapView point={point} initialCenter={[center.lat, center.lng]} initialZoom={country === 'IN' ? 5 : 7}
        onPick={(lat, lng) => { setLat(lat.toFixed(6)); setLng(lng.toFixed(6)); }} />}
    </div>}
  </>;
}

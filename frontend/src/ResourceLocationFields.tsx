import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { geoJSON } from 'leaflet';
import type { MultiPolygon, Polygon } from 'geojson';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { get } from './api';
import { Button, Field } from './components';
import { countryPath } from './crisisOperationsApi';
import { locationSearchSchema, type LocationResult } from './locationSearch';
import { MapView } from './MapView';
import boundariesJson from './admin-country-boundaries.json';
import './resource-location-fields.css';

const boundaries = boundariesJson as Record<string, Polygon | MultiPolygon | undefined>;

export function ResourceLocationFields({ country, latitude, longitude }: {
  country: string; latitude?: number; longitude?: number;
}) {
  const { t } = useTranslation();
  const [lat, setLat] = useState(latitude?.toString() ?? '');
  const [lng, setLng] = useState(longitude?.toString() ?? '');
  const [mapOpen, setMapOpen] = useState(false);
  const [place, setPlace] = useState('');
  const search = useMutation({
    mutationFn: async (query: string) => locationSearchSchema.parse(
      await get<unknown>(countryPath('/maps/geocode', country, { query })),
    ).features,
  });
  const boundary = boundaries[country];
  const center = mapOpen && boundary ? geoJSON(boundary).getBounds().getCenter() : undefined;
  const point: [number, number] | undefined = lat && lng && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180
    ? [Number(lat), Number(lng)] : undefined;
  const query = place.trim();
  const canSearch = query.length >= 3 && !search.isPending;

  function setPoint(latitude: number, longitude: number) {
    search.reset();
    setLat(latitude.toFixed(6));
    setLng(longitude.toFixed(6));
  }

  function choosePlace(result: LocationResult) {
    const [longitude, latitude] = result.geometry.coordinates;
    setPoint(latitude, longitude);
    setPlace(result.properties.label.slice(0, 150));
  }

  function findPlace() {
    if (!canSearch) return;
    search.mutate(query, { onSuccess: results => {
      if (results.length === 1) choosePlace(results[0]);
    } });
  }

  return <>
    <Field label="Latitude"><input name="latitude" type="number" min={-90} max={90} step="any" required value={lat}
      onChange={(event) => { search.reset(); setLat(event.target.value); }} /></Field>
    <Field label="Longitude"><input name="longitude" type="number" min={-180} max={180} step="any" required value={lng}
      onChange={(event) => { search.reset(); setLng(event.target.value); }} /></Field>
    {boundary && <div className="resource-location-map stack">
      <Button type="button" variant="secondary" aria-expanded={mapOpen} onClick={() => {
        if (mapOpen) search.reset();
        setMapOpen(!mapOpen);
      }}>
        {mapOpen ? 'Hide location map' : 'Choose location on map'}
      </Button>
      {center && <>
        <div className="resource-location-search">
          <Field label={t('searchLocation')}>
            <input type="search" value={place} maxLength={150} onChange={event => {
              search.reset();
              setPlace(event.target.value);
            }} onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              event.preventDefault();
              findPlace();
            }} />
          </Field>
          <Button type="button" variant="secondary" disabled={!canSearch} busy={search.isPending} onClick={findPlace}>
            {!search.isPending && <Search size={17} aria-hidden="true" />} Find location
          </Button>
        </div>
        {search.isError && <p className="muted" role="status">Location search is unavailable. Choose a point on the map or enter the coordinates.</p>}
        {search.isSuccess && (search.data.length === 0 ? <p className="muted" role="status">{t('locationNotFound')}</p> : <>
          <p className="muted" role="status">{t('chooseLocationResult')}</p>
          <ul className="resource-location-results">
            {search.data.map((result, index) => <li key={index}>
              <Button type="button" variant="secondary" onClick={() => choosePlace(result)}>{result.properties.label}</Button>
            </li>)}
          </ul>
        </>)}
        <MapView point={point} initialCenter={[center.lat, center.lng]} initialZoom={country === 'IN' ? 5 : 7}
          onPick={setPoint} failureMessage="Map tiles are unavailable. Use search or enter the coordinates." />
      </>}
    </div>}
  </>;
}

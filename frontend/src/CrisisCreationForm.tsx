import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MapPin, Search } from 'lucide-react';
import { get } from './api';
import { Button, ErrorState, Field } from './components';
import { countryPath } from './crisisOperationsApi';
import { RegionField, useCountry } from './geography';
import { locationSearchSchema, type LocationResult } from './locationSearch';

export function CrisisCreationForm({
  busy,
  onCreate,
  showSearch = false,
}: {
  busy: boolean;
  onCreate: (data: Record<string, unknown>) => void;
  showSearch?: boolean;
}) {
  const country = useCountry();
  const [latitude, setLatitude] = useState(''),
    [longitude, setLongitude] = useState('');
  const [place, setPlace] = useState('');
  const [district, setDistrict] = useState('');
  const searchLocation = useMutation({
    mutationFn: async (query: string) => {
      const result = locationSearchSchema.safeParse(await get<unknown>(countryPath('/maps/geocode', country, { query })));
      if (!result.success) throw new Error('Location search is unavailable. Enter the coordinates or use your current location.');
      return result.data.features;
    },
  });
  const [locating, setLocating] = useState(false),
    [locationError, setLocationError] = useState('');
  const locationRequest = useRef(0);
  function locateCrisis() {
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('Location is unavailable. Enter the coordinates manually.');
      return;
    }
    const request = ++locationRequest.current;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (locationRequest.current !== request) return;
        setLatitude(String(coords.latitude));
        setLongitude(String(coords.longitude));
        setLocating(false);
      },
      () => {
        if (locationRequest.current !== request) return;
        setLocationError(
          'Could not get your location. Allow location access or enter the coordinates manually.',
        );
        setLocating(false);
      },
      { timeout: 10000 },
    );
  }
  function editCoordinates(setValue: (value: string) => void, value: string) {
    locationRequest.current++;
    setLocating(false);
    setLocationError('');
    setValue(value);
  }
  function selectLocation({ properties, geometry }: LocationResult) {
    const [longitude, latitude] = geometry.coordinates;
    editCoordinates(setLatitude, String(latitude));
    setLongitude(String(longitude));
    setDistrict(value => value || properties.label.slice(0, 150));
    searchLocation.reset();
  }
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        onCreate({
          ...data,
          active: true,
          latitude: Number(data.latitude),
          longitude: Number(data.longitude),
        });
      }}
    >
      <Field label="Crisis name">
        <input name="name" required maxLength={150} />
      </Field>
      <Field label="Type">
        <select name="type">
          {[
            'Flood',
            'Landslide',
            'Earthquake',
            'Storm',
            'Disease outbreak',
            'Displacement',
            'Other',
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </Field>
      <RegionField hideDistrictSuffix />
      <Field label="Local area">
        <input name="district" maxLength={150} value={district} onChange={e => setDistrict(e.target.value)} />
      </Field>
      {showSearch && <div className="coord-location-search">
        <Field label="Search location">
          <input type="search" value={place} maxLength={150} onChange={e => {
            setPlace(e.target.value);
            if (searchLocation.isSuccess || searchLocation.isError) searchLocation.reset();
          }} onKeyDown={e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (place.trim().length >= 3 && !searchLocation.isPending) searchLocation.mutate(place.trim());
          }} />
        </Field>
        <Button type="button" variant="secondary" disabled={place.trim().length < 3} busy={searchLocation.isPending}
          onClick={() => searchLocation.mutate(place.trim())}><Search size={17} /> Find location</Button>
        {searchLocation.isError && <ErrorState error={searchLocation.error} />}
        {searchLocation.isSuccess && (searchLocation.data.length ?
          <ul className="coord-activity-list">{searchLocation.data.map((result, index) =>
            <li key={index}><Button type="button" variant="ghost" onClick={() => selectLocation(result)}>{result.properties.label}</Button></li>)}</ul> :
          <p className="muted" role="status">No locations matched your search.</p>)}
      </div>}
      <Field label="Latitude">
        <input
          type="number"
          name="latitude"
          min={-90}
          max={90}
          step="any"
          value={latitude}
          onChange={(e) => editCoordinates(setLatitude, e.target.value)}
          required
        />
      </Field>
      <Field label="Longitude">
        <input
          type="number"
          name="longitude"
          min={-180}
          max={180}
          step="any"
          value={longitude}
          onChange={(e) => editCoordinates(setLongitude, e.target.value)}
          required
        />
      </Field>
      <div className="crisis-location-action">
        <Button type="button" variant="secondary" busy={locating} onClick={locateCrisis}>
          <MapPin size={18} aria-hidden="true" /> Use my current location
        </Button>
        <small className="muted">
          Use this only if you are at the crisis location, or enter coordinates manually.
        </small>
        {locationError && (
          <small className="field-error" role="alert">
            {locationError}
          </small>
        )}
      </div>
      <Button busy={busy}>Create response event</Button>
    </form>
  );
}

import { useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { Button, Field } from './components';
import { RegionField } from './geography';

export function CrisisCreationForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (data: Record<string, unknown>) => void;
}) {
  const [latitude, setLatitude] = useState(''),
    [longitude, setLongitude] = useState('');
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
      <RegionField />
      <Field label="Local area">
        <input name="district" maxLength={150} />
      </Field>
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

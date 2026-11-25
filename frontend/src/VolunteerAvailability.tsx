import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, get } from './api';
import { Button, Card, DateInput, ErrorState, Field, formatDate, Loading } from './components';

interface AvailabilityWindow { id: string; startsAt: string; endsAt: string }

const availabilityKey = ['volunteers', 'my-availability'] as const;

export function VolunteerAvailability() {
  const query = useQuery({ queryKey: availabilityKey, queryFn: () => get<AvailabilityWindow[]>('/volunteers/me/availability') });
  return <Card>
    <h2>Availability windows</h2>
    {query.isPending ? <Loading /> : query.error ? <ErrorState error={query.error} retry={() => void query.refetch()} /> :
      <AvailabilityEditor windows={query.data} />}
  </Card>;
}

function AvailabilityEditor({ windows }: { windows: AvailabilityWindow[] }) {
  const client = useQueryClient();
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: (change: string | Omit<AvailabilityWindow, 'id'>) => typeof change === 'string'
      ? api.delete('/volunteers/me/availability/' + change) : api.post('/volunteers/me/availability', change),
    onMutate: () => setSaved(false),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: availabilityKey });
      setStartsAt('');
      setEndsAt('');
      setSaved(true);
    },
  });
  return <div className="stack">
    {windows.length ? <ul className="stack">
      {windows.map(window => <li key={window.id}>
        <div className="inline spread">
          <span>{formatDate(window.startsAt)} – {formatDate(window.endsAt)}</span>
          <Button type="button" variant="secondary" disabled={mutation.isPending}
            aria-label={'Remove availability starting ' + formatDate(window.startsAt)}
            onClick={() => mutation.mutate(window.id)}>Remove</Button>
        </div>
      </li>)}
    </ul> : <p className="muted">Availability unknown. Add the times you can commit to a task.</p>}
    <form className="stack" onSubmit={event => {
      event.preventDefault();
      mutation.mutate({ startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() });
    }}>
      <p>Times use this device’s time zone.</p>
      <div className="form-grid">
        <Field label="Available from"><DateInput type="datetime-local" value={startsAt} required onChange={event => setStartsAt(event.target.value)} /></Field>
        <Field label="Available until"><DateInput type="datetime-local" value={endsAt} min={startsAt} required onChange={event => setEndsAt(event.target.value)} /></Field>
      </div>
      <div><Button disabled={mutation.isPending || windows.length >= 30}>Add availability</Button></div>
    </form>
    {mutation.error && <ErrorState error={mutation.error} />}
    {saved && <p role="status">Availability updated.</p>}
  </div>;
}

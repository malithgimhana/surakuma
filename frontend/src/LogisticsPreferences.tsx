import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, get } from './api';
import { Button, ErrorState, Loading } from './components';

interface Preferences {
  dispatchUpdates: boolean;
  stockAlerts: boolean;
  supplyUpdates: boolean;
  assignmentUpdates: boolean;
}
const labels: Record<keyof Preferences, string> = {
  dispatchUpdates: 'Dispatch updates',
  stockAlerts: 'Low and out-of-stock alerts',
  supplyUpdates: 'Supply request updates',
  assignmentUpdates: 'Case assignment updates',
};
export default function LogisticsPreferences() {
  const [saved, setSaved] = useState(false);
  const query = useQuery({
    queryKey: ['logistics-preferences'],
    queryFn: () => get<Preferences>('/auth/logistics-preferences'),
  });
  return query.error ? (
    <ErrorState error={query.error} />
  ) : query.data ? (
    <>
      <PreferencesForm key={JSON.stringify(query.data)} initial={query.data} saved={setSaved} />
      {saved && <p role="status">Notification preferences saved.</p>}
    </>
  ) : (
    <Loading />
  );
}
function PreferencesForm({
  initial,
  saved,
}: {
  initial: Preferences;
  saved: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () => api.put('/auth/logistics-preferences', draft),
    onSuccess: async () => {
      saved(true);
      await client.invalidateQueries({ queryKey: ['logistics-preferences'] });
    },
  });
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      {(Object.keys(labels) as (keyof Preferences)[]).map((key) => (
        <label className="checkbox-label" key={key}>
          <input
            type="checkbox"
            role="switch"
            checked={draft[key]}
            disabled={save.isPending}
            onChange={(event) => {
              setDraft({ ...draft, [key]: event.target.checked });
              save.reset();
              saved(false);
            }}
          />
          {labels[key]}
        </label>
      ))}
      <Button busy={save.isPending} disabled={JSON.stringify(draft) === JSON.stringify(initial)}>
        Save notification preferences
      </Button>
      {save.error && <ErrorState error={save.error} />}
    </form>
  );
}

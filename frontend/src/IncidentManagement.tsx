import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, get } from './api';
import { Button, Card, Field, ErrorState } from './components';
import type { Crisis } from './types';
export function IncidentManagement() {
  const [incidentId, setIncidentId] = useState(''),
    client = useQueryClient();
  const incidents = useQuery({
    queryKey: ['incidents'],
    queryFn: () => get<{ id: string; name: string; crises: Crisis[] }[]>('/incidents'),
  });
  const crises = useQuery({ queryKey: ['crises'], queryFn: () => get<Crisis[]>('/crises') });
  const write = useMutation({
    mutationFn: ({
      path,
      data,
      method = 'post',
    }: {
      path: string;
      data?: unknown;
      method?: 'post' | 'put' | 'delete';
    }) => api.request({ url: path, data, method }),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <Card>
      <h2>Cross-border incidents</h2>
      <p>
        Link national crises for coordination. Each country retains its own staff access and
        resources.
      </p>
      {write.error && <ErrorState error={write.error} />}
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          write.mutate({ path: '/incidents', data: { name: f.get('name') } });
        }}
      >
        <Field label="Incident name">
          <input name="name" required maxLength={150} />
        </Field>
        <Button busy={write.isPending}>Create incident</Button>
      </form>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          write.mutate({
            path: `/incidents/${incidentId}/crises/${f.get('crisisId')}`,
            method: 'put',
          });
        }}
      >
        <Field label="International incident">
          <select required value={incidentId} onChange={(e) => setIncidentId(e.target.value)}>
            <option value="">Select an incident</option>
            {incidents.data?.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="National crisis">
          <select name="crisisId" required>
            <option value="">Select a crisis in the selected country</option>
            {crises.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Button busy={write.isPending}>Link crisis</Button>
      </form>
      {incidents.data?.map((i) => (
        <div key={i.id}>
          <h3>{i.name}</h3>
          {i.crises.map((c) => (
            <p key={c.id}>
              {c.countryCode} · {c.name}{' '}
              <Button
                variant="ghost"
                onClick={() =>
                  write.mutate({ path: `/incidents/${i.id}/crises/${c.id}`, method: 'delete' })
                }
              >
                Unlink
              </Button>
            </p>
          ))}
        </div>
      ))}
    </Card>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, get } from './api';
import { Card, ErrorState, Field, Loading } from './components';
import { useCountry } from './geography';
import { useState } from 'react';

export default function DepotAssignments() {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Manage Logistics depot access</summary>
      {open && <AssignmentForm />}
    </details>
  );
}
function AssignmentForm() {
  const country = useCountry();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['depot-assignments', country],
    queryFn: () =>
      get<{
        assignments: { id: string; name: string; organisationId: string; depotId: string | null }[];
        depots: { id: string; name: string; organisationId: string }[];
      }>('/fulfillment/depot-assignments'),
  });
  const write = useMutation({
    mutationFn: ({ id, depotId }: { id: string; depotId: string | null }) =>
      api.put(`/fulfillment/assignments/${id}/depot`, { depotId }),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <Card>
      <h2>Logistics depot assignments</h2>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : (
        query.data.assignments.map((row) => (
          <Field key={row.id} label={row.name}>
            <select
              value={row.depotId ?? ''}
              disabled={write.isPending}
              onChange={(e) => write.mutate({ id: row.id, depotId: e.target.value || null })}
            >
              <option value="">All organisation depots</option>
              {query.data.depots
                .filter((d) => d.organisationId === row.organisationId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </Field>
        ))
      )}
      {write.error && <ErrorState error={write.error} />}
      {write.isSuccess && <p role="status">Depot assignment saved.</p>}
    </Card>
  );
}

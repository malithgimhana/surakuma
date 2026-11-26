import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { Button, DateInput, ErrorState, Field } from './components';
import { refreshCaseAfterWrite } from './crisisOperationsApi';

export default function AllocationPreparation({ caseId, id, quantity }: { caseId: string; id: string; quantity: number }) {
  const client = useQueryClient();
  const write = useMutation({
    mutationFn: (data: object) => api.post(`/fulfillment/allocations/${id}/prepare`, data),
    onSuccess: () => refreshCaseAfterWrite(client, caseId),
  });
  return (
    <details>
      <summary>Confirm packing and schedule arrival</summary>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const arrival = String(fields.get('arrival') ?? '');
          write.mutate({
            packedQuantity: quantity,
            note: fields.get('note'),
            scheduledArrivalAt: arrival ? new Date(arrival).toISOString() : null,
          });
        }}
      >
        <p>Packed quantity {quantity}</p>
        <Field label="Packing note">
          <input name="note" required maxLength={1000} />
        </Field>
        <Field label="Scheduled arrival">
          <DateInput type="datetime-local" name="arrival" />
        </Field>
        <Button busy={write.isPending}>Confirm packing</Button>
        {write.error && <ErrorState error={write.error} />}
      </form>
    </details>
  );
}

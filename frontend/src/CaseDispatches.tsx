import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, get } from './api';
import { Button, Card, ErrorState, Field, formatDate, Loading } from './components';
import { useCountry } from './geography';
import { isMeasuredUnit, unitSymbol } from './quantity';

export interface DispatchItem {
  id: string;
  name: string;
  unit: string;
  sent: number;
  atCentre: number | null;
  givenToCitizen: number | null;
  reportedQuantity?: number | null;
}

export interface CaseDispatch {
  id: string;
  reference: string;
  centre: string;
  centreLocation: string;
  sentAt: string;
  receivedAt: string | null;
  items: DispatchItem[];
  canReceive: boolean;
  availableForAssignment: boolean;
  volunteerStatus: string | null;
}

interface Centre { id: string; name: string; location: string }
interface DispatchPlan {
  centre: Centre | null;
  centres: Centre[];
  canPlan: boolean;
  dispatches: CaseDispatch[];
}

type Mode = 'citizen' | 'coordinator' | 'logistics' | 'volunteer-coordinator';

export function useCaseDispatches(id: string | undefined, mode: Mode, enabled: boolean) {
  const country = useCountry();
  return useQuery({
    queryKey: ['case-dispatches', country, id, mode],
    queryFn: () => get<DispatchPlan>(`/fulfillment/cases/${id}/dispatches`),
    enabled: !!id && enabled,
    refetchInterval: enabled ? 15000 : false,
  });
}

export function useVolunteerDispatch(taskId: string, enabled: boolean, reviewer = false) {
  const country = useCountry();
  return useQuery({
    queryKey: ['volunteer-dispatch', country, taskId, reviewer],
    queryFn: () => get<CaseDispatch>(`/fulfillment/volunteer-tasks/${taskId}/dispatch`),
    enabled,
  });
}

type PackedItem = { id: string; name: string; depot: string; quantity: number; unit: string };
type DispatchWrite = { action: 'plan'; centreId: string } | { action: 'send'; allocationIds: string[]; operationId: string } |
  { action: 'receive'; dispatchId: string; items: { allocationId: string; quantity: number }[]; note: string };

export function CaseDispatches({ id, mode, authorized, packed = [], selectedDispatchId }: {
  id: string;
  mode: 'citizen' | 'coordinator' | 'logistics';
  authorized?: boolean;
  packed?: PackedItem[];
  selectedDispatchId?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const plan = useCaseDispatches(id, mode, true);
  const selectedDispatch = useRef<HTMLElement>(null);
  const selectedDispatchLoaded = plan.data?.dispatches.some(dispatch => dispatch.id === selectedDispatchId);
  useEffect(() => {
    if (selectedDispatchLoaded) selectedDispatch.current?.focus();
  }, [selectedDispatchId, selectedDispatchLoaded]);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const write = useMutation({
    mutationFn: async (input: DispatchWrite) => {
      if (input.action === 'plan') {
        await api.put(`/fulfillment/cases/${id}/handover-centre`, { centreId: input.centreId });
      } else if (input.action === 'send') {
        await api.post(`/fulfillment/cases/${id}/dispatches`, {
        operationId: input.operationId, allocationIds: input.allocationIds,
        });
      } else {
        await api.post(`/fulfillment/dispatches/${input.dispatchId}/receive`, { items: input.items, note: input.note });
      }
    },
    onSuccess: async () => {
      setOperationId(crypto.randomUUID());
      await client.invalidateQueries();
    },
  });
  const date = (value: string) => formatDate(value, i18n.language);
  if (plan.isPending) return <Loading />;
  if (plan.error) return <ErrorState error={plan.error} retry={() => void plan.refetch()} />;
  const { centre, centres, canPlan, dispatches } = plan.data!;
  const title = t('caseDispatches.title', { defaultValue: 'Aid dispatches' });
  return <Card className="stack">
    <h2>{title}</h2>
    {mode === 'coordinator' && canPlan && <form className="stack" key={centre?.id} onSubmit={event => {
      event.preventDefault();
      const centreId = String(new FormData(event.currentTarget).get('centre') ?? '');
      if (centreId && !write.isPending) write.mutate({ action: 'plan', centreId });
    }}>
      {centres.length ? <>
        <Field label="Receiving centre for the next dispatch" hint="Choose a depot close to the citizen where a volunteer can collect the aid.">
          <select name="centre" defaultValue={centre?.id ?? ''} required>
            <option value="">Choose a receiving centre</option>
            {centres.map(option => <option key={option.id} value={option.id}>{option.name} · {option.location}</option>)}
          </select>
        </Field>
        <div><Button busy={write.isPending}>Save receiving centre</Button></div>
      </> : <p>No depots are registered for the assigned organisation. Ask logistics to register a receiving centre.</p>}
    </form>}
    {mode === 'logistics' && !centre && <p>Waiting for the Crisis Coordinator to select a receiving centre.</p>}
    {mode === 'logistics' && centre && <p>Receiving centre · <strong>{centre.name}</strong> · {centre.location}</p>}
    {mode === 'logistics' && centre && authorized && packed.length > 0 && (
      <form className="stack" onSubmit={event => {
        event.preventDefault();
        const allocationIds = new FormData(event.currentTarget).getAll('allocations').map(String);
        if (allocationIds.length && !write.isPending) write.mutate({ action: 'send', allocationIds, operationId });
      }}>
        <fieldset className="stack" disabled={write.isPending}>
          <legend>Packed items for the next dispatch</legend>
          {packed.map(row => <label key={row.id} className="checkbox-label">
            <input type="checkbox" name="allocations" value={row.id} defaultChecked
              onChange={() => setOperationId(crypto.randomUUID())} />
            {row.name} · {row.quantity} {unitSymbol(row.unit)} · {row.depot}
          </label>)}
          <div><Button busy={write.isPending}>Dispatch selected items to centre</Button></div>
        </fieldset>
      </form>
    )}
    {!dispatches.length && <p>{t('caseDispatches.none', { defaultValue: 'No items have been dispatched yet.' })}</p>}
    {dispatches.map(dispatch => {
      const allHandedOver = dispatch.items.every(item => (item.atCentre ?? 0) === (item.givenToCitizen ?? 0));
      const status = !dispatch.receivedAt ? ['onWay', 'On the way to the centre'] :
        !dispatch.items.some(item => (item.atCentre ?? 0) > 0) ? ['missing', 'No items received at the centre'] :
        allHandedOver ? ['verified', 'Citizen handover verified'] :
        dispatch.volunteerStatus === 'AwaitingVerification' ? ['review', 'Handover awaiting verification'] :
        dispatch.volunteerStatus ? ['assigned', 'Volunteer assigned'] : ['atCentre', 'At the centre, awaiting volunteer handover'];
      const selected = dispatch.id === selectedDispatchId;
      return <section className="stack" key={dispatch.id} aria-label={dispatch.reference}
        ref={selected ? selectedDispatch : undefined} tabIndex={selected ? -1 : undefined}>
        <h3>{dispatch.reference} · {dispatch.centre}</h3>
        <p><strong>{t(`caseDispatches.${status[0]}`, { defaultValue: status[1] })}</strong> · {date(dispatch.receivedAt ?? dispatch.sentAt)}</p>
        <ul>
          {dispatch.items.map(item => <li key={item.id}>
            {t(`intake.${item.name}`, { defaultValue: item.name })} · {item.sent} {unitSymbol(item.unit)}
            {' · '}{t('caseDispatches.sent', { defaultValue: 'sent' })}
            {item.atCentre != null && <> · {t('caseDispatches.centreAmount', {
              defaultValue: '{{quantity}} {{unit}} received at the centre', quantity: item.atCentre, unit: unitSymbol(item.unit),
            })}</>}
            {item.givenToCitizen != null && <> · {t('caseDispatches.citizenAmount', {
              defaultValue: '{{quantity}} {{unit}} handed to the citizen', quantity: item.givenToCitizen, unit: unitSymbol(item.unit),
            })}</>}
          </li>)}
        </ul>
        {mode === 'logistics' && !dispatch.receivedAt && !dispatch.canReceive &&
          <p>A Logistics officer assigned to {dispatch.centre} can record what arrived.</p>}
        {mode === 'logistics' && dispatch.canReceive && <details open={selected || undefined}>
          <summary>Record centre receipt</summary>
          <form className="stack" onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            if (!write.isPending) write.mutate({ action: 'receive', dispatchId: dispatch.id,
              items: dispatch.items.map(item => ({ allocationId: item.id, quantity: Number(form.get(item.id)) })),
              note: String(form.get('note') ?? '').trim() });
          }}>
            {dispatch.items.map(item => <Field key={item.id}
              label={`Received ${item.name} · ${unitSymbol(item.unit)} (${item.id.slice(0, 8)})`}>
              <input name={item.id} type="number" min={0} max={item.sent} step={isMeasuredUnit(item.unit) ? 0.01 : 1} required />
            </Field>)}
            <Field label="Receipt note" hint="Explain any quantities missing from the dispatch.">
              <textarea name="note" maxLength={1000} />
            </Field>
            <div><Button busy={write.isPending}>Confirm centre receipt</Button></div>
          </form>
        </details>}
      </section>;
    })}
    {write.error && <ErrorState error={write.error} />}
  </Card>;
}

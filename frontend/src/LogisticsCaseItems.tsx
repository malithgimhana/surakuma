import { useState } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleCheck, Droplet, Milk, Package, SprayCan, TriangleAlert, Utensils } from 'lucide-react';
import { api, get } from './api';
import { Button, Card, ErrorState, Field, Loading } from './components';
import type { Need } from './FulfillmentPlanning';
import { inventoryForCase, resourceCode, type DepotOption, type InventoryItem } from './logistics';
import { allocationLimit, allocationPath, groupAllocationSources, type AllocationSource } from './allocationSources';
import { quantityText, useLogisticsData, type FulfillmentItem } from './LogisticsUi';
import { OrganisationDialog } from './OrganisationDialog';
import { compatibleUnits, isMeasuredUnit, unitSymbol } from './quantity';
import type { AllocationRecommendations } from './types';

const itemIcons = new Map([
  ['baby formula', Milk],
  ['drinking water', Droplet],
  ['cooked meals or ready-to-eat food', Utensils],
  ['cleaning supplies', SprayCan],
]);
const singularUnits: Record<string, string> = { pieces: 'piece', packs: 'pack', cartons: 'carton' };
const itemQuantity = (quantity: number, unit: string) =>
  quantityText(quantity, quantity === 1 ? singularUnits[unit] ?? unit : unit);

export default function CaseItems({ id, crisisId, needs, authorized, centreHandover, onNotice }: {
  id: string;
  crisisId: string;
  needs: FulfillmentItem[];
  authorized: boolean;
  centreHandover?: boolean;
  onNotice: (message: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const stock = useLogisticsData();
  const hasTotals = needs.length > 0 && needs.every(need =>
    Number.isFinite(need.reservedQuantity) && Number.isFinite(need.inTransitQuantity));
  const balances = hasTotals ? needs.map(need => Math.max(0, Math.round((need.approvedQuantity - need.deliveredQuantity -
    need.reservedQuantity - need.inTransitQuantity) * 1e8) / 1e8)) : [];
  const rankings = useQueries({ queries: needs.map((need, index) => ({
    queryKey: ['case-item-ranking', id, need.id],
    queryFn: () => get<AllocationRecommendations>(`/requests/${id}/allocation-recommendations?needId=${need.id}`),
    enabled: hasTotals && authorized && balances[index] > 0,
  })) });
  if (!hasTotals) return <ErrorState error={new Error('Item allocation totals require the updated API.')} />;
  if (stock.error) return <ErrorState error={stock.error} />;
  if (!stock.data) return <Loading />;

  const inventory = inventoryForCase(stock.data, crisisId);
  const depots = stock.data.resourceRegistration?.depots ?? stock.data.depots;
  const items = needs.map((need, index) => {
    const remaining = balances[index];
    const ranking = rankings[index];
    const suggestions = ranking.data?.candidates.filter(candidate => candidate.transportAvailable);
    const positions = new Map(suggestions?.map((candidate, position) => [candidate.resourceId, position]));
    const compatible = inventory.filter(item => item.category === need.category && item.available > 0 &&
      item.transportAvailable && item.canShip !== false && compatibleUnits(item.unit, need.unit))
      .sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
    const sources = groupAllocationSources(compatible);
    return { need, remaining, ranking, suggestions, sources, stockRecords: compatible };
  });
  const selected = items.find(item => item.need.id === selectedId);
  return (
    <Card className="logistics-case-items">
      <h2>Item requirements and allocations</h2>
      <ul className="logistics-case-item-grid">
        {items.map(({ need, sources, remaining }) => {
          const Icon = itemIcons.get(need.name.toLowerCase()) ?? Package;
          return (
            <li className="logistics-case-item" key={need.id}>
              <span className="logistics-icon"><Icon size={29} aria-hidden="true" /></span>
              <div>
                <h3>{need.name}</h3>
                <dl className="logistics-case-item-quantities">
                  {need.requiredQuantity !== need.approvedQuantity &&
                    <div><dt>Required</dt><dd>{itemQuantity(need.requiredQuantity, need.unit)}</dd></div>}
                  <div><dt>Approved</dt><dd>{itemQuantity(need.approvedQuantity, need.unit)}</dd></div>
                  {need.reservedQuantity > 0 &&
                    <div><dt>Reserved</dt><dd>{itemQuantity(need.reservedQuantity, need.unit)}</dd></div>}
                  {need.inTransitQuantity > 0 &&
                    <div><dt>{centreHandover ? 'Committed to dispatch' : 'In transit'}</dt><dd>{itemQuantity(need.inTransitQuantity, need.unit)}</dd></div>}
                  {need.deliveredQuantity > 0 &&
                    <div><dt>Delivered</dt><dd>{itemQuantity(need.deliveredQuantity, need.unit)}</dd></div>}
                  <div><dt>Awaiting allocation</dt><dd>{itemQuantity(remaining, need.unit)}</dd></div>
                </dl>
                {authorized && remaining > 0 ? (
                  <div className="logistics-case-item-actions">
                    <StockMatch available={sources.length > 0} />
                    <button type="button" className="logistics-link" aria-haspopup="dialog"
                      aria-label={`Review stock for ${need.name}`} onClick={() => {
                        onNotice('');
                        setSelectedId(need.id);
                      }}>
                      Review stock <ArrowRight size={17} aria-hidden="true" />
                    </button>
                  </div>
                ) : remaining === 0 && <p className="logistics-case-item-settled">
                  {need.deliveredQuantity >= need.approvedQuantity ? 'Delivered' : 'Fully allocated'}
                </p>}
              </div>
            </li>
          );
        })}
      </ul>
      {selected && authorized && (
        <ReserveItemDialog key={selected.need.id} requestId={id} {...selected} depots={depots}
          onDismiss={() => setSelectedId(null)} onReserved={message => {
            setSelectedId(null);
            onNotice(message);
          }} />
      )}
    </Card>
  );
}

function StockMatch({ available }: { available: boolean }) {
  const Icon = available ? CircleCheck : TriangleAlert;
  return <span className="logistics-status logistics-case-pill" data-status={available ? 'Normal' : 'Low stock'}>
    <Icon size={17} aria-hidden="true" /> {available ? 'Compatible stock available' : 'No compatible stock'}
  </span>;
}

function ReserveItemDialog({ requestId, need, remaining, sources, stockRecords, depots, ranking, suggestions, onDismiss, onReserved }: {
  requestId: string;
  need: Need;
  remaining: number;
  sources: AllocationSource[];
  stockRecords: InventoryItem[];
  depots: DepotOption[];
  ranking: { data?: AllocationRecommendations; error: unknown; isFetching: boolean; refetch: () => unknown };
  suggestions?: AllocationRecommendations['candidates'];
  onDismiss: () => void;
  onReserved: (message: string) => void;
}) {
  const client = useQueryClient();
  const [resourceId, setResourceId] = useState('');
  const [quantityInput, setQuantityInput] = useState('');
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const source = sources.find(item => item.resourceIds.includes(resourceId));
  const step = source && isMeasuredUnit(source.unit) ? 0.01 : 1;
  const limit = source ? allocationLimit(source, remaining, need.unit) : 0;
  const quantity = Number(quantityInput);
  const validQuantity = quantity >= step && quantity <= limit && Number(quantity.toFixed(step === 1 ? 0 : 2)) === quantity;
  const reserve = useMutation({
    mutationFn: ({ quantity, source }: { quantity: number; source: AllocationSource }) => api.post(allocationPath(source), {
      requestId, needId: need.id, resourceId: source.id, quantity, operationId,
      recommendedResourceId: suggestions?.[0]?.resourceId,
    }),
    onSuccess: async (_, { quantity, source }) => {
      await client.invalidateQueries();
      onReserved(`${itemQuantity(quantity, source.unit)} reserved for ${need.name}.`);
    },
  });
  const evidence = ranking.data?.evidence;
  const records = new Map(stockRecords.map(item => [item.id, item]));
  const recommendations = new Map(suggestions?.map(candidate => [candidate.resourceId, candidate]));
  const depotLabel = (item: AllocationSource) => depots.find(depot => depot.id === item.depotId)?.name ?? item.locationText;
  const recordEvidence = (id: string) => {
    const record = records.get(id)!;
    const candidate = recommendations.get(id);
    return <><strong>{resourceCode(record)}</strong> · {itemQuantity(record.available, record.unit)}
      {candidate && <> · Score {candidate.score}. {candidate.reason}</>}</>;
  };
  return (
    <OrganisationDialog title={`Reserve ${need.name}`} context={`${itemQuantity(remaining, need.unit)} awaiting allocation`}
      className="logistics-reserve-item-dialog" busy={reserve.isPending} onDismiss={onDismiss}>
      <form className="logistics-reserve-item-form" onChange={() => setOperationId(crypto.randomUUID())}
        onSubmit={event => {
          event.preventDefault();
          if (source && validQuantity && !reserve.isPending) {
            reserve.mutate({ quantity, source });
          }
        }}>
        <StockMatch available={sources.length > 0} />
        <Field label="Stock source">
          <select required value={source?.id ?? ''} disabled={reserve.isPending || !sources.length}
            onChange={event => { setResourceId(event.target.value); setQuantityInput(''); }}>
            <option value="">Select item and depot</option>
            {sources.map(item => <option key={item.id} value={item.id}>
              {item.name} · {depotLabel(item)} · {itemQuantity(item.available, item.unit)}
              {item.resourceIds.some(id => id === suggestions?.[0]?.resourceId) ? ' · Recommended' : ''}
            </option>)}
          </select>
        </Field>
        <Field label={`Quantity (${unitSymbol(source?.unit ?? need.unit)})`} hint={source && (
          `${itemQuantity(source.available, source.unit)} available · Up to ${itemQuantity(limit, source.unit)} for this case`
        )}>
          <input name="quantity" type="number" min={step} step={step} value={quantityInput}
            onChange={event => setQuantityInput(event.target.value)}
            max={limit} required disabled={reserve.isPending || !source || limit <= 0} />
        </Field>
        {(sources.length > 0 || ranking.data || ranking.isFetching || ranking.error != null) && (
          <details className="logistics-match-evidence">
            <summary>Resource match evidence</summary>
            {ranking.isFetching && <p role="status">Ranking stock sources…</p>}
            {evidence && <p className="muted">{evidence.algorithm} · {evidence.source} · {evidence.processingState} · {evidence.reviewState}</p>}
            {ranking.data?.shortageExplanation && <p>{ranking.data.shortageExplanation}</p>}
            {sources.map(item => (
              <div key={item.id}>
                <p><strong>{item.name} · {depotLabel(item)}</strong> · {itemQuantity(item.available, item.unit)}
                  {item.resourceIds.length > 1 ? ` across ${item.resourceIds.length} stock records` : ' available'}</p>
                {item.resourceIds.length > 1 ? (
                  <details>
                    <summary>Inventory record breakdown</summary>
                    <ul>{item.resourceIds.map(id => <li key={id}>{recordEvidence(id)}</li>)}</ul>
                  </details>
                ) : <p>{recordEvidence(item.id)}</p>}
              </div>
            ))}
            {ranking.error != null && <ErrorState error={ranking.error} retry={() => void ranking.refetch()} />}
          </details>
        )}
        {reserve.error && <ErrorState error={reserve.error} retry={() => void client.invalidateQueries()} />}
        <div className="organisation-dialog-actions">
          <Button type="button" variant="secondary" disabled={reserve.isPending} onClick={onDismiss}>Cancel</Button>
          <Button type="submit" busy={reserve.isPending} disabled={!validQuantity}>Reserve item</Button>
        </div>
      </form>
    </OrganisationDialog>
  );
}

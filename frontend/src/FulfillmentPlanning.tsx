import { useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, get } from './api';
import { Button, Card, ErrorState, Field, categories, Loading } from './components';
import { WorkspaceDialog } from './OrganisationDialog';
import { ResourceUnitSelect } from './ResourceUnitSelect';
import { refreshCaseAfterWrite } from './crisisOperationsApi';
import { isMeasuredUnit } from './quantity';
import type { Status } from './types';
import './fulfillment-planning.css';

export interface Need {
  id: string;
  name: string;
  category: string;
  unit: string;
  requiredQuantity: number;
  approvedQuantity: number;
  deliveredQuantity: number;
}
export interface Plan {
  requiresCoordinatorAuthorization: boolean;
  authorizedAt: string | null;
  canEditNeeds: boolean;
  canAuthorize: boolean;
  items: Need[];
}

type EditableNeed = Omit<Need, 'id' | 'deliveredQuantity'> & { id?: string };

export type ItemReviewMode = 'closed' | 'open' | 'minimized';
type ItemReview = { mode: ItemReviewMode; onChange: (mode: ItemReviewMode) => void };

export default function FulfillmentPlanning({ id, caseStatus, editor }: { id: string; caseStatus: Status; editor?: ItemReview }) {
  const query = useQuery({
    queryKey: ['fulfillment-plan', id],
    queryFn: () => get<Plan>(`/fulfillment/cases/${id}`),
  });
  if (query.isPending)
    return (
      <Card>
        <Loading />
      </Card>
    );
  if (!query.data)
    return (
      <Card>
        <ErrorState error={query.error} />
      </Card>
    );
  if (!Array.isArray(query.data.items))
    return (
      <Card>
        <ErrorState error={new Error('Fulfillment data requires the updated API.')} />
      </Card>
    );
  return <PlanForm key={JSON.stringify(query.data)} id={id} plan={query.data} caseStatus={caseStatus} editor={editor} />;
}

function PlanForm({ id, plan, caseStatus, editor }: { id: string; plan: Plan; caseStatus: Status; editor?: ItemReview }) {
  const client = useQueryClient();
  const { t } = useTranslation();
  const restoreButton = useRef<HTMLButtonElement>(null);
  const itemList = useRef<HTMLDivElement>(null);
  const focusNewItem = useRef(false);
  useLayoutEffect(() => {
    if (editor?.mode === 'minimized') restoreButton.current?.focus();
  }, [editor?.mode]);
  const [items, setItems] = useState<EditableNeed[]>(
    plan.items.map(({ id, name, category, unit, requiredQuantity, approvedQuantity }) => ({
      id,
      name,
      category,
      unit,
      requiredQuantity,
      approvedQuantity,
    })),
  );
  useLayoutEffect(() => {
    if (!focusNewItem.current) return;
    focusNewItem.current = false;
    itemList.current?.querySelector<HTMLInputElement>('fieldset:last-of-type input')?.focus();
  }, [items.length]);
  const write = useMutation({
    mutationFn: (input: { action: string; data: unknown }) =>
      api.request({
        method: input.action === 'items' ? 'put' : 'post',
        url: `/fulfillment/cases/${id}/${input.action}`,
        data: input.data,
      }),
    onSuccess: async (_, { action }) => {
      if (action === 'items') editor?.onChange('closed');
      await refreshCaseAfterWrite(client, id, 'fulfillment-plan');
    },
  });
  const update = (index: number, changes: Partial<(typeof items)[number]>) =>
    setItems(items.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  const addItem = () => {
    focusNewItem.current = true;
    setItems([
      ...items,
      { name: '', category: 'FoodWater', unit: '', requiredQuantity: 1, approvedQuantity: 1 },
    ]);
  };
  const awaitingCaseApproval = ['Submitted', 'UnderReview', 'Verified'].includes(caseStatus);
  const itemForm = plan.canEditNeeds && (
    <form
      className={editor ? 'fulfillment-item-form' : 'stack'}
      onSubmit={(e) => {
        e.preventDefault();
        write.mutate({ action: 'items', data: { items } });
      }}
    >
      <div ref={itemList} className={editor ? 'fulfillment-item-list' : 'stack'}>
        {items.map((item, index) => {
          const previous = plan.items.find(
            (need) => need.id === item.id && need.category === item.category,
          );
          const minimum = isMeasuredUnit(item.unit) ? 0.01 : 1;
          return (
            <fieldset
              className={editor ? 'fulfillment-item-fields' : 'form-grid'}
              key={item.id ?? index}
              disabled={write.isPending}
            >
              <Field label="Item name">
                <input
                  required
                  maxLength={120}
                  value={item.name}
                  onChange={(e) => update(index, { name: e.target.value })}
                />
              </Field>
              <Field label="Category">
                <select
                  value={item.category}
                  onChange={(e) => update(index, { category: e.target.value, unit: '' })}
                >
                  {categories
                    .filter((c) => c !== 'Shelter')
                    .map((c) => (
                      <option key={c} value={c}>
                        {editor ? t('category.' + c) : c}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Unit">
                <ResourceUnitSelect
                  category={item.category}
                  existingUnit={previous?.unit}
                  value={item.unit}
                  onChange={(e) => update(index, { unit: e.target.value })}
                  required
                />
              </Field>
              <Field label="Required quantity">
                <input
                  type="number"
                  required
                  min={minimum}
                  max="10000000"
                  step={minimum}
                  value={item.requiredQuantity}
                  onChange={(e) => update(index, { requiredQuantity: Number(e.target.value) })}
                />
              </Field>
              <Field label="Approved quantity">
                <input
                  type="number"
                  required
                  min={minimum}
                  max="10000000"
                  step={minimum}
                  value={item.approvedQuantity}
                  onChange={(e) => update(index, { approvedQuantity: Number(e.target.value) })}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                aria-label={editor ? `Remove ${item.name || 'new item'}` : undefined}
                onClick={() => setItems(items.filter((_, i) => i !== index))}
              >
                {editor ? <Trash2 size={16} aria-hidden="true" /> : 'Remove item'}
              </Button>
            </fieldset>
          );
        })}
      </div>
      {editor && write.error && (
        <div className="fulfillment-item-error">
          <ErrorState error={write.error} />
        </div>
      )}
      <div className={editor ? 'fulfillment-item-actions' : 'stack'}>
        <Button type="button" variant="secondary" disabled={write.isPending} onClick={addItem}>
          Add case item
        </Button>
        {items.length > 0 && <Button busy={write.isPending}>Save reviewed items</Button>}
      </div>
      {editor && awaitingCaseApproval && <p className="muted">
        After saving, use <strong>Next Case Action</strong> to {caseStatus === 'Verified' ? 'approve' : 'verify and approve'} the case.
      </p>}
    </form>
  );
  return (
    <Card className={editor ? 'fulfillment-plan-summary stack' : 'stack'}>
      <div className="fulfillment-plan-heading">
        <div>
          <h2>{awaitingCaseApproval ? 'Fulfillment plan and requested items' : 'Fulfillment authorization & approved items'}</h2>
          <p>
            {awaitingCaseApproval
              ? 'Awaiting case approval from the Case Manager.'
              : plan.authorizedAt
              ? 'Coordinator authorization recorded.'
              : plan.requiresCoordinatorAuthorization
                ? 'Awaiting Coordinator authorization.'
                : 'This case uses its existing approval workflow.'}
          </p>
        </div>
        {editor && plan.canEditNeeds && (
          <Button
            type="button"
            variant="secondary"
            aria-haspopup="dialog"
            disabled={write.isPending}
            onClick={() => editor.onChange('open')}
          >
            <ClipboardList size={16} aria-hidden="true" /> Review items
          </Button>
        )}
      </div>
      {!editor && itemForm}
      {editor?.mode === 'open' && plan.canEditNeeds && (
        <WorkspaceDialog
          title="Review requested items"
          className="fulfillment-item-dialog"
          busy={write.isPending}
          onDismiss={() => editor.onChange('closed')}
          minimize={{ label: 'Minimize item review', onClick: () => editor.onChange('minimized') }}
        >
          {itemForm}
        </WorkspaceDialog>
      )}
      {editor?.mode === 'minimized' && plan.canEditNeeds && (
        <button
          ref={restoreButton}
          type="button"
          className="button secondary fulfillment-restore"
          aria-label="Restore item review"
          title="Restore item review"
          aria-haspopup="dialog"
          onClick={() => editor.onChange('open')}
        >
          <ClipboardList size={18} aria-hidden="true" />
        </button>
      )}
      {plan.canAuthorize && !plan.authorizedAt && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            write.mutate({
              action: 'authorize',
              data: { reason: new FormData(e.currentTarget).get('reason') },
            });
          }}
        >
          <Field label="Coordinator handoff reason">
            <input name="reason" required maxLength={1000} />
          </Field>
          <Button busy={write.isPending}>Authorize fulfillment</Button>
        </form>
      )}
      {editor?.mode !== 'open' && write.error && <ErrorState error={write.error} />}
    </Card>
  );
}

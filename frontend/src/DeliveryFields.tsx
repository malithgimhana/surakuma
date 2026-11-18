import { useState } from 'react';
import { Field } from './components';
import { isMeasuredUnit } from './quantity';

export function DeliveryFields({ quantity, unit, transfer = false }: { quantity: number; unit?: string; transfer?: boolean }) {
  const [confirmed, setConfirmed] = useState(String(quantity));
  return <>
    <Field label="Delivery reference"><input name="reference" required maxLength={100} /></Field>
    <Field label={unit ? `Confirmed quantity (${unit})` : 'Confirmed quantity'}>
      <input name="confirmedQuantity" type="number" min={0}
        step={unit && !isMeasuredUnit(unit) ? 1 : 0.01} max={quantity} value={confirmed}
        onChange={(event) => setConfirmed(event.target.value)} required />
    </Field>
    <Field label="Actual receipt or attempt time" hint="Leave blank to use the current time.">
      <input name="receivedAt" type="datetime-local" step={1} />
    </Field>
    <Field label={Number(confirmed) === 0 ? 'Staff member confirming the exception' : 'Receiving person or representative'}><input name="receivedBy" required maxLength={150} /></Field>
    <Field label="Confirmation method">
      <select name="method" required key={transfer || Number(confirmed) === 0 ? 'staff' : 'receipt'}>
        {!transfer && Number(confirmed) > 0 && <option value="RecipientAcknowledgment">Recipient acknowledgment</option>}
        <option value="ReceivingStaff">Authorized receiving staff</option>
      </select>
    </Field>
    <Field label="Delivery notes"><textarea name="note" maxLength={1000} /></Field>
    <Field label="Delivery exception details" hint={Number(confirmed) < quantity ? 'Explain the difference from the dispatched quantity.' : undefined}>
      <textarea name="exceptionDetail" required={Number(confirmed) < quantity} maxLength={1000} />
    </Field>
  </>;
}

export function deliveryInput(fields: FormData) {
  const receivedAt = fields.get('receivedAt');
  return {
    reference: fields.get('reference'),
    confirmedQuantity: Number(fields.get('confirmedQuantity')),
    receivedAt: receivedAt ? new Date(String(receivedAt)).toISOString() : null,
    receivedBy: fields.get('receivedBy'),
    method: fields.get('method'),
    note: fields.get('note'),
    exceptionDetail: fields.get('exceptionDetail'),
  };
}

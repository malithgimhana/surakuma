import { expect, type Page } from '@playwright/test';

export async function fulfillStock(page: Page, name: string, unit: string, quantity: number, reference: string) {
  const source = page.getByLabel('Stock source', { exact: true });
  const option = source.getByRole('option').filter({ hasText: name });
  await expect(option).toHaveCount(1);
  await source.selectOption(await option.getAttribute('value') as string);
  const amount = page.getByLabel(`Quantity (${unit})`, { exact: true });
  await expect(amount).toHaveAttribute('max', String(quantity));
  await amount.fill(String(quantity));
  await page.getByRole('button', { name: 'Reserve stock', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm packing & schedule' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason').fill('Counted and packed the reserved supplies.');
  await dialog.getByRole('button', { name: 'Confirm packing' }).click();
  await page.getByRole('button', { name: 'Dispatch packed stock' }).click();
  await dialog.getByLabel('Reason').fill('Handed the packed supplies to the delivery team.');
  await dialog.getByRole('button', { name: 'Dispatch stock' }).click();
  await page.getByRole('button', { name: 'Confirm delivery or exception' }).click();
  await dialog.getByLabel('Delivery reference').fill(reference);
  await dialog.getByLabel('Receiving person or representative').fill('Synthetic recipient');
  await dialog.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(dialog).toHaveCount(0);
}

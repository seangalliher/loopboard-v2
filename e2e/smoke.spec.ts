import { expect, test, type Locator } from '@playwright/test';

test('add a card, move it with its button, drag it to Done, and it is still in Done after a reload', async ({ page }) => {
  const title = 'Buy milk';
  await page.goto('/');

  const todo = page.getByRole('region', { name: 'To do', exact: true });
  const doing = page.getByRole('region', { name: 'Doing', exact: true });
  const done = page.getByRole('region', { name: 'Done', exact: true });
  const card = (column: Locator) => column.getByRole('heading', { name: title, level: 3, exact: true });

  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(card(todo)).toBeVisible();

  await page.getByRole('button', { name: `Move "${title}" to Doing`, exact: true }).click();
  await expect(card(doing)).toBeVisible();
  await expect(card(todo)).toHaveCount(0);

  await card(doing).dragTo(done);
  await expect(card(done)).toBeVisible();
  await expect(card(doing)).toHaveCount(0);

  await page.reload();
  await expect(card(done)).toBeVisible();
  await expect(card(todo)).toHaveCount(0);
  await expect(card(doing)).toHaveCount(0);
});

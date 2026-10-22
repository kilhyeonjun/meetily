import { test, expect, type Page } from '@playwright/test';

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/workspace?folderId=research');
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

test('last-row menu stays visible, opens a focused dialog and returns focus on Escape', async ({
  page,
}, testInfo) => {
  await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible();
  await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('workspace-1280.png') });
  const trigger = page.getByRole('button', {
    name: 'Actions for 제품 개선 아이디어 · Product ideas',
  });
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('[role=menu]')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Search destinations' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('move-dialog.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('move dialog starts at current folder, resets on reopen and moves only after confirmation', async ({
  page,
}) => {
  const trigger = page.getByRole('button', {
    name: 'Actions for 제품 개선 아이디어 · Product ideas',
  });
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Research', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'Design', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents))
    .toBe('auto');
  await expect(trigger).toBeFocused();
  await expect(page.getByText('제품 개선 아이디어 · Product ideas', { exact: true })).toBeVisible();
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Research', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'Design', exact: true }).check();
  await page.getByRole('button', { name: 'Move here', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('제품 개선 아이디어 · Product ideas', { exact: true })).toHaveCount(
    0,
  );
});

test('current location is explicit during creation and new document keeps that folder', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await expect(page.getByText('Created in Research', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('회의 준비 노트');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/meeting-details\?id=created-/);
  await page.getByRole('treeitem', { name: 'Research', exact: false }).first().click();
  await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible();
  await expect(page.getByText('회의 준비 노트', { exact: true })).toBeVisible();
});

test('800px app window keeps actions in bounds and long names do not widen the sidebar', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await expect(page.getByRole('button', { name: 'New meeting', exact: true })).toBeInViewport();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('workspace-800.png') });
});

test('wide sidebar keeps item actions visible in a narrow content pane', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/workspace?folderId=research&sidebar=480');
  const trigger = page.getByRole('button', {
    name: 'Actions for 제품 개선 아이디어 · Product ideas',
  });
  await expect(trigger).toBeVisible();
  const box = await trigger.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(800);
  await trigger.click();
  await expect(page.getByRole('menuitem', { name: 'Move', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('workspace-wide-sidebar.png') });
});

test('renames and removes a destination folder while keeping its document in Unfiled', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Actions for 제품 개선 아이디어 · Product ideas' })
    .click();
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click();
  await page.getByRole('radio', { name: 'Design', exact: true }).check();
  await page.getByRole('button', { name: 'Move here', exact: true }).click();
  const tree = page.getByRole('tree');
  await tree.getByRole('treeitem', { name: /^Design/ }).click();
  await tree.getByRole('button', { name: 'Actions for Design', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'New name' }).fill('Projects');
  await page.getByRole('textbox', { name: 'New name' }).press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await expect(
    tree.getByRole('button', { name: 'Actions for Projects', exact: true }),
  ).toBeFocused();
  await tree.getByRole('button', { name: 'Actions for Projects', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Remove folder', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Notes and recordings are kept.');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await tree.getByRole('treeitem', { name: 'Unfiled', exact: true }).click();
  await expect(page.getByText('제품 개선 아이디어 · Product ideas', { exact: true })).toBeVisible();
});

test('keyboard menu navigation reaches a trapped dialog and Escape restores the trigger', async ({
  page,
}) => {
  const trigger = page.getByRole('button', {
    name: 'Actions for API and deployment planning',
    exact: true,
  });
  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Move', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Search destinations' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

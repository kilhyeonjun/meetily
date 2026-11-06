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
  // No retry: the outgoing menu must unmount with the select, not after an
  // exit animation, or its dismiss layer can swallow the dialog's Escape.
  expect(await page.locator('[role=menu]').count()).toBe(0);
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('document properties add, persist, edit, delete and undo with accessible controls', async ({page}) => {
  await page.goto('/meeting-details?id=agenda');
  const header = page.locator('header[aria-label="Document properties"]');
  await expect(header.getByRole('button', {name: 'Add property', exact: true})).toBeEnabled();
  await header.getByRole('button', {name: 'Add property', exact: true}).click();
  const form = page.getByRole('form', {name: 'Add property', exact: true});
  await form.getByRole('textbox', {name: 'Property value'}).fill('https://notion.so/meeting');
  await form.getByRole('textbox', {name: 'Property label'}).fill('Notion');
  await form.getByRole('textbox', {name: 'Property value'}).press('Enter');
  await expect(header.getByRole('button', {name: 'notion.so', exact: true})).toBeVisible();
  await expect(header.getByRole('button', {name: 'notion.so', exact: true})).toHaveAttribute('title', 'https://notion.so/meeting');
  await expect(header.getByRole('button', {name: 'notion.so', exact: true}).locator('svg')).toHaveCSS('width', '14px');
  await page.reload();
  await expect(header.getByRole('button', {name: 'notion.so', exact: true})).toBeVisible();
  await header.getByRole('button', {name: 'Edit Notion', exact: true}).focus();
  await header.getByRole('button', {name: 'Edit Notion', exact: true}).click();
  const edit = page.getByRole('form', {name: 'Edit property', exact: true});
  await edit.getByRole('textbox', {name: 'Property label'}).fill('Meeting page');
  await edit.getByRole('textbox', {name: 'Property value'}).fill('https://team.notion.site/agenda');
  await edit.getByRole('button', {name: 'Save property', exact: true}).click();
  await expect(header.getByRole('button', {name: 'team.notion.site', exact: true})).toBeVisible();
  await header.getByRole('button', {name: 'Delete Meeting page', exact: true}).focus();
  await header.getByRole('button', {name: 'Delete Meeting page', exact: true}).click();
  await expect(header.getByRole('button', {name: 'team.notion.site', exact: true})).toHaveCount(0);
  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect(header.getByRole('button', {name: 'team.notion.site', exact: true})).toBeVisible();
  await page.reload();
  await expect(header.getByRole('button', {name: 'team.notion.site', exact: true})).toBeVisible();
});

test('detail title autosaves and searchable folder picker shows full paths', async ({page}) => {
  await page.goto('/meeting-details?id=agenda');
  const title = page.getByRole('textbox', {name: 'Document title'});
  await title.fill('Updated planning');
  await title.press('Enter');
  await expect(page.getByRole('status')).toContainText('Saved');
  await page.getByRole('button', {name: 'Document folder'}).click();
  await page.getByRole('combobox', {name: 'Search folders'}).fill('Weekly');
  await page.getByRole('option', {name: 'Research / Weekly planning', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Document folder'})).toContainText('Research / Weekly planning');
  await page.reload();
  await expect(title).toHaveValue('Updated planning');
  await expect(page.getByRole('button', {name: 'Document folder'})).toContainText('Research / Weekly planning');
  await title.fill('');
  await title.press('Tab');
  await expect(page.getByRole('alert')).toContainText('Title cannot be empty');
  await title.press('Escape');
  await expect(title).toHaveValue('Updated planning');
});

test('scheduled text reveals a focused editor, autosaves and clears to Empty', async ({page}) => {
  await page.goto('/meeting-details?id=agenda');
  const schedule = page.getByRole('button', {name: 'Edit scheduled time'});
  await expect(schedule).toHaveText('Empty');
  await schedule.click();
  const input = page.getByLabel('Scheduled time', {exact: true});
  await expect(input).toBeFocused();
  await input.fill('2026-11-06T09:30');
  await expect(input).toBeFocused();
  await page.getByRole('textbox', {name: 'Document title'}).focus();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(schedule).toHaveText('2026-11-06 09:30');
  await page.reload();
  await expect(schedule).toHaveText('2026-11-06 09:30');
  await schedule.click();
  await expect(input).toBeFocused();
  await input.press('Backspace');
  await expect(input).toHaveValue('');
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('workspace-fixture')!).documents.find((doc: {id: string}) => doc.id === 'agenda').scheduled_at)).not.toBeNull();
  await page.getByRole('textbox', {name: 'Document title'}).focus();
  await expect(schedule).toHaveText('2026-11-06 09:30');
  await page.reload();
  await expect(schedule).toHaveText('2026-11-06 09:30');
  await schedule.click();
  await input.fill('2026-12-01T10:45');
  await input.press('Escape');
  await expect(schedule).toHaveText('2026-11-06 09:30');
  await page.getByRole('button', {name: 'Clear scheduled time'}).click();
  await expect(schedule).toHaveText('Empty');
  await page.reload();
  await expect(schedule).toHaveText('Empty');
});

test('deletion undo toast is dismissed when navigating to a different document', async ({page}) => {
  await page.goto('/meeting-details?id=agenda');
  await page.getByRole('button', {name: 'Add property', exact: true}).click();
  const form = page.getByRole('form', {name: 'Add property', exact: true});
  await form.getByRole('textbox', {name: 'Property label'}).fill('Notion');
  await form.getByRole('textbox', {name: 'Property value'}).fill('https://notion.so/meeting');
  await form.getByRole('button', {name: 'Add property', exact: true}).click();
  const remove = page.getByRole('button', {name: 'Delete Notion', exact: true});
  await remove.focus(); await remove.click();
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toBeVisible();
  await page.getByRole('treeitem', {name: 'Research', exact: false}).first().click();
  await page.getByText('제품 개선 아이디어 · Product ideas', {exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Document title'})).toHaveValue('제품 개선 아이디어 · Product ideas');
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toHaveCount(0);
});

test('property form validates URLs and Notion paste prefills label', async ({page}) => {
  await page.goto('/meeting-details?id=agenda');
  await page.getByRole('button', {name: 'Add property', exact: true}).click();
  const form = page.getByRole('form', {name: 'Add property', exact: true});
  const value = form.getByRole('textbox', {name: 'Property value'});
  // Use a browser ClipboardEvent so the production paste handler receives DataTransfer.
  await value.evaluate(element => {
    const data = new DataTransfer(); data.setData('text', 'https://notion.so/meeting');
    element.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, clipboardData: data}));
  });
  await expect(form.getByRole('textbox', {name: 'Property label'})).toHaveValue('Notion');
  await value.fill('javascript:alert(1)');
  await value.press('Enter');
  await expect(form.getByRole('alert')).toHaveText('Enter a valid HTTP or HTTPS URL.');
  await form.getByRole('button', {name: 'Text', exact: true}).click();
  await value.fill('Project owner');
  await value.press('Enter');
  await expect(page.getByText('Project owner', {exact: true})).toBeVisible();
});

test('captures light and dark properties header states', async ({page}) => {
  await page.goto('/meeting-details?id=agenda');
  const header = page.locator('header[aria-label="Document properties"]');
  await expect(header.getByRole('button', {name: 'Add property', exact: true})).toBeEnabled();
  await expect(page.getByRole('textbox', {name: 'Document title'})).toHaveCSS('font-size', '30px');
  for (const mode of ['light', 'dark']) {
    await page.evaluate(mode => document.documentElement.classList.toggle('dark', mode === 'dark'), mode);
    await expect(header).toHaveCSS('background-color', mode === 'dark' ? 'rgb(10, 10, 10)' : 'rgb(255, 255, 255)');
    await header.screenshot({path: `/tmp/meetily-props-shots/${mode}-empty.png`, animations: 'disabled'});
  }
  for (const [label, url] of [['Notion', 'https://notion.so/meeting'], ['Project', 'https://example.com/project']]) {
    await header.getByRole('button', {name: 'Add property', exact: true}).click();
    const form = page.getByRole('form', {name: 'Add property', exact: true});
    await form.getByRole('textbox', {name: 'Property label'}).fill(label);
    await form.getByRole('textbox', {name: 'Property value'}).fill(url);
    await form.getByRole('button', {name: 'Add property', exact: true}).click();
    await expect(form).toHaveCount(0);
  }
  for (const mode of ['light', 'dark']) {
    await page.evaluate(mode => document.documentElement.classList.toggle('dark', mode === 'dark'), mode);
    await header.screenshot({path: `/tmp/meetily-props-shots/${mode}-two-links.png`, animations: 'disabled'});
    await header.getByRole('button', {name: 'Add property', exact: true}).click();
    await page.getByRole('textbox', {name: 'Property label'}).fill('Reference');
    await page.screenshot({path: `/tmp/meetily-props-shots/${mode}-add-popover.png`, animations: 'disabled'});
    await page.keyboard.press('Escape');
  }
});

import { expect, test } from 'playwright/test';

test('publishes the reusable UI catalog and interaction states', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/ui-kit');

  await expect(
    page.getByRole('heading', { name: '统一元素，稳定交互' }),
  ).toBeVisible();
  await expect(
    page.getByRole('table', { name: '设计系统表格示例' }),
  ).toBeVisible();

  const stageView = page.getByRole('button', { name: '按阶段' });
  await stageView.click();
  await expect(stageView).toHaveAttribute('aria-pressed', 'true');

  const search = page.getByRole('searchbox', { name: '组件搜索' });
  await expect(search).toHaveValue('需求');
  await page.getByRole('button', { name: '清除组件搜索' }).click();
  await expect(search).toHaveValue('');

  const primary = page.getByRole('button', { name: '新建需求' });
  await primary.focus();
  await expect(primary).toBeFocused();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const transitionDuration = await primary.evaluate(
    (element) => getComputedStyle(element).transitionDuration,
  );
  expect(transitionDuration).toBe('0s');
  expect(consoleErrors).toEqual([]);
});

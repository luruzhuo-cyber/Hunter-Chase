import { expect, test } from '@playwright/test';

test('starts, pauses, changes speed and regenerates map', async ({ page }) => {
  await page.goto('/?seed=1701', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('八个信号，只留一个')).toBeVisible();
  await page.getByRole('button', { name: '启动猎场' }).click();
  await expect(page.getByLabel('K-17 生存设施俯视图')).toBeVisible();
  await page.getByRole('button', { name: '2×' }).click();
  await page.keyboard.press('Space');
  const old = await page.getByText(/^种子 \d+$/).textContent();
  await page.getByRole('button', { name: '新地图' }).click();
  await expect(page.getByText(/^种子 \d+$/)).not.toHaveText(old!);
});

test('HUD and OBS modes keep the arena visible', async ({ page }) => {
  await page.goto('/?seed=9', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '启动猎场' }).click();
  await page.keyboard.press('h');
  await expect(page.getByLabel('K-17 生存设施俯视图')).toBeVisible();
  await page.keyboard.press('h');
  await page.getByRole('button', { name: 'OBS' }).click();
  await expect(page.getByLabel('K-17 生存设施俯视图')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '训练统计' })).toBeVisible();
});

import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) test(`captures every required visual state at ${viewport.width}x${viewport.height}`, async ({ page }) => {
  const size = `${viewport.width}x${viewport.height}`;
  await page.setViewportSize(viewport);
  await page.goto('/?seed=1701&testBeacon=1', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('K-17 生存设施俯视图')).toBeVisible();
  await page.screenshot({ path: `artifacts/visual-qa/overview-${size}.png`, fullPage: true });
  await page.getByRole('button', { name: '自动导演' }).click();
  await page.getByRole('button', { name: '启动猎场' }).click();
  await expect.poll(() => page.getByLabel('K-17 生存设施俯视图').getAttribute('data-beacons-rendered')).toBe('true');
  await page.screenshot({ path: `artifacts/visual-qa/beacon-diversion-${size}.png`, fullPage: true });

  await page.goto('/?seed=1701&testZone=final', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('第 6 圈')).toBeVisible();
  await page.getByRole('button', { name: 'OBS' }).click();
  await expect(page.locator('header')).toBeHidden();
  await page.screenshot({ path: `artifacts/visual-qa/final-zone-obs-${size}.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.locator('header')).toBeVisible();
});

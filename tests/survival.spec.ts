import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('presents the survival facility and advances interpolated actors', async ({ page }) => {
      await page.goto('/?seed=1701', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('map-size')).toHaveText('80 × 52');
      await expect(page.getByTestId('survivor-count')).toContainText('8');
      await expect(page.getByText(/终端/)).toHaveCount(0);
      await expect(page.getByLabel('策略选择')).toHaveValue('fallback');
      await expect(page.getByTestId('model-version')).toContainText('固定回退策略');
      await expect(page.getByRole('option', { name: /管线测试/ })).toHaveCount(1);
      const canvas = page.getByLabel('K-17 生存设施俯视图');
      await expect(canvas).toHaveAttribute('data-zone-visible', 'true');
      await expect(canvas).toHaveAttribute('data-tracks-rendered', 'false');
      await expect(canvas).toHaveAttribute('data-sound-rings-rendered', 'false');
      await page.getByRole('button', { name: '启动猎场' }).click();
      const before = await canvas.getAttribute('data-actor-pixels');
      await expect.poll(() => canvas.getAttribute('data-actor-pixels')).not.toBe(before);
    });

    test('keeps controls, skills and training statistics usable', async ({ page }) => {
      const smokeRequests: string[] = [];
      page.on('request', request => { if (request.url().includes('/models/smoke/') && request.url().includes('policy')) smokeRequests.push(request.url()); });
      await page.goto('/?seed=9', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(150);
      expect(smokeRequests).toHaveLength(0);
      await expect(page.getByTestId('runner-skill')).toHaveCount(8);
      await page.getByLabel('策略选择').selectOption('smoke');
      await expect(page.getByTestId('model-version')).toContainText('ppo-g0001');
      expect(smokeRequests.length).toBe(2);
      await page.getByRole('button', { name: '训练统计' }).click();
      await expect(page.getByRole('heading', { name: '训练统计' })).toBeVisible();
      await expect(page.getByText('中位存活时间')).toBeVisible();
      await expect(page.getByText('最终幸存率')).toBeVisible();
      await expect(page.getByText('技能使用率')).toBeVisible();
      await expect(page.getByText('技能后存活增益')).toBeVisible();
      await expect(page.getByRole('img', { name: '逃亡者奖励曲线' })).toBeVisible();
      await expect(page.getByRole('img', { name: '猎人奖励曲线' })).toBeVisible();
      await page.getByRole('button', { name: '返回观战' }).click();
      await page.getByRole('button', { name: '启动猎场' }).click();
      await expect(page.getByLabel('策略选择')).toBeDisabled();
      await page.getByRole('button', { name: '2×' }).click();
      await page.keyboard.press('Space');
      await page.keyboard.press('h');
      await expect(page.getByLabel('K-17 生存设施俯视图')).toBeVisible();
    });
  });
}

test('renders terminal outcomes without inventing a timeout winner', async ({ page }) => {
  await page.goto('/?seed=1701&testResult=timeout', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('result-reason')).toContainText('超时排名');
  await expect(page.getByTestId('winner-badge')).toHaveCount(0);
  await page.goto('/?seed=1701&testResult=last-survivor', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('result-reason')).toContainText('最后幸存者');
  await expect(page.getByTestId('winner-badge')).toBeVisible();
});





 test('uses current metrics for the safe default and explains local generation', async ({ page }) => {
  await page.goto('/?seed=1701', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '训练统计' }).click();
  await expect(page.getByRole('heading', { name: '尚未找到当前模型指标' })).toBeVisible();
  await expect(page.getByText(/public\/models\/current/)).toBeVisible();
 });


test('keeps training curves when only evaluation output is missing', async ({ page }) => {
  await page.route('**/models/current/metrics.json', route => route.fulfill({ json: {
    generations: [{ generation: 3, runner: { rewardCurve: [.1, .2] }, hunter: { rewardCurve: [-.1, .05] } }],
  } }));
  await page.route('**/models/current/evaluation.json', route => route.fulfill({ status: 404, body: 'missing' }));
  await page.goto('/?seed=1701', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '训练统计' }).click();
  await expect(page.getByRole('img', { name: '逃亡者奖励曲线' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '尚未找到评估指标' })).toBeVisible();
  await expect(page.getByText(/evaluate\.py --runner-policy \.\.\/public\/models\/current\/runner-policy\.json --hunter-policy \.\.\/public\/models\/current\/hunter-policy\.json --output \.\.\/public\/models\/current\/evaluation\.json/)).toBeVisible();
});

test('renders lighthouse beacon diversion without actor sound rings', async ({ page }) => {
  await page.goto('/?seed=1701&testBeacon=1', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '启动猎场' }).click();
  const canvas = page.getByLabel('K-17 生存设施俯视图');
  await expect.poll(() => canvas.getAttribute('data-beacons-rendered')).toBe('true');
  await expect(canvas).toHaveAttribute('data-sound-rings-rendered', 'false');
});

test('downloads, validates, imports and plays a V2 replay timeline', async ({ page }) => {
  await page.goto('/?seed=1701&testMaxTicks=3', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '启动猎场' }).click();
  await expect(page.getByTestId('result-reason')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出回放' }).click();
  const file = await (await download).createReadStream();
  const chunks: Buffer[]=[]; for await (const chunk of file!) chunks.push(Buffer.from(chunk));
  const replay=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(replay).toMatchObject({version:2,mapSeed:1701,inferenceSeed:1701,rulesVersion:'survival-v2'});
  expect(replay.frames).toHaveLength(3);
  expect(replay.rewardSummaries.hunter.total).toEqual(expect.any(Number));
  await page.getByLabel('导入 V2 回放').setInputFiles({name:'match.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(replay))});
  await expect(page.getByTestId('replay-status')).toContainText('V2 回放 0 / 3');
  await page.locator('.start-card').getByRole('button', { name: '播放回放' }).click();
  await expect(page.getByTestId('replay-status')).toContainText('3 / 3');
  await page.getByLabel('回放时间轴').fill('1');
  await expect(page.getByTestId('replay-status')).toContainText('1 / 3');
  await page.getByLabel('导入 V2 回放').setInputFiles({name:'old.json',mimeType:'application/json',buffer:Buffer.from('{"version":1,"seed":1}')});
  await expect(page.getByRole('alert')).toContainText('旧版回放');
});

test('finds a recorded Smoke policy bundle when importing from a fresh fallback session', async ({ page }) => {
  await page.goto('/?seed=1701&testMaxTicks=3', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('策略选择').selectOption('smoke');
  await expect(page.getByTestId('model-version')).toContainText('ppo-g0001');
  await page.getByRole('button', { name: '启动猎场' }).click();
  await expect(page.getByTestId('result-reason')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出回放' }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[]=[]; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  await page.goto('/?seed=9', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('策略选择')).toHaveValue('fallback');
  await page.getByLabel('导入 V2 回放').setInputFiles({name:'smoke.json',mimeType:'application/json',buffer:Buffer.concat(chunks)});
  await expect(page.getByTestId('replay-status')).toContainText('V2 回放 0 / 3');
  await expect(page.locator('.replay-strip small')).toContainText('已找到原策略模型');
  await expect(page.locator('.replay-strip small')).not.toContainText('缺失');
});

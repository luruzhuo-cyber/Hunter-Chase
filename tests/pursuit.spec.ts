import { test, expect } from '@playwright/test';

test('automatic pursuit baseline visibly runs, pauses, resets and hides controls', async ({page}) => {
  test.setTimeout(90000);
  await page.goto('/?mode=pursuit&seed=1701&map=01');
  await expect(page.getByRole('heading',{name:'自动追逃观战',exact:true})).toBeVisible();
  await expect(page.getByTestId('pursuit-controller')).toContainText('代码基线');
  await expect(page.getByTestId('pursuit-time-limit')).toContainText('03:20');
  await expect(page.getByLabel('猎人速度倍率',{exact:true})).toHaveValue('1.35');
  await expect(page.getByRole('button',{name:'开始比赛',exact:true})).toBeEnabled();
  const canvas=page.getByLabel('自动追逃设施俯视图');
  await expect(canvas).toHaveAttribute('data-actor-pixels',/H:/);
  const initial=await canvas.getAttribute('data-actor-pixels');
  await page.getByRole('button',{name:'开始比赛',exact:true}).click();
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
  await expect.poll(()=>canvas.getAttribute('data-tick'),{timeout:15000}).not.toBe('0');
  await expect.poll(()=>canvas.getAttribute('data-actor-pixels'),{timeout:15000}).not.toBe(initial);
  await expect(page.getByTestId('pursuit-target')).toBeVisible();
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  const pausedTick=await canvas.getAttribute('data-tick');
  await page.getByRole('button',{name:'全景',exact:true}).click();
  expect(await canvas.getAttribute('data-tick')).toBe(pausedTick);
  await page.getByRole('button',{name:'重新比赛',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-tick','0');
  await page.getByRole('button',{name:'OBS 录制',exact:true}).click();
  await expect(page.getByRole('heading',{name:'自动追逃观战',exact:true})).not.toBeVisible();
  await expect(canvas).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading',{name:'自动追逃观战',exact:true})).toBeVisible();
  await page.screenshot({path:'artifacts/pursuit-overview.png',fullPage:true});
});

test('real baseline pursuit produces captures, a last survivor and gameplay screenshots',async({page})=>{
  test.setTimeout(100000);
  await page.goto('/?mode=pursuit&map=08&seed=8');
  await expect(page.getByRole('button',{name:'开始比赛',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'4×',exact:true}).click();
  await page.getByRole('button',{name:'开始比赛',exact:true}).click();
  const canvas=page.getByLabel('自动追逃设施俯视图');
  await expect.poll(async()=>Number(await canvas.getAttribute('data-captures')),{timeout:80000}).toBeGreaterThan(0);
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.getByRole('button',{name:'全景',exact:true}).click();
  await expect(canvas).toBeVisible();
  await page.screenshot({path:'artifacts/pursuit-live-capture.png',fullPage:true});
  await page.getByRole('button',{name:'继续',exact:true}).click();
  await expect.poll(async()=>Number(await canvas.getAttribute('data-captures')),{timeout:80000}).toBe(7);
  await expect(page.getByRole('heading',{name:/号最后幸存/})).toBeVisible();
  await page.screenshot({path:'artifacts/pursuit-real-result.png',fullPage:true});
});

test('map and speed configuration remain usable at 1280x720', async ({page}) => {
  await page.setViewportSize({width:1280,height:720});
  await page.goto('/?mode=pursuit&map=02&seed=2026');
  await expect(page.getByLabel('地图',{exact:true})).toHaveValue('02');
  await page.getByLabel('猎人速度倍率',{exact:true}).fill('1.5');
  await page.getByRole('button',{name:'开始比赛',exact:true}).click();
  await expect(page.getByTestId('pursuit-controller')).toContainText('1.50');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth',1280);
});

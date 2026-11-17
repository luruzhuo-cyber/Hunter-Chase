import {test,expect} from '@playwright/test';

test('monitor settings fold away on start and audio settings do not reset the match',async({page})=>{
 await page.goto('/?mode=demon&map=01&seed=1701');
 await expect(page.getByRole('heading',{name:'气运之子',exact:true})).toBeVisible();
 await expect(page.getByLabel('比赛种子',{exact:true})).toHaveValue('1701');
 await expect(page.getByLabel('环境音量',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'开始比赛',exact:true}).click();
 await expect(page.getByLabel('比赛种子',{exact:true})).not.toBeVisible();
 await expect.poll(async()=>Number(await page.locator('canvas').getAttribute('data-tick'))).toBeGreaterThan(0);
 await page.getByRole('button',{name:'监控设置',exact:true}).click();
 const tick=Number(await page.locator('canvas').getAttribute('data-tick'));
 await expect(page.getByLabel('比赛种子',{exact:true})).toBeDisabled();
 await page.getByLabel('环境音量',{exact:true}).fill('0.1');
 await page.getByLabel('追逐音量',{exact:true}).fill('0.2');
 await expect.poll(async()=>Number(await page.locator('canvas').getAttribute('data-tick'))).toBeGreaterThanOrEqual(tick);
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 await expect(page.getByLabel('环境音量',{exact:true})).not.toBeVisible();
});

test('sound preview does not start simulation and recording mode retains the facility',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/?mode=demon&seed=1701');
 await page.getByRole('button',{name:'试听音效',exact:true}).click();
 await expect(page.locator('canvas')).toHaveAttribute('data-tick','0');
 await page.getByLabel('氛围动画',{exact:true}).uncheck();
 await page.getByRole('button',{name:'开始比赛',exact:true}).click();
 await page.getByRole('button',{name:'OBS 录制',exact:true}).click();
 await expect(page.locator('.demon-app')).toHaveClass(/demon-obs/);
 await expect(page.locator('canvas')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'监控设置',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});

test('monitor fits a narrow sidebar without horizontal document scrolling',async({page})=>{
 await page.setViewportSize({width:430,height:820});
 await page.goto('/?mode=demon&seed=1701');
 await expect(page.getByRole('button',{name:'开始比赛',exact:true})).toBeVisible();
 await expect(page.locator('body')).toHaveJSProperty('scrollWidth',430);
});

test('H shortcut still works after a playback control receives keyboard focus',async({page})=>{
 await page.goto('/?mode=demon&seed=1701');
 await page.getByRole('button',{name:'开始比赛',exact:true}).click();
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.keyboard.press('h');
 await expect(page.locator('.demon-app')).toHaveClass(/demon-no-hud/);
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'监控设置',exact:true})).toBeVisible();
});

import {test,expect} from '@playwright/test';

test('ten consecutive demon restarts clear ticks captures and old state',async({page})=>{
 test.setTimeout(60000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/?mode=demon&map=01&seed=1701');
 for(let i=0;i<10;i++){
  await expect(page.getByRole('button',{name:'开始比赛',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'开始比赛',exact:true}).click();
  await page.getByRole('button',{name:'4×',exact:true}).click();
  await expect.poll(async()=>Number(await page.locator('canvas').getAttribute('data-tick'))).toBeGreaterThanOrEqual(10);
  await expect(page.locator('canvas')).toHaveAttribute('data-captures','0');
  await page.getByRole('button',{name:'重新比赛',exact:true}).click();
  await expect(page.locator('canvas')).toHaveAttribute('data-tick','0');
  await expect(page.locator('canvas')).toHaveAttribute('data-stage','1');
 }
 expect(errors).toEqual([]);
});

test('records actual white-facility gameplay and second-stage result',async({page})=>{
 test.setTimeout(100000);
 await page.goto('/?mode=demon&map=01&seed=1701');
 await page.getByRole('button',{name:'4×',exact:true}).click();
 await page.getByRole('button',{name:'开始比赛',exact:true}).click();
 await expect(page.locator('canvas')).toHaveAttribute('data-phase','chase',{timeout:10000});
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.screenshot({path:'artifacts/demon-playing-1920.png',fullPage:true});
 await page.getByRole('button',{name:'继续',exact:true}).click();
 await expect(page.locator('canvas')).toHaveAttribute('data-stage','2',{timeout:40000});
 await page.screenshot({path:'artifacts/demon-stage2-1920.png',fullPage:true});
 await expect(page.getByTestId('demon-result')).toBeVisible({timeout:60000});
 await page.screenshot({path:'artifacts/demon-result-1920.png',fullPage:true});
 await page.setViewportSize({width:1280,height:720});
 await page.getByRole('button',{name:'重新比赛',exact:true}).click();
 await expect(page.getByRole('button',{name:'开始比赛',exact:true})).toBeEnabled();
 await page.screenshot({path:'artifacts/demon-1280.png',fullPage:true});
});

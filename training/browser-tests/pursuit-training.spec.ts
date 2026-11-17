import {test,expect} from '@playwright/test';

test('creates and trains an explicit PPO pursuit V2 task against smart escaping runners',async({page})=>{
  test.setTimeout(120000);
  await page.goto('http://127.0.0.1:8766/');
  await page.locator('#create [name=protocol]').selectOption('hunter-pursuit-v2');
  await page.locator('#create [name=name]').fill('PPO追逃V2短流程');
  await page.locator('#create [name=steps]').fill('16');
  await page.locator('#create [name=max_ticks]').fill('10');
  await page.getByRole('button',{name:'创建实验',exact:true}).click();
  await expect(page.locator('#state')).toHaveText('已创建');
  await expect(page.locator('#protocol-metadata')).toContainText('追逃 V2');
  await expect(page.locator('#protocol-metadata')).toContainText('冻结智能逃跑基线');
  await page.getByRole('button',{name:'开始训练',exact:true}).click();
  await expect(page.locator('#state')).toHaveText('运行中');
  await expect(page.locator('#state')).toHaveText('已完成',{timeout:90000});
  await page.getByRole('button',{name:'查看完整配置',exact:true}).click();
  await expect(page.locator('#log')).toContainText('side=hunter');
  await expect(page.locator('#task-details')).toContainText('hunter-pursuit-v2');
});

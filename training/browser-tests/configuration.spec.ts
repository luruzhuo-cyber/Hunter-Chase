import {test,expect} from '@playwright/test';

test('edits an existing draft configuration without polling overwriting inputs',async({page})=>{
  await page.goto('http://127.0.0.1:8766/');
  await page.locator('#create [name=name]').fill(`参数编辑-${Date.now()}`);
  await page.getByRole('button',{name:'创建实验',exact:true}).click();
  await expect(page.locator('#state')).toHaveText('已创建');
  const before=await page.getByTestId('config-summary').innerText();
  await page.getByRole('button',{name:'查看完整配置',exact:true}).click();
  await page.locator('#edit-config [name=steps]').fill('123456');
  await page.locator('#edit-config [name=generations]').fill('4');
  await page.locator('#edit-config [name=seed]').fill('2026');
  await page.locator('#edit-config [name=hunter_speed_ratio]').fill('1.5');
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(page.locator('#edit-config [name=steps]')).toHaveValue('123456');
  await page.getByRole('button',{name:'保存配置',exact:true}).click();
  await expect(page.locator('#config-feedback')).toContainText('配置已保存');
  await expect(page.getByTestId('config-summary')).toContainText('123456 步');
  await expect(page.getByTestId('config-summary')).toContainText('4 轮');
  await expect(page.getByTestId('config-summary')).toContainText('种子 2026');
  await expect(page.getByTestId('config-summary')).toContainText('1.5 倍');
  expect((await page.getByTestId('config-summary').innerText()).split(' · ')[0]).toBe(before.split(' · ')[0]);
});

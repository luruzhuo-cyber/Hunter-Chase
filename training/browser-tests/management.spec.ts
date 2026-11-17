import {test,expect} from '@playwright/test';

test('names, inspects, renames, archives and restores a task',async({page})=>{
  await page.goto('http://127.0.0.1:8766/');
  const name=`任务管理验证-${Date.now()}`;
  await page.locator('#create [name=name]').fill(name);
  await page.locator('#create [name=steps]').fill('12345');
  await page.locator('#create [name=generations]').fill('3');
  await page.locator('#create [name=seed]').fill('42');
  await page.getByRole('button',{name:'创建实验',exact:true}).click();
  await expect(page.locator('#title')).toHaveText(name);
  await expect(page.getByTestId('config-summary')).toContainText('12345 步');
  await expect(page.getByTestId('config-summary')).toContainText('3 轮');
  await expect(page.getByTestId('config-summary')).toContainText('种子 42');
  await page.getByRole('button',{name:'查看完整配置',exact:true}).click();
  await expect(page.locator('#task-details')).toContainText('12345');
  await page.getByLabel('修改任务名称',{exact:true}).fill(name+'改名');
  await page.getByRole('button',{name:'保存名称',exact:true}).click();
  await expect(page.locator('#title')).toHaveText(name+'改名');
  await page.getByRole('button',{name:'删除任务（可恢复）',exact:true}).click();
  await expect(page.locator('#runList')).not.toContainText(name);
  await page.getByText('任务回收站',{exact:true}).click();
  const archived=page.locator('#archived-list > div').filter({hasText:name+'改名'});
  await expect(archived).toBeVisible();
  await archived.getByRole('button',{name:'恢复任务',exact:true}).click();
  await page.locator('#runList button').filter({hasText:name+'改名'}).click();
  await expect(page.getByTestId('config-summary')).toContainText('12345 步');
  await expect(page.locator('#title')).toHaveText(name+'改名');
});

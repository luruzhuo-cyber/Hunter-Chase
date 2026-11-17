import {test,expect} from '@playwright/test';
test('retired energy mode falls back to working hunter page',async({page})=>{await page.goto('/?mode=heist');await expect(page.getByRole('status')).toContainText('双队夺能已撤下');await expect(page.getByRole('button',{name:'启动猎场',exact:true})).toBeVisible()});

import { test, expect } from '@playwright/test';

const summary={episodeCount:20,capture7CompletionRate:.6,meanCaptures:5.2,medianFirstCaptureSeconds:12,medianCapture7Seconds:135,timeouts:8,motion:{effectiveWindows:140,idleWindows:40,spinningWindows:20,totalWindows:200,blockedTicks:15},perMap:Array.from({length:10},(_,i)=>({id:String(i+1).padStart(2,'0'),episodes:2,successes:i<6?2:0,completionRate:i<6?1:0,meanCaptures:5.2,medianFirstCaptureSeconds:12,medianCapture7Seconds:i<6?135:null,timeouts:i<6?0:2}))};
const run={id:'phase1-dashboard-test',status:'completed',kind:'training',config:{protocol:'hunter-phase1',steps:250000,generations:1,seed:1701,max_ticks:3600,hunter_speed_ratio:1.35},resumable:true,metrics:{generations:[{generation:1}],trainingProtocol:'hunter-capture7-v1',rewardVersion:'capture7-time-motion-v1',mapPool:Array.from({length:10},(_,i)=>({id:String(i+1).padStart(2,'0'),sha256:'a'.repeat(64)}))},live:{generation:1,side:'hunter',phaseSteps:128,totalSteps:128,requestedSteps:250000,fps:100,episodes:20,phase1Summary:summary,diagnostics:{'train/approx_kl':.01}},history:[],historyTotal:0,historyTruncated:false,log:'training complete',evaluation:null};

test('phase1 dashboard separates sampled training evidence and independent scores',async({page})=>{
  await page.route('**/api/runs',route=>route.fulfill({json:[run]}));
  await page.goto('http://127.0.0.1:8766/');
  await expect(page.locator('#create [name=protocol]')).toHaveValue('hunter-phase1');
  await expect(page.locator('#create [name=hunter_speed_ratio]')).toHaveValue('1.35');
  await page.locator('.run').filter({hasText:run.id}).click();
  await expect(page.getByTestId('training-completion')).toContainText('60.0%');
  await expect(page.getByTestId('training-completion')).toContainText('12 / 20');
  await expect(page.getByTestId('training-map-table').locator('tbody tr')).toHaveCount(10);
  await expect(page.getByTestId('independent-status')).toContainText('尚无独立评估');
  await expect(page.getByTestId('protocol-metadata')).toContainText('1.35');
  await page.getByRole('button',{name:'独立评估',exact:true}).click();
  await expect(page.getByRole('heading',{name:'独立测试',exact:true})).toBeVisible();
  await expect(page.locator('#evalSide')).toBeDisabled();
  await page.getByRole('button',{name:'训练诊断',exact:true}).click();
  await expect(page.locator('#history-note')).toContainText('采样');
  await expect(page.locator('#outcomes')).toContainText('技能关闭，不统计使用率');
});

test('independent map panel shows failures and missing capture time honestly',async({page})=>{
  const evaluation={...summary,trainingProtocol:'hunter-capture7-v1',rewardVersion:'capture7-time-motion-v1',hunterSpeedRatio:1.35,runnerPolicy:'frozen-waypoint-v1',seeds:[900001,900002],maxTicks:3600,determinismVerified:true,runners:[],mapPool:run.metrics.mapPool};
  await page.route('**/api/runs',route=>route.fulfill({json:[{...run,evaluation}]}));
  await page.goto('http://127.0.0.1:8766/');
  await page.locator('.run').filter({hasText:run.id}).click();
  await page.getByRole('button',{name:'独立评估',exact:true}).click();
  await expect(page.getByTestId('evaluation-completion')).toContainText('60.0%');
  await expect(page.getByTestId('evaluation-map-table').locator('tbody tr')).toHaveCount(10);
  await expect(page.getByTestId('evaluation-map-table').locator('tbody tr').last()).toContainText('暂无成功局');
  await expect(page.getByTestId('evaluation-failures')).toContainText('8');
});

test('unobserved episodes and maps are not presented as zero scores',async({page})=>{
  const empty={...summary,episodeCount:0,capture7CompletionRate:null,meanCaptures:null,perMap:summary.perMap.map(row=>({...row,episodes:0,successes:0,completionRate:null,meanCaptures:null}))};
  await page.route('**/api/runs',route=>route.fulfill({json:[{...run,live:{...run.live,phase1Summary:empty}}]}));
  await page.goto('http://127.0.0.1:8766/');
  await page.locator('.run').filter({hasText:run.id}).click();
  await expect(page.getByTestId('training-completion')).toContainText('等待完整局');
  await expect(page.getByTestId('training-completion')).not.toContainText('0.0%');
  await expect(page.getByTestId('training-map-table').locator('tbody tr').first()).toContainText('未覆盖');
});

for(const viewport of [{width:1920,height:1080},{width:1280,height:720}]){
  test(`renders phase1 dashboard at ${viewport.width}x${viewport.height}`,async({page})=>{
    await page.setViewportSize(viewport);
    await page.route('**/api/runs',route=>route.fulfill({json:[run]}));
    await page.goto('http://127.0.0.1:8766/');
    await page.locator('.run').filter({hasText:run.id}).click();
    await expect(page.getByTestId('training-completion')).toBeVisible();
    await expect(page.getByTestId('training-map-table').locator('tbody tr')).toHaveCount(10);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth',await page.evaluate(()=>document.documentElement.clientWidth));
    await page.screenshot({path:`artifacts/phase1-dashboard-${viewport.width}x${viewport.height}.png`,fullPage:true});
  });
}

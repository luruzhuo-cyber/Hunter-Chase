import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';

test('exports actual synthesized audio and records presentation screenshots',async({page})=>{
 test.setTimeout(90000);mkdirSync('artifacts',{recursive:true});
 await page.addInitScript(()=>{
  const state=window as any;state.__labAudioChunks=[];
  const original=AudioNode.prototype.connect;
  (AudioNode.prototype as any).connect=function(destination:any,...args:any[]){
   const result=(original as any).call(this,destination,...args);
   if(destination===this.context.destination&&!state.__labRecorder){
    const media=this.context.createMediaStreamDestination();(original as any).call(this,media);
    const recorder=new MediaRecorder(media.stream);state.__labRecorder=recorder;state.__labContext=this.context;
    recorder.ondataavailable=e=>{if(e.data.size)state.__labAudioChunks.push(e.data)};recorder.start();
   }return result;
  };
 });
 await page.goto('/?mode=demon&map=01&seed=1701');
 await expect(page.locator('canvas')).toHaveAttribute('data-actor-pixels',/01:/);
 await page.screenshot({path:'artifacts/lab-ready-1920.png',fullPage:true});
 for(const [kind,delay] of [['summon',1400],['capture',850],['sprint',750],['decoy',1000],['phase',850],['lock',800],['finished',1400]] as const){
  await page.getByLabel('音效类型',{exact:true}).selectOption(kind);
  await page.getByRole('button',{name:'试听音效',exact:true}).click();
  await page.waitForTimeout(delay);
 }
 await expect(page.locator('canvas')).toHaveAttribute('data-tick','0');
 const recorded=await page.evaluate(async()=>{
  const state=window as any;
  await new Promise<void>(resolve=>{state.__labRecorder.onstop=()=>resolve();state.__labRecorder.stop()});
  const data=await new Blob(state.__labAudioChunks).arrayBuffer();
  const buffer=await state.__labContext.decodeAudioData(data);
  return {rate:buffer.sampleRate,samples:Array.from(buffer.getChannelData(0)) as number[]};
 });
 const peak=recorded.samples.reduce((n,x)=>Math.max(n,Math.abs(x)),0);
 expect(peak).toBeGreaterThan(.001);expect(peak).toBeLessThan(.99);
 const wav=Buffer.alloc(44+recorded.samples.length*2);
 wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(recorded.rate,24);wav.writeUInt32LE(recorded.rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 recorded.samples.forEach((x,i)=>wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,x))*32767),44+i*2));
 writeFileSync('artifacts/lab-sound-preview.wav',wav);
 writeFileSync('artifacts/lab-audio-check.json',JSON.stringify({sampleRate:recorded.rate,durationSeconds:recorded.samples.length/recorded.rate,peak,cues:['summon','capture','sprint','decoy','phase','lock','finished'],note:'Captured actual Web Audio preview output; no microphone or user audio.'},null,2));
 await page.getByRole('button',{name:'开始比赛',exact:true}).click();
 await page.getByRole('button',{name:'4×',exact:true}).click();
 await expect(page.locator('canvas')).toHaveAttribute('data-phase','chase',{timeout:10000});
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.screenshot({path:'artifacts/lab-chase-1920.png',fullPage:true});
 await page.getByRole('button',{name:'继续',exact:true}).click();
 await expect(page.locator('canvas')).toHaveAttribute('data-stage','2',{timeout:40000});
 await page.screenshot({path:'artifacts/lab-stage2-1920.png',fullPage:true});
 await expect(page.getByTestId('demon-result')).toBeVisible({timeout:60000});
 await page.screenshot({path:'artifacts/lab-result-1920.png',fullPage:true});
 await page.setViewportSize({width:1280,height:720});
 await page.getByRole('button',{name:'重新比赛',exact:true}).click();
 await expect(page.getByRole('button',{name:'开始比赛',exact:true})).toBeEnabled();
 await expect(page.locator('canvas')).toHaveAttribute('data-actor-pixels',/01:/);
 await page.screenshot({path:'artifacts/lab-ready-1280.png',fullPage:true});
});

test('measures real animation frame intervals during a live chase',async({page})=>{
 test.setTimeout(60000);await page.goto('/?mode=demon&map=01&seed=1701');
 await page.getByRole('button',{name:'开始比赛',exact:true}).click();
 await expect(page.locator('canvas')).toHaveAttribute('data-phase','chase',{timeout:20000});
 const times=await page.evaluate(()=>new Promise<number[]>(resolve=>{const xs:number[]=[];let last=performance.now();const frame=(now:number)=>{xs.push(now-last);last=now;if(xs.length>=300)resolve(xs.slice(1));else requestAnimationFrame(frame)};requestAnimationFrame(frame)}));
 const sorted=times.slice().sort((a,b)=>a-b),report={viewport:'1920x1080',mode:'automatic near camera, atmosphere on, 1x, headless Chromium',frames:times.length,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],over50msRate:times.filter(t=>t>50).length/times.length};
 mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/lab-frame-times.json',JSON.stringify(report,null,2));
 expect(times.every(t=>Number.isFinite(t)&&t>=0)).toBe(true);
 await expect(page.locator('canvas')).toHaveAttribute('data-phase','chase');
});

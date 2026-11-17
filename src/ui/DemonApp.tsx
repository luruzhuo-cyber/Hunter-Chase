import {useEffect,useRef,useState} from 'react';
import {createDemonMatch,stepDemonMatch,advanceDemonTransition} from '../sim/demon';
import type {DemonMatch,DemonItem,DemonEvent} from '../sim/demon/types';
import type {SurvivalMap} from '../sim/survival/map';
import {DemonCanvas,BALL_COLORS} from './DemonCanvas';
import {DemonAudio,type DemonAudioMix} from './DemonAudio';
import './demon.css';
const ids=Array.from({length:10},(_,i)=>String(i+1).padStart(2,'0'));
const query=new URLSearchParams(location.search);
const items:Record<DemonItem,string>={sprint:'冲刺',decoy:'诱饵信标',phase:'穿墙符',lock:'封门器'};
const glyphs:Record<DemonItem,string>={sprint:'»',decoy:'◇',phase:'↗',lock:'⊓'};
const stamp=(ticks:number)=>`${String(Math.floor(ticks/600)).padStart(2,'0')}:${(ticks/10%60).toFixed(1).padStart(4,'0')}`;
const eventText=(e:DemonEvent)=>{const who=e.actorId?`${e.actorId} 号`:'';switch(e.type){case 'pickup':return `${who} 获得${e.item?items[e.item]:'道具'}`;case 'item-use':return `${who} 使用${e.item?items[e.item]:'道具'}`;case 'capture':return `${who} 的生命信号消失`;case 'summon':return '隔离失效，恶魔降临';case 'transition':return `${e.alive??''} 名幸存者正在前往下一层`;case 'stage-start':return '进入第二层，重新选择房间';case 'last-two':return '最后两人仍在设施内';case 'finished':return '本场观测结束';case 'closure-warning':return '外围区域将在 3 秒后封闭';case 'closure':return '外围区域已封闭';default:return '共同入口开放，选择房间搜取物资'}};
type Scene={match:DemonMatch;previous:DemonMatch;at:number};
type Preview='summon'|'capture'|'sprint'|'decoy'|'phase'|'lock'|'finished';
const previewNames:Record<Preview,string>={summon:'恶魔降临',capture:'生命信号消失',sprint:'冲刺',decoy:'诱饵信标',phase:'穿墙符',lock:'封门器',finished:'最后幸存'};

export function DemonApp(){
 const [seed,setSeed]=useState(query.get('seed')??'1701'),[mapId,setMapId]=useState(ids.includes(query.get('map')??'')?query.get('map')!:'01'),[ratio,setRatio]=useState('1.35');
 const [scene,setScene]=useState<Scene>(),[running,setRunning]=useState(false),[speed,setSpeed]=useState(1),[near,setNear]=useState(true),[hud,setHud]=useState(true),[obs,setObs]=useState(false);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[progress,setProgress]=useState(0),[settings,setSettings]=useState(()=>typeof matchMedia==='function'?!matchMedia('(max-width: 800px)').matches:true),[log,setLog]=useState(false);
 const [muted,setMuted]=useState(false),[volume,setVolume]=useState(.5),[mix,setMix]=useState<DemonAudioMix>({environment:.18,events:.8,chase:.35});
 const [atmosphere,setAtmosphere]=useState(()=>typeof matchMedia==='function'?!matchMedia('(prefers-reduced-motion: reduce)').matches:true),[preview,setPreview]=useState<Preview>('summon'),[audioError,setAudioError]=useState('');
 const current=useRef<Scene|undefined>(undefined),maps=useRef<SurvivalMap[]>([]),seq=useRef(0),audio=useRef<DemonAudio|undefined>(undefined);
 const playback=useRef(false);playback.current=running;
 const publish=(s:Scene)=>{current.current=s;setScene(s)};
 const soundScene=(m:DemonMatch,active:boolean)=>({running:active,phase:m.phase,stage:m.stage,elapsedTicks:m.elapsedTicks,alive:m.world.runners.filter(r=>r.active).length,chasing:m.phase==='chase'&&m.pursuit.hunter.status==='pursuit'});
 const reset=async()=>{const token=++seq.current;setRunning(false);audio.current?.reset();setProgress(0);setLoading(true);setError('');try{
  if(!Number.isInteger(Number(seed))||Number(seed)<0||Number(seed)>2147483647||Number(ratio)<.5||Number(ratio)>3)throw Error('种子需为 0–2147483647 的整数，速度倍率需在 0.5–3 之间。');
  if(!maps.current.length)maps.current=await Promise.all(ids.map(async id=>{const r=await fetch(`/maps/phase1/${id}.json`);if(!r.ok)throw Error(`地图 ${id} 无法加载`);return r.json() as Promise<SurvivalMap>}));
  if(token!==seq.current)return;const first=Number(mapId)-1,ordered=[maps.current[first]!,...maps.current.filter((_,i)=>i!==first)],match=createDemonMatch(ordered,Number(seed),Number(ratio));publish({match,previous:match,at:performance.now()});
 }catch(e){if(token===seq.current){current.current=undefined;setScene(undefined);setError(e instanceof Error?e.message:'比赛初始化失败')}}finally{if(token===seq.current)setLoading(false)}};
 useEffect(()=>{audio.current??=new DemonAudio();return()=>{audio.current?.dispose();audio.current=undefined}},[]);
 useEffect(()=>{void reset();return()=>{seq.current++}},[seed,mapId,ratio]);
 useEffect(()=>{const a=audio.current;if(a){a.muted=muted;a.volume=volume;a.setMix(mix)}},[muted,volume,mix]);
 useEffect(()=>{
  if(!running){audio.current?.stopPlayback(current.current?.match.phase==='finished');return}
  let raf=0,last=performance.now(),acc=0,transition=progress*3000;
  const frame=(now:number)=>{const delta=Math.min(250,now-last);last=now;const s=current.current;if(!s)return;let match=s.match,previous=s.previous;
   if(match.phase==='transition'){transition+=delta*speed;setProgress(Math.min(1,transition/3000));if(transition>=3000){previous=match;match=advanceDemonTransition(match);acc=0;transition=0;setProgress(0)}}
   else{acc+=delta*speed;let count=0;while(acc>=100&&match.phase!=='finished'&&match.phase!=='transition'&&count++<10){previous=match;match=stepDemonMatch(match);acc-=100}if(match.phase==='transition'){transition=0;acc=0}}
   audio.current?.updateScene(soundScene(match,match.phase!=='finished'));
   if(match!==s.match){audio.current?.play(match.events);publish({match,previous,at:now})}
   if(match.phase==='finished'){setRunning(false);return}raf=requestAnimationFrame(frame)};
  raf=requestAnimationFrame(frame);return()=>cancelAnimationFrame(raf);
 },[running,speed]);
 const toggle=()=>{const m=current.current?.match;if(!m||loading||m.phase==='finished')return;if(!running){setSettings(false);setAudioError('');void audio.current?.unlock().then(()=>{if(!playback.current)return;const now=current.current?.match;if(now)audio.current?.updateScene(soundScene(now,true));audio.current?.play(now?.events??[])}).catch(()=>setAudioError('音效未能启用，可重新点击试听；比赛可继续。'))}setRunning(v=>!v)};
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setHud(true);setObs(false);setSettings(false);setLog(false)}if((e.target as HTMLElement)?.matches('input,select,textarea'))return;if(e.key.toLowerCase()==='h'){setHud(v=>!v);return}if(e.code==='Space'&&!(e.target as HTMLElement)?.matches('button')){e.preventDefault();toggle()}};addEventListener('keydown',key);return()=>removeEventListener('keydown',key)},[running,loading]);
 const audition=()=>{setAudioError('');const item=['sprint','decoy','phase','lock'].includes(preview)?preview as DemonItem:undefined;void audio.current?.preview(item?'item-use':preview as DemonEvent['type'],item).catch(()=>setAudioError('浏览器未能启用音频，请重试或检查输出设备。'))};
 const m=scene?.match,activeMapId=m?(ids[maps.current.findIndex(source=>source.seed===m.maps[m.stage-1]!.seed)]??mapId):mapId,living=m?.world.runners.filter(r=>r.active)??[],frozen=running||Boolean(m&&m.elapsedTicks>0),finished=m?.phase==='finished';
 const phase=m?.phase==='selection'?`选房保护 ${Math.max(0,(m.stage===1?150:100)-m.phaseTicks)/10} 秒`:m?.phase==='transition'?'幸存者集合':finished?'本场观测结束':'恶魔追捕';
 const latest=m?.events.at(-1),showEvent=latest&&m!.elapsedTicks-latest.elapsedTick<70;
 const winner=living.length===1?living[0]:undefined;
 return <div className={`demon-app ${hud?'':'demon-no-hud'} ${obs?'demon-obs':''}`}>
  <header className="demon-header">
   <div className="demon-brand"><span className="lab-seal" aria-hidden="true">K<span>17</span></span><div><h1>气运之子</h1><p>废弃研究所 / 生存观测</p></div></div>
   <div className="demon-score"><span className="lab-phase-indicator"><i className={running?'live':''}/>{m?`第 ${m.stage} 层`:'准备中'}<small>{phase}</small></span><span className="lab-alive">生命信号 <b>{living.length||(!m?8:0)}<small> / 8</small></b></span><strong data-testid="demon-clock">{stamp(m?.elapsedTicks??0)}<small> / 04:10</small></strong></div>
   <button className="lab-settings-toggle" aria-expanded={settings} onClick={()=>setSettings(v=>!v)}>监控设置</button>
  </header>
  <main className="demon-stage">
   {scene&&<DemonCanvas match={scene.match} previous={scene.previous} at={scene.at} running={running} speed={speed} near={near} transitionProgress={progress} atmosphere={atmosphere}/>}
   {!scene&&<div className="demon-overlay">{error||'正在连接设施监控…'}</div>}
   {m&&<div className="demon-status"><span>设施 {m.stage===2?`${mapId} / ${activeMapId}`:activeMapId}<i/>第 {m.stage} 阶段</span><strong data-testid="demon-phase">{phase}</strong><small>{m.phase==='chase'?`追捕 ${stamp(m.phaseTicks)}`:m.phase==='selection'?'隔离门关闭 · 恶魔尚未激活':finished?`捕获 ${m.stats.captures} 人`:'换图期间暂停有效计时'}</small></div>}
   <aside className="lab-settings" aria-label="监控设置面板" hidden={!settings||!hud}>
    <div className="lab-panel-title"><div><span>观测终端</span><h2>监控设置</h2></div><button aria-label="关闭设置" onClick={()=>setSettings(false)}>×</button></div>
    <section><h3>比赛准备</h3><div className="lab-form-grid"><label>首张地图<select aria-label="首张地图" disabled={frozen} value={mapId} onChange={e=>setMapId(e.target.value)}>{ids.map(id=><option key={id}>{id}</option>)}</select></label><label>恶魔速度<input aria-label="恶魔速度倍率" disabled={frozen} type="number" min=".5" max="3" step=".05" value={ratio} onChange={e=>setRatio(e.target.value)}/></label></div><label className="lab-field">固定种子<input aria-label="比赛种子" disabled={frozen} value={seed} onChange={e=>setSeed(e.target.value)}/></label><p className="lab-help">同一地图、种子与速度，可以再看同一场比赛。比赛开始后锁定配置。</p></section>
    <section><h3>声音控制<button className="lab-text-button" aria-pressed={muted} onClick={()=>setMuted(v=>!v)}>{muted?'开启音效':'静音'}</button></h3>
     <label className="lab-slider">总音量<output>{Math.round(volume*100)}%</output><input aria-label="总音量" type="range" min="0" max="1" step=".05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label>
     {(['environment','events','chase'] as const).map(channel=>{const name={environment:'环境音量',events:'事件音量',chase:'追逐音量'}[channel];return <label className="lab-slider" key={channel}>{name}<output>{Math.round(mix[channel]*100)}%</output><input aria-label={name} type="range" min="0" max="1" step=".05" value={mix[channel]} onChange={e=>setMix(old=>({...old,[channel]:Number(e.target.value)}))}/></label>})}
     <div className="lab-preview"><select aria-label="音效类型" value={preview} onChange={e=>setPreview(e.target.value as Preview)}>{Object.entries(previewNames).map(([value,name])=><option value={value} key={value}>{name}</option>)}</select><button disabled={muted||volume===0} onClick={audition}>试听音效</button></div><p className="lab-help">{audioError||(muted?'已静音，取消静音后可以试听。':'环境低鸣与追逐节奏可单独调低，给旁白留出空间。')}</p>
    </section>
    <section><h3>画面与入口</h3><label className="lab-check"><input aria-label="氛围动画" type="checkbox" checked={atmosphere} onChange={e=>setAtmosphere(e.target.checked)}/>氛围动画<span>灯光 / 角色反馈</span></label><nav><a href="?mode=pursuit">200 秒自动基线</a><a href="?">训练观战</a></nav></section>
   </aside>
   {m&&!running&&m.elapsedTicks===0&&!loading&&<div className="demon-start"><span className="lab-incident">隔离记录 017</span><h2>八人入场，<br/>一人留下。</h2><p>选择一间房，带上找到的物资。<br/>15 秒之后，恶魔开始寻找你。</p><button onClick={toggle}>开始比赛<span aria-hidden="true">▶</span></button><small>两轮搜物 · 最后一人幸存</small></div>}
   {m?.phase==='transition'&&<div className="demon-transition"><span className="lab-incident">区域转移</span><h2>{living.length} 名幸存者正在集合</h2><p>保留未使用物资，进入下一座设施</p><progress value={progress} max="1"/></div>}
   {m&&finished&&<div className="demon-result" data-testid="demon-result"><span className="lab-incident">观测结束 / {stamp(m.elapsedTicks)}</span><h2>{winner?<><span className="lab-winner-number" style={{color:BALL_COLORS[Number(winner.id)-1]}}>{winner.id}</span>本场气运之子</>:living.length===0?'无人幸存':'时间到 · 多人幸存'}</h2><p>{living.length>1?`幸存名单：${living.map(r=>r.id).join('、')}`:`${m.stats.captures} 人被捕获，${living.length} 人幸存。`}</p><p className="lab-result-detail">道具使用 {Object.values(m.stats.itemUses).reduce((a,b)=>a+b,0)} 次 · 使用后脱身 {Object.values(m.stats.escapes).reduce((a,b)=>a+b,0)} 次</p>{winner&&<ol className="lab-winner-events">{m.events.filter(e=>e.actorId===winner.id&&(e.type==='item-use'||e.type==='pickup')).slice(-2).map(e=><li key={e.id}><time>{stamp(e.elapsedTick)}</time>{eventText(e)}</li>)}</ol>}<button onClick={()=>void reset()}>再跑同一种子</button></div>}
   {m&&<div className={`demon-events ${log?'lab-log-expanded':''}`} aria-live="polite">{(log?m.events.slice(-8).reverse():showEvent?[latest!]:[]).map(e=><div key={e.id}><time>{stamp(e.elapsedTick)}</time>{eventText(e)}</div>)}</div>}
   <div className="demon-roster">{m&&Array.from({length:8},(_,i)=>{const id=String(i+1).padStart(2,'0');return m.world.runners.find(r=>r.id===id)??{id,active:false}}).map((r,i)=>{const item=m.inventory[r.id];return <div key={r.id} className={r.active?'':'caught'}><i style={{background:r.active?BALL_COLORS[i]:'#484c4d'}}>{r.id}</i><span>{r.active?'信号正常':'信号消失'}<small>{r.active?(item?<><b>{glyphs[item]}</b> {items[item]}</>:'暂无物资'):'已捕获'}</small></span></div>})}</div>
  </main>
  <footer className="demon-controls"><div className="lab-playback"><button disabled={!m||loading||finished} onClick={toggle}>{running?'暂停':m?.elapsedTicks?'继续':'开始'}</button><button disabled={loading} onClick={()=>void reset()}>重新比赛</button><button disabled={loading} onClick={()=>{setSeed(String((Number(seed)+1)%2147483647));if(frozen)setRunning(false)}}>新种子</button><div className="demon-speeds">{[1,2,4].map(s=><button key={s} aria-pressed={speed===s} onClick={()=>setSpeed(s)}>{s}×</button>)}</div></div><div className="lab-view-controls"><button onClick={()=>setNear(v=>!v)}>{near?'切换全景':'自动镜头'}</button><button aria-pressed={log} onClick={()=>setLog(v=>!v)}>事件记录</button><button onClick={()=>setHud(false)}>隐藏界面</button><button onClick={()=>{setHud(false);setObs(true);setSettings(false)}}>OBS 录制</button><button onClick={()=>void document.documentElement.requestFullscreen().catch(()=>{})}>全屏</button></div><small>空格 暂停　H 界面　Esc 返回</small></footer>
  {!hud&&<button className="demon-return" onClick={()=>{setHud(true);setObs(false)}}>Esc 返回控制台</button>}
 </div>;
}

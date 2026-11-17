import {useEffect,useRef,useState} from 'react';
import {PursuitCanvas} from './PursuitCanvas';
import {createPursuitWorld,createPursuitState,decideBaselineActions,updatePursuit,buildPursuitObservation} from '../sim/pursuit';
import {stepSurvivalWorld} from '../sim/survival/world';
import type {SurvivalWorld} from '../sim/survival/world';
import type {SurvivalMap} from '../sim/survival/map';
import './pursuit.css';

const query=new URLSearchParams(location.search),mapIds=Array.from({length:10},(_,i)=>String(i+1).padStart(2,'0'));
const names=['灯塔','灰狐','飞蛾','锁匠','回声','独狼','渡鸦','守夜人'];
const time=(seconds:number)=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
type BaselineState=ReturnType<typeof createPursuitState>;
type Scene={world:SurvivalWorld;previous:SurvivalWorld;state:BaselineState;at:number};

export function PursuitApp(){
 const[mapId,setMapId]=useState(mapIds.includes(query.get('map')??'')?query.get('map')!:'01'),[seed,setSeed]=useState(query.get('seed')??'1701'),[ratio,setRatio]=useState('1.35');
 const[scene,setScene]=useState<Scene>(),[running,setRunning]=useState(false),[speed,setSpeed]=useState(1),[director,setDirector]=useState(false),[hud,setHud]=useState(true),[recording,setRecording]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const sceneRef=useRef<Scene|undefined>(undefined),maps=useRef(new Map<string,SurvivalMap>()),sequence=useRef(0),setSceneRef=(value:Scene)=>{sceneRef.current=value;setScene(value)};
 const valid=Number.isInteger(Number(seed))&&Number(seed)>=0&&Number(seed)<=2147483647&&Number(ratio)>=.5&&Number(ratio)<=3;
 const reset=async()=>{const seq=++sequence.current;setRunning(false);setLoading(true);setError('');try{if(!valid)throw Error('种子需为非负整数，速度倍率需在 0.5–3 之间。');let map=maps.current.get(mapId);if(!map){const response=await fetch(`/maps/phase1/${mapId}.json`);if(!response.ok)throw Error(`地图 ${mapId} 无法加载`);map=await response.json() as SurvivalMap;maps.current.set(mapId,map)}if(seq!==sequence.current)return;const world=createPursuitWorld(map,Number(seed),Number(ratio),2000),state=createPursuitState(Number(seed));updatePursuit(world,state);setSceneRef({world,previous:world,state,at:performance.now()})}catch(e){if(seq===sequence.current){sceneRef.current=undefined;setScene(undefined);setError(e instanceof Error?e.message:'比赛初始化失败')}}finally{if(seq===sequence.current)setLoading(false)}};
 useEffect(()=>{void reset();return()=>{sequence.current++}},[mapId,seed,ratio]);
 useEffect(()=>{if(!running)return;let raf=0,last=performance.now(),accumulator=0;const frame=(now:number)=>{accumulator=Math.min(1000,accumulator+(now-last)*speed);last=now;const started=performance.now();let updated:Scene|undefined;while(sceneRef.current&&accumulator>=sceneRef.current.world.dt*1000&&sceneRef.current.world.phase==='running'&&performance.now()-started<10){const current=sceneRef.current,actions=decideBaselineActions(current.world,current.state),next=stepSurvivalWorld(current.world,actions);updatePursuit(next,current.state);updated={world:next,previous:current.world,state:current.state,at:performance.now()};sceneRef.current=updated;accumulator-=current.world.dt*1000}if(updated)setScene(updated);if(sceneRef.current?.world.phase==='finished'){setRunning(false);return}raf=requestAnimationFrame(frame)};raf=requestAnimationFrame(frame);return()=>cancelAnimationFrame(raf)},[running,speed]);
 const toggle=()=>{if(!sceneRef.current||loading||sceneRef.current.world.phase==='finished')return;setRunning(v=>!v)};
 useEffect(()=>{const handle=(event:KeyboardEvent)=>{if(event.key==='Escape'){setHud(true);setRecording(false)}if((event.target as HTMLElement)?.matches('input,select,textarea'))return;if(event.code==='Space'){event.preventDefault();toggle()}if(event.key.toLowerCase()==='h')setHud(v=>!v)};addEventListener('keydown',handle);return()=>removeEventListener('keydown',handle)},[loading]);
 const world=scene?.world,observation=scene?buildPursuitObservation(scene.world,scene.state):undefined,captured=world?.runners.filter(r=>!r.active).length??0,status=observation?.status==='pursuit'?'追逐':observation?.status==='search'?'搜索最后目击区':'巡逻搜索';
 const frozen=running||Boolean(world&&world.tick>0),finished=world?.phase==='finished';
 return <div className={`pursuit-app ${hud?'':'pursuit-no-hud'} ${recording?'pursuit-recording':''}`}>
  <header className="pursuit-header"><div><h1>自动追逃观战</h1><p data-testid="pursuit-controller">代码基线 · 双方自动寻路 · 猎人 {Number(ratio).toFixed(2)} 倍速度</p></div><div className="pursuit-score"><span>已捕获 <b>{captured}</b><small> / 7</small></span><strong>{time((world?.tick??0)*(world?.dt??.1))}<small data-testid="pursuit-time-limit"> / 03:20</small></strong><a href="http://127.0.0.1:8765/" target="_blank" rel="noreferrer">训练工作台</a></div></header>
  <div className="pursuit-settings"><label>地图<select aria-label="地图" value={mapId} disabled={frozen} onChange={e=>setMapId(e.target.value)}>{mapIds.map(id=><option key={id} value={id}>图池 {id}</option>)}</select></label><label>种子<input aria-label="比赛种子" value={seed} disabled={frozen} inputMode="numeric" onChange={e=>setSeed(e.target.value)}/></label><label>猎人速度倍率<input aria-label="猎人速度倍率" type="number" min=".5" max="3" step=".05" value={ratio} disabled={frozen} onChange={e=>setRatio(e.target.value)}/></label><p>40 格视线感知，每秒刷新；换目标两次后锁定，跟丢 5 秒重新搜索。</p></div>
  <div className="pursuit-stage">
   {scene&&<PursuitCanvas world={scene.world} previous={scene.previous} snapshotAt={scene.at} speed={speed} director={director} targetId={observation?.targetId} mapId={mapId}/>}
   {!scene&&<div className="pursuit-placeholder">{error||'正在准备固定地图…'}</div>}
   <div className="pursuit-map-tag">设施 {mapId}<span>代码策略对抗</span></div>
   {world&&<div className="pursuit-live" data-testid="pursuit-target"><span>{finished?'本局结束':status}</span><strong>{observation?.targetId?`${observation.targetId} 号目标`:'寻找目标'}</strong><small>切换 {observation?.switchCount??0}/2{observation?.locked?' · 已锁定':''}</small><small>实际速度 {(finished?0:Math.hypot(world.hunter.kinematics.velocity.x,world.hunter.kinematics.velocity.y)).toFixed(2)} 格/秒</small></div>}
   {scene&&!running&&world?.tick===0&&!loading&&<div className="pursuit-start"><p>八名逃亡者会主动避开可见猎人，利用房间与转角逃离。</p><button onClick={toggle}>开始比赛</button><small>这是可复现的代码策略对抗，未使用强化学习模型。</small></div>}
   {finished&&<div className="pursuit-result"><p>本局结束 · {time(world!.tick*world!.dt)}</p><h2>{world!.result?.reason==='last-survivor'?`${world!.result.winnerId} 号最后幸存`:world!.result?.reason==='timeout'?'封锁时间到':'猎人完成清场'}</h2><span>实际捕获 {captured} 人</span><button onClick={()=>void reset()}>再跑同一种子</button></div>}
   <div className="pursuit-roster">{world?.runners.map((runner,index)=><div className={runner.active?'':'caught'} key={runner.id}><i>{runner.id}</i><span>{names[index]}</span><small>{runner.active?'逃亡中':'已捕获'}</small></div>)}</div>
  </div>
  <footer className="pursuit-controls"><button disabled={!scene||loading||finished} onClick={toggle}>{running?'暂停':world?.tick===0?'开始':'继续'}</button><button disabled={loading} onClick={()=>void reset()}>重新比赛</button><div className="pursuit-speed">{[1,2,4].map(s=><button aria-pressed={speed===s} onClick={()=>setSpeed(s)} key={s}>{s}×</button>)}</div><button onClick={()=>setDirector(v=>!v)}>{director?'自动镜头':'全景'}</button><button onClick={()=>setHud(v=>!v)}>隐藏界面</button><button onClick={()=>{setHud(false);setRecording(true)}}>OBS 录制</button><button onClick={()=>document.documentElement.requestFullscreen()}>全屏</button><span>空格 暂停　H 界面　Esc 退出录制</span></footer>
  {!hud&&<button className="pursuit-exit" onClick={()=>{setHud(true);setRecording(false)}}>Esc 返回控制台</button>}
 </div>;
}

import {generateFacility,findPath,neighbours} from './map';
import {Rng} from './rng';
import {canSee,distance} from './perception';
import {RUNNER_PROFILES,profileById} from './profiles';
import type {Actor,GameEvent,HunterActor,MatchResult,Point,RunnerActor,WorldState,ProtocolKind} from './types';
const TICK_SECONDS=.25, CUTOFF=1680;
const same=(a:Point,b:Point)=>a.x===b.x&&a.y===b.y;
const event=(w:WorldState,type:string,actorIds:string[],position?:Point,payload:Record<string,unknown>={})=>w.events.push({tick:w.tick,type,actorIds,position,payload});

export function createWorld(seed:number):WorldState{
 const map=generateFacility(seed),rng=new Rng(seed^0xabc123);
 const runners:RunnerActor[]=RUNNER_PROFILES.map((p,i)=>({id:p.number,kind:'runner',profileId:p.id,position:{...map.runnerSpawns[i]!},previous:{...map.runnerSpawns[i]!},status:'active',inventory:[],rescueUsed:false,path:[],action:'侦察',terminalTicks:0,route:[{...map.runnerSpawns[i]!}]}));
 const hunter:HunterActor={id:'hunter',kind:'hunter',profileId:'hunter',position:{...map.hunterSpawn},previous:{...map.hunterSpawn},status:'active',inventory:[],rescueUsed:false,path:[],action:'巡逻',mode:'patrol',memory:{lastStimulusTick:0,exitIdleTicks:0},route:[{...map.hunterSpawn}]};
 const kinds=rng.shuffle<ProtocolKind>(['outage','door-reset','vent-purge','surveillance-leak','isolation','elevator-migration']).slice(0,2);
 return {seed,tick:0,phase:'exploration',map,actors:[...runners,hunter],events:[],sounds:[],tracks:[],protocols:[{kind:kinds[0]!,warningTick:320,activeTick:360,applied:false},{kind:kinds[1]!,warningTick:800,activeTick:840,applied:false}]};
}

const runnerTarget=(w:WorldState,r:RunnerActor):Point=>{
 const active=w.actors.filter((a):a is RunnerActor=>a.kind==='runner'&&a.status==='active');
 const down=w.actors.filter((a):a is RunnerActor=>a.kind==='runner'&&a.status==='downed'&&!a.rescueUsed).sort((a,b)=>distance(r.position,a.position)-distance(r.position,b.position))[0];
 const p=profileById(r.profileId);
 if(down&&distance(r.position,down.position)<14&&p.rescue>.3)return down.position;
 const hunter=w.actors.find((a):a is HunterActor=>a.kind==='hunter')!;
 const danger=p.risk>.7?3:p.risk>.4?5:7;
 if(distance(r.position,hunter.position)<danger&&canSee(w.map,r.position,hunter.position,danger)){
  const safe=[...w.map.rooms].sort((a,b)=>distance({x:b.x+b.width/2,y:b.y+b.height/2},hunter.position)-distance({x:a.x+a.width/2,y:a.y+a.height/2},hunter.position))[0]!;
  return {x:Math.floor(safe.x+safe.width/2),y:Math.floor(safe.y+safe.height/2)};
 }
 if(w.phase==='evacuation')return w.map.elevator;
 const incomplete=w.map.terminals.filter(t=>!t.active);
 if(!incomplete.length)return w.map.elevator;
 const assigned=incomplete[(Number(r.id)-1)%incomplete.length]!;
 if(r.profileId==='raven'){const lead=active.find(a=>a.id!==r.id&&a.path.length);if(lead)return lead.position;}
 return assigned.position;
};

function moveRunner(w:WorldState,r:RunnerActor){
 r.previous={...r.position}; if(r.status!=='active')return;
 const target=runnerTarget(w,r);r.target=target;
 if(same(r.position,target))return;
 const blocked=new Set(w.map.doors.filter(d=>d.lockedUntil>w.tick||d.blockedUntil>w.tick).map(d=>`${d.position.x},${d.position.y}`));
 if(!r.path.length||!same(r.path[r.path.length-1]!,target))r.path=findPath(w.map,r.position,target,blocked).slice(1);
 const speedTick=(r.profileId==='moth'?2:3); if(w.tick%speedTick!==0)return;
 const next=r.path.shift();if(next){r.position={...next};r.route.push({...next});w.tracks.push({position:{...next},actorId:r.id,createdAt:w.tick});if(w.tick%12===0)w.sounds.push({position:{...next},strength:r.profileId==='grayfox'?4:7,createdAt:w.tick,kind:'脚步'});}
}

function processRunnerActions(w:WorldState,r:RunnerActor){
 if(r.status!=='active')return;
 const item=w.map.items.find(i=>!i.taken&&same(i.position,r.position));if(item){item.taken=true;r.inventory.push(item.kind);event(w,'item',[r.id],r.position,{kind:item.kind});}
 const vent=w.map.vents.find(v=>v.disabledUntil<=w.tick&&(same(v.a,r.position)||same(v.b,r.position)));if(vent&&w.tick%24===Number(r.id)%24){r.position=same(vent.a,r.position)?{...vent.b}:{...vent.a};r.path=[];event(w,'vent',[r.id],r.position);}
 const down=w.actors.find((a):a is RunnerActor=>a.kind==='runner'&&a.status==='downed'&&distance(a.position,r.position)<=1.1&&!a.rescueUsed);
 if(down&&profileById(r.profileId).rescue>.3){down.status='active';down.rescueUsed=true;down.downedAt=undefined;event(w,'rescue',[r.id,down.id],down.position);return;}
 const terminal=w.map.terminals.find(t=>!t.active&&same(t.position,r.position));
 if(terminal){r.action='破解终端';terminal.progress+=profileById(r.profileId).terminal>=.75?2:1;r.terminalTicks++;if(terminal.progress>=1200){terminal.active=true;event(w,'terminal',[r.id],terminal.position,{terminalId:terminal.id});w.sounds.push({position:terminal.position,strength:24,createdAt:w.tick,kind:'终端警报'});}}
 if(w.phase==='evacuation'&&same(r.position,w.map.elevator)){r.status='escaped';event(w,'escape',[r.id],r.position);}
 if(r.inventory.includes('barricade')&&distance(r.position,w.actors.find(a=>a.kind==='hunter')!.position)<7){const d=[...w.map.doors].sort((a,b)=>distance(a.position,r.position)-distance(b.position,r.position))[0];if(d){d.blockedUntil=w.tick+40;r.inventory.splice(r.inventory.indexOf('barricade'),1);event(w,'barricade',[r.id],d.position);}}
 if(r.inventory.includes('decoy')&&profileById(r.profileId).decoy>.7&&w.tick%160===Number(r.id)*7){r.inventory.splice(r.inventory.indexOf('decoy'),1);const candidates=neighbours(w.map,r.position);const pos=candidates[0]??r.position;w.sounds.push({position:pos,strength:30,createdAt:w.tick,kind:'诱饵'});event(w,'decoy',[r.id],pos);}
}

function moveHunter(w:WorldState,h:HunterActor){
 h.previous={...h.position};const runners=w.actors.filter((a):a is RunnerActor=>a.kind==='runner'&&a.status==='active');
 const outage=w.protocols.some(p=>p.kind==='outage'&&p.applied&&w.tick-p.activeTick<160),visible=runners.filter(r=>canSee(w.map,h.position,r.position,outage?4:8)).sort((a,b)=>distance(h.position,a.position)-distance(h.position,b.position))[0];
 let target:Point|undefined;
 if(visible){h.mode='chase';h.memory.targetId=visible.id;h.memory.lastSeen={...visible.position};h.memory.lastStimulusTick=w.tick;target=visible.position;}
 else {const sound=[...w.sounds].filter(s=>w.tick-s.createdAt<32&&distance(h.position,s.position)<=s.strength).sort((a,b)=>b.createdAt-a.createdAt)[0],track=[...w.tracks].filter(t=>w.tick-t.createdAt<36&&distance(h.position,t.position)<10).sort((a,b)=>b.createdAt-a.createdAt)[0];if(sound||track){h.mode='investigate';target=sound?.position??track!.position;h.memory.lastStimulusTick=w.tick;}else if(h.memory.lastSeen&&w.tick-h.memory.lastStimulusTick<80){h.mode='search';target=h.memory.lastSeen;}else{h.mode='patrol';const room=w.map.rooms[Math.floor((w.tick/100+h.position.x+w.seed)%w.map.rooms.length)]!;target={x:Math.floor(room.x+room.width/2),y:Math.floor(room.y+room.height/2)};}}
 if(distance(h.position,w.map.elevator)<5&&!visible)h.memory.exitIdleTicks++;else h.memory.exitIdleTicks=0;
 if(h.memory.exitIdleTicks>60){h.mode='expand';const room=w.map.rooms[(w.tick/60|0)%6]!;target={x:room.x+2,y:room.y+2};h.memory.exitIdleTicks=0;event(w,'anti-camp',['hunter'],h.position);}
 h.action={patrol:'巡逻',investigate:'调查声音',search:'搜索目击区',chase:'追逐',intercept:'预测拦截',expand:'扩大搜索'}[h.mode];
 const blocked=new Set(w.map.doors.filter(d=>d.lockedUntil>w.tick||d.blockedUntil>w.tick).map(d=>`${d.position.x},${d.position.y}`));if(target&&(!h.path.length||!same(h.path[h.path.length-1]!,target)))h.path=findPath(w.map,h.position,target,blocked).slice(1);
 if(w.tick%(w.phase==='evacuation'?2:8)===0){const next=h.path.shift();if(next){h.position={...next};h.route.push({...next});}}
 for(const r of runners)if(distance(h.position,r.position)<.6){if(!r.rescueUsed&&r.status==='active'){r.status='downed';r.downedAt=w.tick;r.path=[];event(w,'downed',['hunter',r.id],r.position);}else if(r.status==='active'){r.status='eliminated';event(w,'eliminated',['hunter',r.id],r.position);}}
}

function applyProtocols(w:WorldState){for(const p of w.protocols){if(w.tick===p.warningTick)event(w,'protocol-warning',[],undefined,{kind:p.kind});if(w.tick>=p.activeTick&&!p.applied){p.applied=true;event(w,'protocol',[],undefined,{kind:p.kind});if(p.kind==='door-reset')w.map.doors.forEach(d=>{d.lockedUntil=0;d.blockedUntil=0});if(p.kind==='vent-purge')w.map.vents.forEach(v=>v.disabledUntil=w.tick+80);if(p.kind==='isolation')w.map.doors[0]!.lockedUntil=w.tick+48;if(p.kind==='surveillance-leak')for(const a of w.actors)if(a.kind==='runner'&&a.status==='active')w.sounds.push({position:{...a.position},strength:16,createdAt:w.tick,kind:'监控泄漏'});if(p.kind==='elevator-migration'){const hall=w.map.rooms.find(r=>r.kind==='evacuation')!;w.map.elevator={x:hall.x+hall.width-2,y:hall.y+hall.height-2};}}}}

export function stepWorld(input:WorldState):{state:WorldState;events:GameEvent[]}{
 const w=structuredClone(input) as WorldState;if(w.phase==='finished')return {state:w,events:[]};w.tick++;const start=w.events.length;applyProtocols(w);
 for(const a of w.actors)if(a.kind==='runner')moveRunner(w,a);for(const a of w.actors)if(a.kind==='runner')processRunnerActions(w,a);const hunter=w.actors.find((a):a is HunterActor=>a.kind==='hunter')!;moveHunter(w,hunter);
 w.tracks=w.tracks.filter(t=>w.tick-t.createdAt<=36);w.sounds=w.sounds.filter(s=>w.tick-s.createdAt<=48);
 const activeTerminals=w.map.terminals.filter(t=>t.active).length;if(activeTerminals>0&&w.phase==='exploration')w.phase='alert';if(activeTerminals===3&&w.phase!=='evacuation'){w.phase='evacuation';w.elevatorOpenedAt=w.tick;event(w,'elevator-open',[],w.map.elevator);}
 for(const r of w.actors.filter((a):a is RunnerActor=>a.kind==='runner'&&a.status==='downed'))if(r.downedAt&&w.tick-r.downedAt>240){r.status='eliminated';event(w,'bleedout',[r.id],r.position);}
 const runners=w.actors.filter((a):a is RunnerActor=>a.kind==='runner');const pending=runners.some(r=>r.status==='active'||r.status==='downed');const elevatorExpired=w.elevatorOpenedAt!==undefined&&w.tick-w.elevatorOpenedAt>=300;
 if(w.tick>=CUTOFF||!pending||elevatorExpired){for(const r of runners)if(r.status==='active'||r.status==='downed')r.status=w.tick>=CUTOFF||elevatorExpired?'missing':'eliminated';w.phase='finished';w.finishedAt=w.tick;event(w,'finished',[],undefined,getResult(w));}
 return {state:w,events:w.events.slice(start)};
}
export function runToEnd(initial:WorldState){let w=initial;while(w.phase!=='finished'&&w.tick<=CUTOFF+1)w=stepWorld(w).state;return w;}
export function getResult(w:WorldState):MatchResult{const rs=w.actors.filter((a):a is RunnerActor=>a.kind==='runner');return {seed:w.seed,durationSeconds:Number((w.tick*TICK_SECONDS).toFixed(2)),escaped:rs.filter(r=>r.status==='escaped').map(r=>r.id),eliminated:rs.filter(r=>r.status==='eliminated').map(r=>r.id),missing:rs.filter(r=>r.status==='missing').map(r=>r.id)};}





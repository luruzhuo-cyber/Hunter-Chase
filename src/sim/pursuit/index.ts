import {createSurvivalWorld} from '../survival/world';
import type {SurvivalWorld,SurvivalActions,SurvivalAction} from '../survival/world';
import type {SurvivalMap} from '../survival/map';
import type {Vec2} from '../survival/types';
import {hasLineOfSight} from '../survival/observation';
import {positionCell,isTraversable} from '../survival/pathing';
import {Rng} from '../rng';
import {searchMap,pathFromSearch,findPursuitPath,cellPoint,distance,nextOnPath} from './navigation';
export {findPursuitPath} from './navigation';
export const PURSUIT_VERSION='los40-switch2-v1';
export const BASELINE_VERSION='automatic-chase-escape-v1';
export const SPAWN_PATH_MIN=8;
export const SPAWN_PATH_MAX=35;
export const SPAWN_POLICY_VERSION='reachable-path-8-35-v1';
export type PursuitObservation={targetId?:string;lastPosition?:Vec2;nextWaypoint?:Vec2;pathDistance?:number;switchCount:number;locked:boolean;lastSeenTick:number;observedAt:number;visibleCount:number;status:'patrol'|'pursuit'|'search'};
type RunnerMemory={threat?:Vec2;seenTick:number;plannedAt:number;goal?:Vec2;path:Vec2[];choices:number;lastPosition?:Vec2;stuck:number};
export type PursuitState={seed:number;updatedAt:number;nextSensorTick:number;hunter:PursuitObservation;seenSince:Record<string,number>;samples:Record<string,{position:Vec2;tick:number;velocity:Vec2}>;patrolGoal?:Vec2;patrolChoices:number;visited:Record<string,number>;runners:Record<string,RunnerMemory>};
export function createPursuitState(seed:number):PursuitState{return{seed,updatedAt:-1,nextSensorTick:0,hunter:{switchCount:0,locked:false,lastSeenTick:-1,observedAt:-1,visibleCount:0,status:'patrol'},seenSince:{},samples:{},patrolChoices:0,visited:{},runners:{}}}
export function createPursuitWorld(map:SurvivalMap,seed:number,speedRatio=1.35,maxTicks=2000):SurvivalWorld{
 const clone=structuredClone(map);const cells=clone.terrain.map((_,i)=>i).filter(i=>isTraversable(clone,i,'hunter')&&!clone.doors.some(d=>positionCell(clone,d.position)===i));
 const rng=new Rng(seed),choose=()=>cellPoint(clone,cells[Math.floor(rng.next()*cells.length)]!);
 if(cells.length<9)throw Error('pursuit map needs at least nine accessible cells');
 clone.hunterSpawn=choose();clone.runnerSpawns=[];
 const initialSearch=searchMap(clone,clone.hunterSpawn),spawnCells=cells.filter(c=>initialSearch.distances[c]!>=SPAWN_PATH_MIN&&initialSearch.distances[c]!<=SPAWN_PATH_MAX);
 if(spawnCells.length<8)throw Error('not enough reachable spawn cells within pursuit pacing range');
 const chooseRunner=()=>cellPoint(clone,spawnCells[Math.floor(rng.next()*spawnCells.length)]!);
 for(let i=0;i<8;i++){let p=chooseRunner();for(let attempts=0;attempts<1000&&clone.runnerSpawns.some(q=>distance(p,q)<1.5);attempts++)p=chooseRunner();if(clone.runnerSpawns.some(q=>distance(p,q)<1.5))throw Error('unable to place distinct pursuit spawns with sufficient separation');clone.runnerSpawns.push(p)}
 const w=createSurvivalWorld({seed,map:clone,maxTicks,hunterSpeedMultiplier:speedRatio,skillsDisabled:true,stopAtOne:true,zoneSchedule:{dt:.1,initial:{anchor:{x:clone.width/2,y:clone.height/2},vertices:[{x:0,y:0},{x:clone.width,y:0},{x:clone.width,y:clone.height},{x:0,y:clone.height}]},phases:[]}});
 for(const r of w.runners){delete r.skill;r.skillUsed=false}return w;
}
function clearTarget(state:PursuitState){state.hunter.targetId=undefined;state.hunter.lastPosition=undefined;state.hunter.nextWaypoint=undefined;state.hunter.pathDistance=undefined;state.hunter.switchCount=0;state.hunter.locked=false;state.hunter.lastSeenTick=-1;state.hunter.status='patrol'}
export function updatePursuit(world:SurvivalWorld,state:PursuitState):PursuitState{
 if(state.updatedAt===world.tick)return state;
 const hunter=state.hunter,origin=world.hunter.kinematics.position;
 if(hunter.targetId&&!world.runners.some(r=>r.id===hunter.targetId&&r.active)){clearTarget(state);state.nextSensorTick=Math.min(state.nextSensorTick,world.tick)}
 if(world.tick>=state.nextSensorTick){
  state.nextSensorTick=world.tick+Math.max(1,Math.round(1/world.dt));hunter.observedAt=world.tick;
  const search=searchMap(world.map,origin,world.tick);
  const visible=world.runners.filter(r=>r.active&&distance(origin,r.kinematics.position)<=40&&hasLineOfSight(world.map,origin,r.kinematics.position,world.tick))
   .map(r=>({id:r.id,position:{...r.kinematics.position},cost:search.distances[positionCell(world.map,r.kinematics.position)]??-1})).filter(r=>r.cost>=0);
  hunter.visibleCount=visible.length;const ids=new Set(visible.map(r=>r.id));for(const id of Object.keys(state.seenSince))if(!ids.has(id))delete state.seenSince[id];for(const r of visible){state.seenSince[r.id]??=world.tick;const old=state.samples[r.id],elapsed=old?(world.tick-old.tick)*world.dt:0;state.samples[r.id]={position:{...r.position},tick:world.tick,velocity:old&&elapsed>0&&elapsed<=1.1?{x:(r.position.x-old.position.x)/elapsed,y:(r.position.y-old.position.y)/elapsed}:{x:0,y:0}}}
  const current=visible.find(r=>r.id===hunter.targetId);
  if(current){hunter.lastPosition={...current.position};hunter.lastSeenTick=world.tick}
  if(hunter.targetId&&!current&&(world.tick-hunter.lastSeenTick)*world.dt>=5-1e-9)clearTarget(state);
  const byCost=[...visible].sort((a,b)=>a.cost-b.cost||a.id.localeCompare(b.id));
  if(!hunter.targetId){const first=[...visible].sort((a,b)=>state.seenSince[a.id]!-state.seenSince[b.id]!||a.cost-b.cost||a.id.localeCompare(b.id))[0];if(first){hunter.targetId=first.id;hunter.lastPosition={...first.position};hunter.lastSeenTick=world.tick}}
  else if(!hunter.locked){const oldCost=hunter.lastPosition?search.distances[positionCell(world.map,hunter.lastPosition)]??Infinity:Infinity,candidate=byCost[0];if(candidate&&candidate.id!==hunter.targetId&&candidate.cost<oldCost){hunter.targetId=candidate.id;hunter.lastPosition={...candidate.position};hunter.lastSeenTick=world.tick;hunter.switchCount++;hunter.locked=hunter.switchCount>=2}}
  if(hunter.targetId){hunter.status=visible.some(r=>r.id===hunter.targetId)?'pursuit':'search';state.patrolGoal=undefined}
  // Record searched regions by actual line of sight, not only the cell under the hunter.
  for(const p of patrolCandidates(world.map))if(distance(origin,p)<=40&&hasLineOfSight(world.map,origin,p,world.tick))state.visited[String(positionCell(world.map,p))]=world.tick+1;
 }
 if(hunter.lastPosition){let goal=hunter.lastPosition;const sample=hunter.targetId?state.samples[hunter.targetId]:undefined,elapsed=(world.tick-hunter.lastSeenTick)*world.dt;
  // Extrapolate recent visible samples briefly, including around a lost corner; never refresh hidden coordinates.
  if(sample&&elapsed<3){const lead=Math.min(2,elapsed+.7),predicted={x:goal.x+sample.velocity.x*lead,y:goal.y+sample.velocity.y*lead};if(hasLineOfSight(world.map,goal,predicted,world.tick)&&isTraversable(world.map,positionCell(world.map,predicted),'hunter'))goal=predicted;
   else if(Math.hypot(sample.velocity.x,sample.velocity.y)>.5){const reach=searchMap(world.map,goal,world.tick),travel=Math.max(1,Math.round(Math.hypot(sample.velocity.x,sample.velocity.y)*lead));const intercept=reach.cells.filter(c=>reach.distances[c]!>=travel-1&&reach.distances[c]!<=travel+1).map(c=>cellPoint(world.map,c)).sort((a,b)=>distance(a,predicted)-distance(b,predicted))[0];if(intercept)goal=intercept}
  }
  const path=findPursuitPath(world.map,origin,goal,world.tick);hunter.nextWaypoint=nextOnPath(world.map,origin,path,world.tick);hunter.pathDistance=path.length?path.slice(1).reduce((n,p,i)=>n+distance(path[i]!,p),0):undefined}
 else{hunter.nextWaypoint=undefined;hunter.pathDistance=undefined}
 state.updatedAt=world.tick;return state;
}
export function buildPursuitObservation(world:SurvivalWorld,state:PursuitState):PursuitObservation{updatePursuit(world,state);return structuredClone(state.hunter)}
const actionTo=(origin:Vec2,target?:Vec2):SurvivalAction=>{const move=target?{x:target.x-origin.x,y:target.y-origin.y}:{x:0,y:0};return{move,desiredHeading:Math.atan2(move.y,move.x),useSkill:false}};
function patrolCandidates(map:SurvivalMap):Vec2[]{const points=map.rooms.map(r=>({x:Math.floor(r.x+r.width/2)+.5,y:Math.floor(r.y+r.height/2)+.5}));for(let y=2;y<map.height;y+=6)for(let x=2;x<map.width;x+=6)if(isTraversable(map,y*map.width+x,'hunter'))points.push({x:x+.5,y:y+.5});return points}
function patrol(world:SurvivalWorld,state:PursuitState):Vec2|undefined{
 const origin=world.hunter.kinematics.position,search=searchMap(world.map,origin,world.tick);
 if(!state.patrolGoal||distance(origin,state.patrolGoal)<1||search.distances[positionCell(world.map,state.patrolGoal)]===-1){
  if(state.patrolGoal)state.visited[String(positionCell(world.map,state.patrolGoal))]=world.tick+1;
  const rng=new Rng((state.seed^state.patrolChoices++*2654435761)>>>0);const rooms=patrolCandidates(world.map).filter(p=>search.distances[positionCell(world.map,p)]!>5);
  const candidates=rooms.length?rooms:search.cells.filter(c=>search.distances[c]!>5).filter((_,i)=>i%7===0).map(c=>cellPoint(world.map,c));
  state.patrolGoal=candidates.map(p=>({p,score:(state.visited[String(positionCell(world.map,p))]??-1000)*.1+(search.distances[positionCell(world.map,p)]??1000)*.25+rng.next()*.5})).sort((a,b)=>a.score-b.score)[0]?.p;
 }
 return state.patrolGoal?nextOnPath(world.map,origin,pathFromSearch(world.map,origin,state.patrolGoal,search),world.tick):undefined;
}
export function decideRunnerActions(world:SurvivalWorld,state:PursuitState):SurvivalActions{
 const actions:SurvivalActions={};
 for(const r of world.runners.filter(a=>a.active)){
  const p=r.kinematics.position,m=state.runners[r.id]??(state.runners[r.id]={seenTick:-100,plannedAt:-100,path:[],choices:0,stuck:0});
  const seesHunter=distance(p,world.hunter.kinematics.position)<=20&&hasLineOfSight(world.map,p,world.hunter.kinematics.position,world.tick);
  if(seesHunter){m.threat={...world.hunter.kinematics.position};m.seenTick=world.tick}
  if((world.tick-m.seenTick)*world.dt>5)m.threat=undefined;
  m.stuck=m.lastPosition&&distance(p,m.lastPosition)<.01?m.stuck+1:0;m.lastPosition={...p};
  if(!m.goal||distance(p,m.goal)<.8||m.stuck>=5||(world.tick-m.plannedAt)*world.dt>=(m.threat?1:4)){
   const own=searchMap(world.map,p,world.tick),threat=m.threat?searchMap(world.map,m.threat,world.tick):undefined,rng=new Rng((state.seed^Number(r.id)*2654435761^m.choices++*9973)>>>0);
   let best=-Infinity,goal:Vec2|undefined;
   for(const c of own.cells){const d=own.distances[c]!;if(d<3||(m.threat&&d>12))continue;const q=cellPoint(world.map,c);const neighbours=[c-1,c+1,c-world.map.width,c+world.map.width].filter(n=>own.distances[n]!==undefined&&own.distances[n]!==-1).length;
    const threatDistance=threat?.distances[c]??-1;const score=threat?(threatDistance<0?45:Math.min(45,threatDistance))-d*.6+(neighbours>2?2:neighbours===1?-7:0)+rng.next()*.8:Math.min(d,25)-d*.15+rng.next()*12;
    if(score>best){best=score;goal=q}
   }m.goal=goal;m.path=goal?pathFromSearch(world.map,p,goal,own):[];m.plannedAt=world.tick;m.stuck=0;
  }
  // Consume reached prefixes while retaining a continuous route; all steering uses the cached sensor goal.
  while(m.path.length&&distance(p,m.path[0]!)<.35)m.path.shift();
  actions[r.id]=actionTo(p,nextOnPath(world.map,p,m.path,world.tick));
 }return actions;
}
export function decideBaselineActions(world:SurvivalWorld,state:PursuitState):SurvivalActions{
 updatePursuit(world,state);const actions=decideRunnerActions(world,state),origin=world.hunter.kinematics.position;
 actions.hunter=actionTo(origin,state.hunter.nextWaypoint??patrol(world,state));return actions;
}

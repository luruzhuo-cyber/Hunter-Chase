/** Authoritative capture-seven protocol. Frozen runners use only map, own pose, seed. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Rng } from '../src/sim/rng';
import { createSurvivalWorld } from '../src/sim/survival/world';
import type { SurvivalWorld,SurvivalActions } from '../src/sim/survival/world';
import type { SurvivalMap } from '../src/sim/survival/map';
import type { Vec2 } from '../src/sim/survival/types';
import { positionCell,isTraversable } from '../src/sim/survival/pathing';
import type { RewardBreakdown } from '../src/sim/survival/reward';
export const PHASE1_VERSION='hunter-capture7-v1';
export const REWARD_VERSION='capture7-time-motion-v1';
export const RUNNER_VERSION='frozen-waypoint-v1';
export const MAP_IDS=Array.from({length:10},(_,i)=>String(i+1).padStart(2,'0'));
export function loadPoolMap(id:string):SurvivalMap {
 if(!MAP_IDS.includes(id))throw Error('map must be 01..10');
 return JSON.parse(readFileSync(new URL(`../public/maps/phase1/${id}.json`,import.meta.url),'utf8'));
}
export function poolManifest(){return MAP_IDS.map(id=>({id,sha256:createHash('sha256').update(readFileSync(new URL(`../public/maps/phase1/${id}.json`,import.meta.url))).digest('hex')}))}
const centre=(cell:number,width:number):Vec2=>({x:cell%width+.5,y:Math.floor(cell/width)+.5});
const dist=(a:Vec2,b:Vec2)=>Math.hypot(a.x-b.x,a.y-b.y);
export function createPhase1(id:string,routeSeed:number,maxTicks=2000,speedRatio=1.35):SurvivalWorld {
 const map=loadPoolMap(id),rng=new Rng(routeSeed);
 // Spawn only on hunter-accessible ground: no uncatchable stationary pipe endpoint.
 const cells=map.terrain.map((_,i)=>i).filter(i=>isTraversable(map,i,'hunter')&&!map.doors.some(d=>positionCell(map,d.position)===i));
 const choose=()=>centre(cells[Math.floor(rng.next()*cells.length)]!,map.width);
 map.hunterSpawn=choose();map.runnerSpawns=[];
 while(map.runnerSpawns.length<8){const p=choose();if(dist(p,map.hunterSpawn)>8&&map.runnerSpawns.every(q=>dist(p,q)>1))map.runnerSpawns.push(p)}
 const world=createSurvivalWorld({seed:routeSeed,map,maxTicks,hunterSpeedMultiplier:speedRatio,skillsDisabled:true,stopAtOne:true,
 zoneSchedule:{dt:.1,initial:{anchor:{x:map.width/2,y:map.height/2},vertices:[{x:0,y:0},{x:map.width,y:0},{x:map.width,y:map.height},{x:0,y:map.height}]},phases:[]}});
 for(const r of world.runners){delete r.skill;r.skillUsed=false}
 return world;
}
export type RouteState=Record<string,{path:number[];index:number;stuck:number;last:Vec2;choices:number}>;
/** Directed BFS matches one-way doors; runner-only pipes are excluded in this curriculum. */
function route(map:SurvivalMap,start:number,seed:number):number[]{
 const parents=new Int32Array(map.terrain.length).fill(-1),queue=[start];parents[start]=start;
 const doors=new Map(map.doors.map(d=>[positionCell(map,d.position),d]));
 for(let h=0;h<queue.length;h++){
  const a=queue[h]!,p=centre(a,map.width),x=a%map.width,y=Math.floor(a/map.width);
  for(const b of [x>0?a-1:-1,x<map.width-1?a+1:-1,y>0?a-map.width:-1,y<map.height-1?a+map.width:-1]){
   if(!isTraversable(map,b,'hunter')||parents[b]!==-1)continue;
   const q=centre(b,map.width);if([doors.get(a),doors.get(b)].some(d=>d&&(d.lockedUntil>0||d.kind==='oneway'&&((q.x-p.x)*d.direction.x+(q.y-p.y)*d.direction.y)<0)))continue;
   parents[b]=a;queue.push(b);
  }
 }
 const rng=new Rng(seed),far=queue.filter(c=>dist(centre(c,map.width),centre(start,map.width))>8),candidates=far.length?far:queue;
 let goal=candidates[Math.floor(rng.next()*candidates.length)]!;const path=[goal];while(goal!==start){goal=parents[goal]!;path.push(goal)}return path.reverse();
}
export function randomRunnerActions(world:SurvivalWorld,memory:RouteState):SurvivalActions {
 const actions:SurvivalActions={};
 for(const actor of world.runners.filter(r=>r.active)){
  const p=actor.kinematics.position;let state=memory[actor.id];
  if(!state)state=memory[actor.id]={path:[],index:0,stuck:0,last:{...p},choices:0};
  state.stuck=dist(p,state.last)<.005?state.stuck+1:0;state.last={...p};
  if(!state.path.length||state.index>=state.path.length||state.stuck>=5){state.path=route(world.map,positionCell(world.map,p),(world.seed^Number(actor.id)*2654435761^state.choices++*9973)>>>0);state.index=0;state.stuck=0}
  while(state.index<state.path.length&&dist(p,centre(state.path[state.index]!,world.map.width))<.28)state.index++;
  const target=state.index<state.path.length?centre(state.path[state.index]!,world.map.width):p;
  const move={x:target.x-p.x,y:target.y-p.y};actions[actor.id]={move,desiredHeading:Math.atan2(move.y,move.x),useSkill:false};
 }
 return actions;
}
export type MotionSample={tick:number;position:Vec2};
export function movementWindow(history:MotionSample[],dt:number){
 const last=history.at(-1);if(!last)return{ready:false,ineffective:false,idle:false,spinning:false,path:0,displacement:0};
 const samples=history.filter(s=>(last.tick-s.tick)*dt<=1+1e-8),first=samples[0]!;
 const ready=(last.tick-first.tick)*dt>=1-1e-8;let path=0;for(let i=1;i<samples.length;i++)path+=dist(samples[i-1]!.position,samples[i]!.position);
 const displacement=dist(first.position,last.position),idle=ready&&path<.3,spinning=ready&&!idle&&displacement<.4;
 return{ready,ineffective:idle||spinning,idle,spinning,path,displacement};
}
export function scorePhase1(previous:SurvivalWorld,next:SurvivalWorld,motionPenalty=0):RewardBreakdown {
 const captures=next.runners.filter(r=>!r.active&&r.eliminationReason==='capture').length,before=previous.runners.filter(r=>!r.active&&r.eliminationReason==='capture').length;
 const elapsed=Math.max(0,(next.tick-previous.tick)*previous.dt),terminal=previous.phase!=='finished'&&next.phase==='finished'&&captures>=7?10+10*(1-next.tick/next.maxTicks):0;
 const result={survival:0,terminal,capture:2*Math.max(0,captures-before),zone:0,skill:0,shaping:0,penalty:-.02*elapsed-motionPenalty};
 return{...result,total:Object.values(result).reduce((a,b)=>a+b,0)};
}

import type {SurvivalMap} from '../survival/map';
import type {SurvivalActions,SurvivalWorld} from '../survival/world';
import {createSurvivalWorld} from '../survival/world';
import {createPursuitState,decideBaselineActions} from '../pursuit';
import {cellPoint,distance,findPursuitPath,nextOnPath,searchMap,segmentAllowed} from '../pursuit/navigation';
import {integrateMotion} from '../survival/motion';
import {sampleTerrain} from '../survival/map';

import {positionCell} from '../survival/pathing';
import {resolveDemonCaptures} from './physics';
import {Rng} from '../rng';
import {adaptFacility} from './facility';
import {availableItems,closureStep,collectPickups,emit,useItems,senseDecoy} from './items';
import type {DemonMatch} from './types';
export type * from './types';
export const DEMON_VERSION='two-stage-v1';
const counters=()=>({sprint:0,decoy:0,phase:0,lock:0});
function makeWorld(map:SurvivalMap,seed:number,ratio:number):SurvivalWorld{
 const world=createSurvivalWorld({seed,map,maxTicks:2500,hunterSpeedMultiplier:ratio,skillsDisabled:true,zoneSchedule:{dt:.1,initial:{anchor:map.hunterSpawn,vertices:[{x:0,y:0},{x:map.width,y:0},{x:map.width,y:map.height},{x:0,y:map.height}]},phases:[]}});
 delete world.rules;for(const r of world.runners)delete r.skill;return world;
}
function stageSetup(m:DemonMatch){
 const facility=adaptFacility(m.maps[m.stage-1]!,m.stage),old=m.world;
 m.world=makeWorld(facility.map,m.seed,m.hunterSpeedRatio);m.world.tick=m.elapsedTicks;
 if(m.stage===2)m.world.runners=m.world.runners.filter(r=>old.runners.some(o=>o.id===r.id&&o.active)).map(r=>({...r,survivalSeconds:old.runners.find(o=>o.id===r.id)!.survivalSeconds}));
 m.entry=facility.entry;m.pursuit=createPursuitState(m.seed^m.stage*9973);m.roomGoals={};m.pickups=[];m.sprints={};m.decoy=undefined;m.closures=[];m.pendingEscapes=[];m.doorPassages={};
 const rng=new Rng(m.seed^m.stage*2654435761);
 facility.targets.forEach((position,i)=>{const options=availableItems(m,position);m.pickups.push({id:`${m.stage}-${i}`,roomId:m.world.map.rooms[i]!.id,position,type:options[Math.floor(rng.next()*options.length)]!})});
 m.phase='selection';m.phaseTicks=0;emit(m,m.stage===1?'selection':'stage-start',{alive:m.world.runners.length});
}
export function createDemonMatch(maps:SurvivalMap[],seed:number,hunterSpeedRatio=1.35):DemonMatch{
 if(maps.length<2)throw Error('demon match requires two distinct source maps');if(!Number.isFinite(seed))throw Error('invalid demon seed');
 const distinct=maps.slice(1).filter(map=>map.seed!==maps[0]!.seed);if(!distinct.length)throw Error('demon maps must differ');const rng=new Rng(seed);const chosen=[maps[0]!,distinct[Math.floor(rng.next()*distinct.length)]!];
 const m:DemonMatch={seed,phase:'selection',stage:1,elapsedTicks:0,phaseTicks:0,world:null as unknown as SurvivalWorld,pursuit:createPursuitState(seed),mapIds:chosen.map(map=>String(map.seed)),maps:chosen.map(map=>structuredClone(map)),pickups:[],inventory:{},events:[],stats:{captures:0,itemUses:counters(),escapes:counters()},entry:{x:0,y:0},roomGoals:{},sprints:{},doorPassages:{},closures:[],pendingEscapes:[],hunterSpeedRatio};stageSetup(m);return m;
}
function clone(m:DemonMatch):DemonMatch{
 return{...m,world:{...m.world,map:{...m.world.map,doors:structuredClone(m.world.map.doors)},runners:structuredClone(m.world.runners),hunter:structuredClone(m.world.hunter),events:[...m.world.events]},pursuit:structuredClone(m.pursuit),pickups:structuredClone(m.pickups),inventory:{...m.inventory},events:[...m.events],stats:structuredClone(m.stats),roomGoals:structuredClone(m.roomGoals),sprints:{...m.sprints},doorPassages:structuredClone(m.doorPassages),decoy:m.decoy?structuredClone(m.decoy):undefined,closures:structuredClone(m.closures),pendingEscapes:structuredClone(m.pendingEscapes)};
}
function finish(m:DemonMatch){const alive=m.world.runners.filter(r=>r.active);m.phase='finished';m.stats.reason=alive.length===1?'last-survivor':alive.length===0?'all-eliminated':'timeout';m.stats.winnerId=alive.length===1?alive[0]!.id:undefined;m.world.phase='finished';for(const actor of [...m.world.runners,m.world.hunter])actor.kinematics.velocity={x:0,y:0};m.world.result={reason:m.stats.reason,winnerKind:alive.length===1?'runner':alive.length===0?'hunter':'none',winnerId:m.stats.winnerId,tick:m.elapsedTicks,rankings:m.world.runners.map(r=>({id:r.id,survivalSeconds:r.survivalSeconds,exposure:0,insideZone:true}))};emit(m,'finished',{alive:alive.length,reason:m.stats.reason})}
function transition(m:DemonMatch){m.stats.stage1Survivors=m.world.runners.filter(r=>r.active).length;m.stats.stage1ChaseTicks=m.phaseTicks;m.phase='transition';m.phaseTicks=0;emit(m,'transition',{alive:m.stats.stage1Survivors})}
function selectionActions(m:DemonMatch):SurvivalActions{
 const actions:SurvivalActions={};for(const r of m.world.runners.filter(r=>r.active)){const p=r.kinematics.position;let goal=m.roomGoals[r.id];if(!goal){const search=searchMap(m.world.map,p,m.world.tick);const options=m.pickups.filter(p=>!p.collectedBy);const scored=options.map(pickup=>{const d=search.distances[Math.floor(pickup.position.y)*m.world.map.width+Math.floor(pickup.position.x)]!;const crowd=Object.entries(m.roomGoals).filter(([id,q])=>id!==r.id&&distance(q,pickup.position)<1).length;const preference=new Rng(m.seed^Number(r.id)*9973^Number(pickup.id.split('-')[1])*97).next();return{pickup,score:d+crowd*100+preference*18}}).sort((a,b)=>a.score-b.score);goal=scored[0]?.pickup.position;m.roomGoals[r.id]=goal??p}const waypoint=goal?nextOnPath(m.world.map,p,findPursuitPath(m.world.map,p,goal,m.world.tick),m.world.tick):undefined;actions[r.id]={move:waypoint?{x:waypoint.x-p.x,y:waypoint.y-p.y}:{x:0,y:0}}}return actions;
}
function summon(m:DemonMatch){const map=m.world.map,positions=m.world.runners.filter(r=>r.active).map(r=>r.kinematics.position);const cells=searchMap(map,map.hunterSpawn,m.world.tick).cells;const spawn=cells.map(c=>cellPoint(map,c)).filter(p=>positions.every(q=>distance(p,q)>=5)).sort((a,b)=>distance(a,map.hunterSpawn)-distance(b,map.hunterSpawn))[0];if(!spawn)throw Error('no safe demon entrance');m.world.hunter.kinematics.position=spawn;m.world.hunter.kinematics.velocity={x:0,y:0};m.phase='chase';m.phaseTicks=0;emit(m,'summon')}
export function stepDemonMatch(match:DemonMatch):DemonMatch{
 if(match.phase==='finished'||match.phase==='transition')return match;
 const m=clone(match);let alive=m.world.runners.filter(r=>r.active).length;if(alive<=1){finish(m);return m}if(m.elapsedTicks>=2500){finish(m);return m}if(m.stage===1&&m.phase==='chase'&&(alive<=4||m.phaseTicks>=1000)){transition(m);return m}
 let actions:SurvivalActions;if(m.phase==='selection')actions=selectionActions(m);else{actions=decideBaselineActions(m.world,m.pursuit);useItems(m);if(m.decoy&&senseDecoy(m)){const p=m.world.hunter.kinematics.position,waypoint=nextOnPath(m.world.map,p,findPursuitPath(m.world.map,p,m.decoy.position,m.world.tick),m.world.tick);if(waypoint)actions.hunter={move:{x:waypoint.x-p.x,y:waypoint.y-p.y}}}}
 const starts=Object.fromEntries([...m.world.runners,m.world.hunter].map(a=>[a.id,{...a.kinematics.position}]));const oldAlive=alive;m.elapsedTicks++;m.phaseTicks++;m.world.tick=m.elapsedTicks;
 for(const actor of [...m.world.runners.filter(r=>r.active),...(m.phase==='chase'?[m.world.hunter]:[])]){const action=actions[actor.id],p=actor.kinematics.position,move=action?.move??{x:0,y:0};const sprint=(m.sprints[actor.id]??0)>=m.world.tick?1.6:1;const proposed=integrateMotion(actor.kinematics,{move,desiredHeading:Math.atan2(move.y,move.x)},actor.kind==='hunter'&&sampleTerrain(m.world.map,p)==='mud'?'floor':sampleTerrain(m.world.map,p),.1,actor.kind==='hunter'?m.hunterSpeedRatio:sprint);if(segmentAllowed(m.world.map,p,proposed.position,m.world.tick))actor.kinematics=proposed;else actor.kinematics.velocity={x:0,y:0};if(actor.kind==='runner')actor.survivalSeconds+=.1}

 for(const r of m.world.runners.filter(r=>r.active)){const from=positionCell(m.world.map,starts[r.id]!),to=positionCell(m.world.map,r.kinematics.position);const door=m.world.map.doors.find(d=>positionCell(m.world.map,d.position)===from&&from!==to);if(door)m.doorPassages[r.id]={id:door.id,tick:m.world.tick}}
 if(m.phase==='chase')resolveDemonCaptures(m,starts);
 collectPickups(m);
 alive=m.world.runners.filter(r=>r.active).length;if(oldAlive>2&&alive===2)emit(m,'last-two',{alive});
 if(alive<=1||m.elapsedTicks>=2500){finish(m);return m}
 if(m.phase==='selection'&&m.phaseTicks>=(m.stage===1?150:100))summon(m);
 else if(m.stage===1&&m.phase==='chase'&&(alive<=4||m.phaseTicks>=1000))transition(m);
 if(m.stage===2&&m.elapsedTicks>=2100){m.world.map.terrain=[...m.world.map.terrain];closureStep(m)}return m;
}
export function advanceDemonTransition(match:DemonMatch):DemonMatch{if(match.phase!=='transition')return match;const m=clone(match);m.stage=2;stageSetup(m);return m}

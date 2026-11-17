/** Basic capability diagnostics, deliberately separate from learned-policy evaluation. */
import { createSurvivalFixture } from '../src/sim/survival/fixtures';
import { createSurvivalWorld, stepSurvivalWorld } from '../src/sim/survival/world';
import { buildHunterObservation } from '../src/sim/survival/observation';
import { decideFallback, decideFromObservation, FALLBACK_VERSION } from '../src/ai/fallback-policy';
import { Rng } from '../src/sim/rng';

const results=[];
for(const seed of [1,7,42,1701,2026]){
  const map=createSurvivalFixture(Array.from({length:24},(_,y)=>y===0||y===23?'#'.repeat(36):`#${'.'.repeat(34)}#`));
  map.runnerSpawns=Array.from({length:8},(_,i)=>({x:3.5+i*2,y:4.5}));
  map.hunterSpawn={x:10.5,y:18.5};
  let patrol=createSurvivalWorld({seed,map,captureRadius:0}),covered=new Set<string>();
  const origin={...patrol.hunter.kinematics.position};
  for(let tick=0;tick<80;tick++){
    const observation=buildHunterObservation(patrol);
    observation.visibleRunners=[];observation.lastSeen=[];observation.clues=[];
    patrol=stepSurvivalWorld(patrol,{hunter:decideFromObservation(observation,'hunter',.1,new Rng(seed+tick))});
    const p=patrol.hunter.kinematics.position;covered.add(`${Math.floor(p.x)},${Math.floor(p.y)}`);
  }
  let chase=createSurvivalWorld({seed,map,captureRadius:.65});
  chase.hunter.kinematics.position={x:5.5,y:10.5};
  chase.runners[0]!.kinematics.position={x:12.5,y:10.5};
  for(let tick=0;tick<120&&chase.runners[0]!.active;tick++)chase=stepSurvivalWorld(chase,{hunter:decideFallback(chase,'hunter',new Rng(seed+tick))});
  results.push({seed,patrolSeconds:8,patrolDisplacement:Math.hypot(patrol.hunter.kinematics.position.x-origin.x,patrol.hunter.kinematics.position.y-origin.y),patrolCells:covered.size,
    stationaryTargetCaptured:chase.runners[0]!.eliminationReason==='capture',captureSeconds:chase.runners[0]!.active?null:chase.tick*.1});
}
console.log(JSON.stringify({controller:FALLBACK_VERSION,scenario:'open-room-no-hidden-coordinate-access',learnedPolicyEvidence:false,results},null,2));

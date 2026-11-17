import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createPursuitWorld,createPursuitState,decideBaselineActions,updatePursuit,SPAWN_POLICY_VERSION,SPAWN_PATH_MIN,SPAWN_PATH_MAX} from '../src/sim/pursuit';
import {stepSurvivalWorld} from '../src/sim/survival/world';
const count=Number(process.argv[2]??10),maxTicks=Number(process.argv[3]??2000),offset=Number(process.argv[4]??0),rows=[];
const started=performance.now();
for(let seed=1+offset;seed<=count+offset;seed++){
 const mapId=String((seed-1)%10+1).padStart(2,'0'),map=JSON.parse(readFileSync(new URL(`../public/maps/phase1/${mapId}.json`,import.meta.url),'utf8'));
 let w=createPursuitWorld(map,seed,1.35,maxTicks);const state=createPursuitState(seed),first={hunter:{...w.hunter.kinematics.position},runners:w.runners.map(r=>({...r.kinematics.position}))};let switches=0,lastSwitch=0,blocked=0,hunterTravel=0;const runnerStats=Object.fromEntries(w.runners.map(r=>[r.id,{travel:0,activeTicks:0,stationaryTicks:0}]));
 while(w.phase==='running'){const old=w,before=w.hunter.kinematics.position;w=stepSurvivalWorld(w,decideBaselineActions(w,state));updatePursuit(w,state);hunterTravel+=Math.hypot(w.hunter.kinematics.position.x-before.x,w.hunter.kinematics.position.y-before.y);for(const r of old.runners.filter(r=>r.active)){const next=w.runners.find(n=>n.id===r.id)!,d=Math.hypot(next.kinematics.position.x-r.kinematics.position.x,next.kinematics.position.y-r.kinematics.position.y),st=runnerStats[r.id]!;st.travel+=d;st.activeTicks++;if(d<1e-6)st.stationaryTicks++}if(Math.hypot(w.hunter.kinematics.position.x-before.x,w.hunter.kinematics.position.y-before.y)<1e-6)blocked++;if(state.hunter.switchCount>lastSwitch)switches++;lastSwitch=state.hunter.switchCount}
 const row={seed,mapId,ticks:w.tick,seconds:w.tick*w.dt,captures:w.runners.filter(r=>!r.active).length,reason:w.result?.reason,winner:w.result?.winnerId,hunterTravel,runnerStats,switches,hunterBlockedTicks:blocked,hunterDisplacement:Math.hypot(w.hunter.kinematics.position.x-first.hunter.x,w.hunter.kinematics.position.y-first.hunter.y)};
 rows.push(row);console.log(JSON.stringify(row));
}
const result={protocol:'los40-switch2-v1',baseline:'automatic-chase-escape-v1',count,maxTicks,hunterSpeedRatio:1.35,spawnPolicy:SPAWN_POLICY_VERSION,spawnPathRange:[SPAWN_PATH_MIN,SPAWN_PATH_MAX],runnerPlanningHorizon:12,wallSeconds:(performance.now()-started)/1000,completed:rows.filter(r=>r.reason==='last-survivor').length,meanCaptures:rows.reduce((n,r)=>n+r.captures,0)/rows.length,rows};
mkdirSync('artifacts',{recursive:true});writeFileSync(`artifacts/pursuit-benchmark${offset?'-holdout':''}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));

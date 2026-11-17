import {readFileSync} from 'node:fs';
import {createPursuitWorld,createPursuitState,decideBaselineActions,updatePursuit} from '../src/sim/pursuit';
import {stepSurvivalWorld} from '../src/sim/survival/world';
const map=JSON.parse(readFileSync(new URL('../public/maps/phase1/01.json',import.meta.url),'utf8'));
let w=createPursuitWorld(map,1);const s=createPursuitState(1);
while(w.phase==='running'){w=stepSurvivalWorld(w,decideBaselineActions(w,s));updatePursuit(w,s);if(w.tick%100===0){const target=w.runners.find(r=>r.id===s.hunter.targetId);console.log(JSON.stringify({seconds:w.tick/10,captured:w.runners.filter(r=>!r.active).length,...s.hunter,actualDistance:target?Math.hypot(target.kinematics.position.x-w.hunter.kinematics.position.x,target.kinematics.position.y-w.hunter.kinematics.position.y):null}))}}

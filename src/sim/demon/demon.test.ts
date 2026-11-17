import {describe,it,expect} from 'vitest';
import {generateSurvivalMap} from '../survival/map';
import {createDemonMatch,stepDemonMatch,advanceDemonTransition} from './index';
const make=()=>createDemonMatch([generateSurvivalMap(1),generateSurvivalMap(2)],42);
describe('demon effective timing',()=>{
 it('protects selection for exactly150 ticks and never captures',()=>{let m=make();m.world.hunter.kinematics.position={...m.world.runners[0]!.kinematics.position};for(let i=0;i<149;i++)m=stepDemonMatch(m);expect(m.phase).toBe('selection');expect(m.world.runners.every(r=>r.active)).toBe(true);m=stepDemonMatch(m);expect(m.phase).toBe('chase');expect(m.elapsedTicks).toBe(150)});
 it('freezes transition and carries every survivor and inventory',()=>{let m=make();m.phase='chase';m.phaseTicks=1000;m.inventory['01']='sprint';m=stepDemonMatch(m);expect(m.phase).toBe('transition');const t=m.elapsedTicks;expect(stepDemonMatch(m)).toEqual(m);m=advanceDemonTransition(m);expect(m.stage).toBe(2);expect(m.elapsedTicks).toBe(t);expect(m.inventory['01']).toBe('sprint');expect(m.world.runners.filter(r=>r.active)).toHaveLength(8);for(let i=0;i<100;i++)m=stepDemonMatch(m);expect(m.phase).toBe('chase')});
 it('ends immediately at one survivor and reports actual timeout survivors',()=>{let m=make();m.world.runners.slice(1).forEach(r=>r.active=false);m=stepDemonMatch(m);expect(m.phase).toBe('finished');expect(m.elapsedTicks).toBe(0);expect(m.stats.winnerId).toBe('01');m=make();m.stage=2;m.phase='chase';m.elapsedTicks=2499;m=stepDemonMatch(m);expect(m.elapsedTicks).toBe(2500);expect(m.stats.reason).toBe('timeout');expect(m.world.runners.filter(r=>r.active)).toHaveLength(8)});
 it('replays deterministically with serializable states and different maps',()=>{let a=make(),b=make();for(let i=0;i<160;i++){a=stepDemonMatch(a);b=stepDemonMatch(b)}expect(a).toEqual(b);expect(a.mapIds[0]).not.toBe(a.mapIds[1]);expect(()=>structuredClone(a)).not.toThrow()});
});

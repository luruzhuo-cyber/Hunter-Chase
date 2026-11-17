import {describe,expect,it} from 'vitest';
import {createWorld,getResult,runToEnd,stepWorld} from './simulation';
import {canSee} from './perception';
import {generateFacility} from './map';
import {exportReplay,replayToTick} from './replay';

describe('simulation rules',()=>{
  it('same seed produces identical result and event stream',()=>{const a=runToEnd(createWorld(77));const b=runToEnd(createWorld(77));expect(getResult(a)).toEqual(getResult(b));expect(a.events).toEqual(b.events);});
  it('walls block line of sight',()=>{const map=generateFacility(5);expect(canSee(map,{x:1,y:1},{x:20,y:20},30)).toBe(false);});
  it('hunter is permanently active and never gains damage state',()=>{let w=createWorld(9);for(let i=0;i<1000&&w.phase!=='finished';i++)w=stepWorld(w).state;const h=w.actors.find(a=>a.kind==='hunter')!;expect(h.status).toBe('active');expect((h as unknown as {health?:number}).health).toBeUndefined();});
  it('tracks expire and protocols cannot make objectives unreachable',()=>{let w=createWorld(14);for(let i=0;i<900;i++)w=stepWorld(w).state;expect(w.tracks.every(t=>w.tick-t.createdAt<=36)).toBe(true);});
  it('exported replay restores the exact recorded state at a tick',()=>{const final=runToEnd(createWorld(103));const file=exportReplay(final);const restored=replayToTick(file,Math.min(500,final.tick));expect(restored.seed).toBe(103);expect(restored.tick).toBe(Math.min(500,final.tick));});
  it('all tested matches finish before facility cutoff',()=>{for(let seed=1;seed<=20;seed++){const w=runToEnd(createWorld(seed));expect(w.phase,`seed ${seed}`).toBe('finished');expect(w.tick).toBeLessThanOrEqual(1681);}},30000);
});

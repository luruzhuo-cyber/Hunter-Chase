import {describe,it,expect} from 'vitest';
import {generateSurvivalMap} from '../sim/survival/map';
import {createSurvivalWorld} from '../sim/survival/world';
import {buildHunterObservation} from '../sim/survival/observation';
import {encodePursuitObservation,pursuitPotential,PURSUIT_OBSERVATION_SIZE} from './pursuit-model';

describe('pursuit model observation contract',()=>{
 it('uses 325 finite values and ignores continuous legacy actor coordinates',()=>{
  const world=createSurvivalWorld({seed:1701,map:generateSurvivalMap(1701)});
  const base=buildHunterObservation(world);
  const target={switchCount:0,locked:false,lastSeenTick:-1,observedAt:0,visibleCount:0,status:'patrol' as const};
  const a=encodePursuitObservation(base,target);
  const b=encodePursuitObservation({...base,visibleRunners:[{id:'01',position:{x:1,y:2},velocity:{x:3,y:4},heading:0}],lastSeen:[{id:'02',position:{x:7,y:8},tick:0}],clues:[{id:'x',kind:'sound',position:{x:9,y:10},createdTick:0,expiresTick:100,strength:1}]},target);
  expect(a).toHaveLength(PURSUIT_OBSERVATION_SIZE);
  expect(a.every(Number.isFinite)).toBe(true);
  expect(a).toEqual(b);
 });
 it('potential is bounded, routes to known snapshot only and resets at termination',()=>{
  const target={targetId:'01',lastPosition:{x:10,y:10},pathDistance:5,switchCount:0,locked:false,lastSeenTick:0,observedAt:0,visibleCount:1,status:'pursuit' as const};
  expect(pursuitPotential(target)).toBeGreaterThan(0);
  expect(pursuitPotential(target)).toBeLessThanOrEqual(.5);
  expect(pursuitPotential({...target,pathDistance:15})).toBeLessThan(pursuitPotential(target));
  expect(pursuitPotential(target,true)).toBe(0);
 });
});

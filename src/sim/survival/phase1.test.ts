import { describe,it,expect } from 'vitest';
import { createPhase1, randomRunnerActions, scorePhase1, movementWindow } from '../../../training/phase1';
import { stepSurvivalWorld } from './world';
import { buildHunterObservation } from './observation';
import { buildLegalActionMask } from '../../ai/fallback-policy';
describe('hunter phase1',()=>{
 it('loads fixed geometry independent of route seed and disables zone/skills',()=>{
  const a=createPhase1('01',11),b=createPhase1('01',12);
  expect(a.map.terrain).toEqual(b.map.terrain);expect(a.map.seed).toBe(b.map.seed);
  expect(a.hunterSpeedMultiplier).toBe(1.35);expect(a.zoneSchedule.phases).toEqual([]);
  expect(a.runners.every(r=>!r.skillUsed&&!r.skill)).toBe(true);
 });
 it('physical capture stops exactly at seven without skills or exposure',()=>{
  let w=createPhase1('01',80);const p={...w.hunter.kinematics.position};w.runners.forEach(r=>r.kinematics.position={...p});
  const next=stepSurvivalWorld(w,{});expect(next.runners.filter(r=>r.active)).toHaveLength(1);
  expect(next.result?.reason).toBe('last-survivor');expect(scorePhase1(w,next).terminal).toBeGreaterThan(0);
  expect(next.runners.every(r=>r.exposure===0&&!r.skillUsed)).toBe(true);
 });
 it('actual motion reaches 1.35 times runner cruise speed and forecast uses the same multiplier',()=>{
  let w=createPhase1('01',90);const p=w.map.runnerSpawns[0]!;
  // Find an observed straight clear corridor long enough for cruise speed.
  const cell=w.map.terrain.findIndex((t,i)=>t==='floor'&&Array.from({length:8},(_,j)=>w.map.terrain[i+j]).every(x=>x==='floor'));
  const start={x:cell%w.map.width+.5,y:Math.floor(cell/w.map.width)+.5};
  w.hunter.kinematics.position={...start};w.runners[0]!.kinematics.position={x:start.x,y:start.y+2};
  for(let i=0;i<5;i++)w=stepSurvivalWorld(w,{hunter:{move:{x:1,y:0}},'01':{move:{x:1,y:0}}});
  expect(Math.hypot(w.hunter.kinematics.velocity.x,w.hunter.kinematics.velocity.y)).toBeCloseTo(2.8*1.35);
  const obs=buildHunterObservation(w);expect(obs.self.speedMultiplier).toBe(1.35);
  expect(buildLegalActionMask(obs,'hunter',.1).some(Boolean)).toBe(true);
 });
 it('frozen waypoint movement is reproducible and ignores hunter coordinates',()=>{
  let a=createPhase1('02',44),b=createPhase1('02',44);const sa={},sb={};
  const start=structuredClone(a.runners.map(r=>r.kinematics.position));
  for(let i=0;i<60;i++){b.hunter.kinematics.position={x:1,y:1};const aa=randomRunnerActions(a,sa),bb=randomRunnerActions(b,sb);expect(aa).toEqual(bb);a=stepSurvivalWorld(a,aa);b=stepSurvivalWorld(b,bb)}
  expect(a.runners.filter((r,i)=>Math.hypot(r.kinematics.position.x-start[i]!.x,r.kinematics.position.y-start[i]!.y)>3).length).toBeGreaterThanOrEqual(6);
 });
 it('rewards seventh capture and faster completion; detects one-second inactivity',()=>{
  const a=createPhase1('03',50);a.runners.slice(0,6).forEach(r=>{r.active=false;r.eliminationReason='capture'});
  const b=structuredClone(a);b.tick=100;b.runners[6]!.active=false;b.runners[6]!.eliminationReason='capture';b.phase='finished';
  const c=structuredClone(b);c.tick=200;
  expect(scorePhase1(a,b).terminal).toBeGreaterThan(scorePhase1(a,c).terminal);expect(scorePhase1(a,b).capture).toBe(2);
  expect(movementWindow(Array.from({length:11},(_,tick)=>({tick,position:{x:10,y:10}})),.1).ineffective).toBe(true);
  const straight=Array.from({length:11},(_,tick)=>({tick,position:{x:10+tick*.3,y:10}}));
  expect(movementWindow(straight,.1).ineffective).toBe(false);
  const spin=Array.from({length:11},(_,tick)=>({tick,position:{x:10+.1*Math.cos(tick*Math.PI/5),y:10+.1*Math.sin(tick*Math.PI/5)}}));
  expect(movementWindow(spin,.1).spinning).toBe(true);
  expect(scorePhase1(a,b,.1).total).toBeLessThan(scorePhase1(a,b).total);
 });
});

import {describe,it,expect} from 'vitest';
import {createDemonMatch} from './index';
import {generateSurvivalMap} from '../survival/map';
import {resolveDemonCaptures} from './physics';
import {senseDecoy} from './items';
const make=()=>{const m=createDemonMatch([generateSurvivalMap(1),generateSurvivalMap(2)],42);m.phase='chase';m.world.map.terrain=m.world.map.terrain.map(()=> 'floor');m.world.map.doors=[];return m};
describe('continuous capture timestamps',()=>{
 it('ends at a real unique survivor between distinct impact times',()=>{const m=make();m.world.runners.slice(3).forEach(r=>r.active=false);m.world.hunter.kinematics.position={x:5.5,y:5.5};const starts:Record<string,{x:number;y:number}>={hunter:{x:5.5,y:5.5}};for(const [i,r] of m.world.runners.slice(0,3).entries()){starts[r.id]={x:5.7+i,y:5.5};r.kinematics.position={x:5.8,y:5.5}}resolveDemonCaptures(m,starts);expect(m.world.runners.filter(r=>r.active).map(r=>r.id)).toEqual(['03']);expect(m.events.filter(e=>e.type==='capture').map(e=>e.actorId)).toEqual(['01','02']);expect(m.world.runners[2]!.kinematics.position.x).toBeGreaterThan(6.15)});
 it('keeps genuinely simultaneous impacts tied without choosing a winner',()=>{const m=make();m.world.runners.slice(2).forEach(r=>r.active=false);m.world.hunter.kinematics.position={x:5.5,y:5.5};const starts:Record<string,{x:number;y:number}>={hunter:{x:5.5,y:5.5}};for(const r of m.world.runners.slice(0,2)){starts[r.id]={x:6.5,y:5.5};r.kinematics.position={x:5.8,y:5.5}}resolveDemonCaptures(m,starts);expect(m.world.runners.filter(r=>r.active)).toHaveLength(0)});
 it('does not capture through a wall even if relative lines approach',()=>{const m=make();m.world.runners.slice(1).forEach(r=>r.active=false);m.world.hunter.kinematics.position={x:5.9,y:5.5};m.world.runners[0]!.kinematics.position={x:6.1,y:5.5};m.world.map.terrain[5*m.world.map.width+6]='wall';resolveDemonCaptures(m,{hunter:{x:5.9,y:5.5},'01':{x:6.1,y:5.5}});expect(m.world.runners[0]!.active).toBe(true)});
});
describe('decoy sampled perception',()=>{
 it('samples at sensor ticks with20rangeLOS, then investigates explicit remembered position',()=>{const m=make();m.world.hunter.kinematics.position={x:5.5,y:5.5};m.decoy={position:{x:10.5,y:5.5},expiresTick:30};m.pursuit.hunter.observedAt=-1;expect(senseDecoy(m)).toBe(false);m.pursuit.hunter.observedAt=0;expect(senseDecoy(m)).toBe(true);m.world.tick=1;m.world.map.terrain[5*m.world.map.width+7]='wall';expect(senseDecoy(m)).toBe(true);m.world.tick=30;expect(senseDecoy(m)).toBe(false)});
 it('rejects distant and occluded beacons at the sample',()=>{const m=make();m.world.hunter.kinematics.position={x:5.5,y:5.5};m.pursuit.hunter.observedAt=0;m.decoy={position:{x:26.5,y:5.5},expiresTick:30};expect(senseDecoy(m)).toBe(false);m.decoy.position={x:10.5,y:5.5};m.world.map.terrain[5*m.world.map.width+7]='wall';expect(senseDecoy(m)).toBe(false)});
});

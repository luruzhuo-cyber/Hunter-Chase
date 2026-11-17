import {describe,it,expect} from 'vitest';
import {decorationHash,sceneryKey,facilityBounds,captureProgress} from './scene';
const map={seed:7,width:5,height:4,terrain:['wall','wall','wall','wall','wall','wall','floor','floor','wall','wall','wall','floor','floor','wall','wall','wall','wall','wall','wall','wall'],rooms:[],doors:[]} as any;
describe('presentation isolation',()=>{
 it('has deterministic independent decoration without mutating terrain',()=>{const before=JSON.stringify(map);expect(decorationHash(7,2,3)).toBe(decorationHash(7,2,3));expect(decorationHash(7,2,3)).not.toBe(decorationHash(7,3,2));facilityBounds(map);sceneryKey(map,1);expect(JSON.stringify(map)).toBe(before)});
 it('invalidates scenery for terrain and stage, not transient door locks',()=>{expect(sceneryKey(map,1)).not.toBe(sceneryKey(map,2));expect(sceneryKey(map,1)).not.toBe(sceneryKey({...map,terrain:map.terrain.map((t:string,i:number)=>i===6?'wall':t)},1));expect(sceneryKey(map,1)).toBe(sceneryKey({...map,doors:[]},1))});
 it('fits the carved facility with a wall margin',()=>{expect(facilityBounds(map)).toEqual({x:0,y:0,width:4,height:4})});
 it('fades only actual captures over 350 ms of simulation time',()=>{expect(captureProgress(10,10)).toBe(0);expect(captureProgress(10,11.75)).toBe(.5);expect(captureProgress(10,14)).toBe(1)});
});

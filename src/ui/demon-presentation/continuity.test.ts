import {describe,it,expect} from 'vitest';
import {PresentationContinuity} from './continuity';
describe('presentation continuity',()=>{
 it('continues ordinary snapshots and resets a same-stage restart',()=>{const state=new PresentationContinuity();expect(state.update({seed:4,mapSeed:20,stage:1,tick:0})).toBe(true);expect(state.update({seed:4,mapSeed:20,stage:1,tick:8})).toBe(false);expect(state.update({seed:4,mapSeed:20,stage:1,tick:0})).toBe(true)});
 it('resets a new seed or facility even at the same tick',()=>{const state=new PresentationContinuity();state.update({seed:4,mapSeed:20,stage:1,tick:0});expect(state.update({seed:5,mapSeed:20,stage:1,tick:0})).toBe(true);expect(state.update({seed:5,mapSeed:21,stage:1,tick:0})).toBe(true);expect(state.update({seed:5,mapSeed:21,stage:2,tick:0})).toBe(true)});
});

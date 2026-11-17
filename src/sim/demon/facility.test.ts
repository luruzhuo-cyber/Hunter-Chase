import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {adaptFacility} from './facility';
import type {SurvivalMap} from '../survival/map';
import {isTraversable} from '../survival/pathing';
describe('fixed ten-map facility contracts',()=>{
 for(let id=1;id<=10;id++)it(`retains8/4 actual room interiors for map${id}`,()=>{const source=JSON.parse(readFileSync(`public/maps/phase1/${String(id).padStart(2,'0')}.json`,'utf8')) as SurvivalMap;for(const stage of [1,2] as const){const {map,targets}=adaptFacility(source,stage);expect(targets.length).toBeGreaterThanOrEqual(stage===1?8:4);for(const room of map.rooms){const cells=map.terrain.flatMap((_,c)=>{const x=c%map.width+.5,y=Math.floor(c/map.width)+.5;return isTraversable(map,c,'hunter')&&x>=room.x&&x<room.x+room.width&&y>=room.y&&y<room.y+room.height?[c]:[]});expect(cells.length).toBeGreaterThanOrEqual(4)}}});
});

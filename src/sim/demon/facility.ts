import type {SurvivalMap} from '../survival/map';
import {validateSurvivalMap} from '../survival/map';
import type {Vec2} from '../survival/types';
import {cellPoint,searchMap,distance} from '../pursuit/navigation';
import {positionCell} from '../survival/pathing';
/** Source geometry is retained inside a connected geodesic neighbourhood; pipes become normal floor. */
export function adaptFacility(source:SurvivalMap,stage:1|2):{map:SurvivalMap;entry:Vec2;targets:Vec2[]}{
 const validation=validateSurvivalMap(source);if(!validation.valid)throw Error(`invalid demon source: ${validation.errors.join(', ')}`);
 const map=structuredClone(source);map.pipes=[];map.terrain=map.terrain.map(t=>t==='pipe'?'floor':t);map.doors=map.doors.map(d=>({...d,kind:'security',lockedUntil:0}));
 const all=searchMap(map,map.hunterSpawn),minimum=Math.min(stage===1?8:4,map.rooms.length);
 const interiors=map.rooms.map(room=>{const cells=all.cells.filter(c=>{const p=cellPoint(map,c);return p.x>=room.x&&p.x<room.x+room.width&&p.y>=room.y&&p.y<room.y+room.height});const target=cells.map(c=>cellPoint(map,c)).sort((a,b)=>distance(a,{x:room.x+room.width/2,y:room.y+room.height/2})-distance(b,{x:room.x+room.width/2,y:room.y+room.height/2}))[0];return{room,cells,target}}).filter(r=>r.target&&r.cells.length>=4);
 if(interiors.length<minimum)throw Error('source does not have enough accessible room interiors');
 // Pick the cluster with the shortest geodesic reach to the eighth/fourth actual room centre.
 const candidates=interiors.map(r=>{const centre=r.target!,radial=searchMap(map,centre);const required=interiors.map(r=>radial.distances[positionCell(map,r.target!)]!).sort((a,b)=>a-b)[minimum-1]!;return{centre,radial,radius:Math.max(stage===1?35:22,required+2),score:required+distance(centre,{x:map.width/2,y:map.height/2})*.05}}).sort((a,b)=>a.score-b.score);
 const best=candidates[0]!;if(!best)throw Error('empty facility');const {centre,radial}=best;let radius=best.radius;
 const retained=()=>interiors.filter(r=>radial.distances[positionCell(map,r.target!)]!<=radius-2&&r.cells.filter(c=>radial.distances[c]!<=radius).length>=4);
 while(retained().length<minimum&&radius<map.terrain.length)radius+=2;
 const chosen=retained(); map.terrain=map.terrain.map((t,c)=>radial.distances[c]!>=0&&radial.distances[c]!<=radius?t:'wall');
 map.doors=map.doors.filter(d=>map.terrain[positionCell(map,d.position)]!=='wall');
 const open=searchMap(map,centre);if(open.cells.length<30)throw Error('facility too small');
 const entryCell=[...open.cells].sort((a,b)=>open.distances[b]!-open.distances[a]!||a-b)[0]!;const entry=cellPoint(map,entryCell),entranceSearch=searchMap(map,entry);
 map.runnerSpawns=[...entranceSearch.cells].sort((a,b)=>entranceSearch.distances[a]!-entranceSearch.distances[b]!||a-b).slice(0,8).map(c=>cellPoint(map,c));
 map.hunterSpawn=centre;map.futureZoneAnchors=[centre];
 map.rooms=chosen.map(r=>r.room);
 const targets=chosen.map(r=>r.target!);
 if(!targets.length)throw Error('no reachable room targets');
 // Open security frames at genuine narrow corridor cells provide temporary door items in every facility.
 for(const c of open.cells){if(map.doors.length>=6)break;const x=c%map.width,y=Math.floor(c/map.width),p=cellPoint(map,c);const solid=(cc:number)=>map.terrain[cc]==='wall'||map.terrain[cc]==='shelf';const narrow=(solid(c-1)&&solid(c+1))||(solid(c-map.width)&&solid(c+map.width));if(x>1&&y>1&&x<map.width-2&&y<map.height-2&&narrow&&map.doors.every(d=>distance(d.position,p)>7)&&map.runnerSpawns.every(q=>distance(q,p)>2)&&distance(p,map.hunterSpawn)>2)map.doors.push({id:'demon-door-'+c,position:p,kind:'security',direction:{x:1,y:0},lockedUntil:0})}
 const result=validateSurvivalMap(map);if(!result.valid)throw Error(`invalid adapted facility: ${result.errors.join(', ')}`);
 return{map,entry,targets};
}

import type {SurvivalMap} from '../survival/map';
import type {Vec2} from '../survival/types';
import {positionCell,isTraversable} from '../survival/pathing';
import {hasLineOfSight} from '../survival/observation';
export const distance=(a:Vec2,b:Vec2)=>Math.hypot(a.x-b.x,a.y-b.y);
export const cellPoint=(map:SurvivalMap,cell:number):Vec2=>({x:cell%map.width+.5,y:Math.floor(cell/map.width)+.5});
export type Search={parents:Int32Array;distances:Int32Array;cells:number[]};
export function searchMap(map:SurvivalMap,from:Vec2,tick=0):Search{
 const start=positionCell(map,from),parents=new Int32Array(map.terrain.length).fill(-1),distances=new Int32Array(map.terrain.length).fill(-1),cells:number[]=[];
 const doors=new Map(map.doors.map(d=>[positionCell(map,d.position),d]));
 // Runners may coast onto a pipe entrance; permit recovery out of that source cell only.
 // Candidate edges still exclude all pipe cells. Hunters cannot physically enter them.
 if(!isTraversable(map,start,'hunter')&&map.terrain[start]!=='pipe')return{parents,distances,cells};parents[start]=start;distances[start]=0;cells.push(start);
 for(let h=0;h<cells.length;h++){const a=cells[h]!,x=a%map.width,y=Math.floor(a/map.width);
  for(const b of [x>0?a-1:-1,x<map.width-1?a+1:-1,y>0?a-map.width:-1,y<map.height-1?a+map.width:-1]){
   if(!isTraversable(map,b,'hunter')||parents[b]!==-1)continue;const dx=b%map.width-x,dy=Math.floor(b/map.width)-y;
   if([doors.get(a),doors.get(b)].some(d=>d&&(d.lockedUntil>tick||d.kind==='oneway'&&dx*d.direction.x+dy*d.direction.y<0)))continue;
   parents[b]=a;distances[b]=distances[a]!+1;cells.push(b);
  }
 }return{parents,distances,cells};
}
export function pathFromSearch(map:SurvivalMap,from:Vec2,to:Vec2,search:Search):Vec2[]{
 const start=positionCell(map,from),end=positionCell(map,to);if(end<0||search.parents[end]===-1||search.parents[end]===undefined)return[];
 const cells=[end];for(let c=end;c!==start;){c=search.parents[c]!;if(c<0)return[];cells.push(c)}
 return[{...from},...cells.reverse().map(c=>cellPoint(map,c)),{...to}];
}
export function findPursuitPath(map:SurvivalMap,from:Vec2,to:Vec2,tick=0):Vec2[]{return pathFromSearch(map,from,to,searchMap(map,from,tick))}
export function segmentAllowed(map:SurvivalMap,a:Vec2,b:Vec2,tick:number):boolean{
 if(!hasLineOfSight(map,a,b,tick))return false;
 const doors=new Map(map.doors.map(d=>[positionCell(map,d.position),d]));
 const source=positionCell(map,a);
 const clear=(x:number,y:number)=>{if(x<0||y<0||x>=map.width||y>=map.height)return false;const cell=y*map.width+x;if(!isTraversable(map,cell,'hunter')&&!(cell===source&&map.terrain[cell]==='pipe'))return false;const d=doors.get(cell);return !(d&&(d.lockedUntil>tick||d.kind==='oneway'&&(b.x-a.x)*d.direction.x+(b.y-a.y)*d.direction.y<0))};
 let x=Math.floor(a.x),y=Math.floor(a.y);const ex=Math.floor(b.x),ey=Math.floor(b.y),dx=b.x-a.x,dy=b.y-a.y,sx=Math.sign(dx),sy=Math.sign(dy),stepX=dx===0?Infinity:Math.abs(1/dx),stepY=dy===0?Infinity:Math.abs(1/dy);let tx=dx===0?Infinity:((sx>0?x+1:x)-a.x)/dx,ty=dy===0?Infinity:((sy>0?y+1:y)-a.y)/dy;
 if(!clear(x,y))return false;
 while(x!==ex||y!==ey){const nx=x===ex?Infinity:tx,ny=y===ey?Infinity:ty;if(Math.abs(nx-ny)<1e-12){if(!clear(x+sx,y)||!clear(x,y+sy))return false;x+=sx;y+=sy;tx+=stepX;ty+=stepY}else if(nx<ny){x+=sx;tx+=stepX}else{y+=sy;ty+=stepY}if(!clear(x,y))return false}return true;
}
export function nextOnPath(map:SurvivalMap,position:Vec2,path:Vec2[],tick:number):Vec2|undefined{
 let best:Vec2|undefined;for(const p of path){if(distance(position,p)<.3)continue;if(segmentAllowed(map,position,p,tick))best=p;else if(best)break}return best;
}

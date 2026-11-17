import type {FacilityMap,Point} from './types';
import {cellAt} from './map';
export const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
export function canSee(map:FacilityMap,a:Point,b:Point,range=8){
  if(distance(a,b)>range)return false; const steps=Math.ceil(distance(a,b)*3);
  for(let i=1;i<steps;i++){const t=i/steps,p={x:Math.round(a.x+(b.x-a.x)*t),y:Math.round(a.y+(b.y-a.y)*t)};if(cellAt(map,p)==='wall')return false;}return true;
}

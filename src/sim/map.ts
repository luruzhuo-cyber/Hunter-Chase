import { Rng } from './rng';
import type { FacilityMap,Point,RoomKind } from './types';

const W=48,H=32;
const key=(p:Point)=>`${p.x},${p.y}`;
export const cellAt=(map:FacilityMap,p:Point)=>p.x>=0&&p.y>=0&&p.x<map.width&&p.y<map.height?map.cells[p.y*map.width+p.x]:'wall';
export const neighbours=(map:FacilityMap,p:Point)=>[{x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1}].filter(n=>cellAt(map,n)==='floor');

export function findPath(map:FacilityMap,start:Point,goal:Point,blocked=new Set<string>()):Point[]{
  const q=[start], came=new Map<string,Point|null>([[key(start),null]]);
  for(let i=0;i<q.length;i++){
    const cur=q[i]!; if(cur.x===goal.x&&cur.y===goal.y){const out:Point[]=[];let p:Point|null=cur;while(p){out.push(p);p=came.get(key(p))??null;}return out.reverse();}
    for(const n of neighbours(map,cur)) if(!came.has(key(n))&&!blocked.has(key(n))){came.set(key(n),cur);q.push(n);}
  } return [];
}

function carve(cells:FacilityMap['cells'],x:number,y:number,w:number,h:number){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)if(xx>0&&yy>0&&xx<W-1&&yy<H-1)cells[yy*W+xx]='floor';}
function corridor(cells:FacilityMap['cells'],a:Point,b:Point,horizontalFirst:boolean){
  const line=(p:Point,q:Point)=>{let x=p.x,y=p.y; while(x!==q.x||y!==q.y){carve(cells,x-1,y-1,3,3); if(x!==q.x)x+=Math.sign(q.x-x);else y+=Math.sign(q.y-y);}carve(cells,q.x-1,q.y-1,3,3);};
  const bend=horizontalFirst?{x:b.x,y:a.y}:{x:a.x,y:b.y};line(a,bend);line(bend,b);
}

export function generateFacility(seed:number):FacilityMap{
  const rng=new Rng(seed), cells=Array.from({length:W*H},()=> 'wall' as const) as FacilityMap['cells'];
  const baseSpecs:{kind:RoomKind;label:string;x:number;y:number;width:number;height:number}[]=[
    {kind:'living',label:'居住舱',x:2,y:2,width:11,height:8},
    {kind:'bio',label:'生物实验室',x:18,y:2,width:11,height:8},
    {kind:'energy',label:'能源站',x:35,y:2,width:10,height:8},
    {kind:'monitoring',label:'监控室',x:3,y:21,width:10,height:8},
    {kind:'maintenance',label:'维护隧道',x:18,y:20,width:11,height:9},
    {kind:'quarantine',label:'隔离区',x:35,y:20,width:10,height:9},
    {kind:'evacuation',label:'撤离大厅',x:35,y:12,width:10,height:6},
  ];
  const specs=baseSpecs.map((r,i)=>({...r,x:r.x+(i<6?rng.int(-1,1):0),y:r.y+(i<6?rng.int(-1,1):0)}));
  specs.forEach(r=>carve(cells,r.x,r.y,r.width,r.height));
  const center=(i:number)=>({x:Math.floor(specs[i]!.x+specs[i]!.width/2),y:Math.floor(specs[i]!.y+specs[i]!.height/2)});
  // A ring plus cross-links guarantees alternate routes while still changing shape by seed.
  [[0,1],[1,2],[2,6],[6,5],[5,4],[4,3],[3,0],[0,4],[1,4],[4,6],[1,6]].forEach(([a,b],i)=>corridor(cells,center(a!),center(b!),((seed+i)&1)===0));
  const floorIn=(r=specs[0]!)=>({x:rng.int(r.x+1,r.x+r.width-2),y:rng.int(r.y+1,r.y+r.height-2)});
  const termRooms=rng.shuffle([0,1,2,3,4,5]).slice(0,3);
  const terminals=termRooms.map((ri,i)=>({id:`T${i+1}`,position:floorIn(specs[ri]),active:false,progress:0}));
  const runnerSpawns=Array.from({length:8},(_,i)=>({x:specs[0]!.x+2+(i%4)*2,y:specs[0]!.y+2+Math.floor(i/4)*2}));
  const elevator=floorIn(specs[6]);
  const doorPoints=[center(1),center(2),center(3),center(5),{x:33,y:15}].map(p=>({x:p.x,y:p.y}));
  const doors=doorPoints.map((position,i)=>({id:`D${i+1}`,position,kind:(i===4?'security':i===2?'oneway':'normal') as 'normal'|'security'|'oneway',lockedUntil:0,blockedUntil:0}));
  const vents=[{id:'V1',a:floorIn(specs[0]),b:floorIn(specs[4]),disabledUntil:0},{id:'V2',a:floorIn(specs[1]),b:floorIn(specs[5]),disabledUntil:0}];
  const itemKinds=['chip','decoy','barricade','decoy','barricade'] as const;
  const items=itemKinds.map((kind,i)=>({id:`I${i+1}`,kind,position:floorIn(specs[(i+1)%6]),taken:false}));
  return {width:W,height:H,cells,rooms:specs.map((r,i)=>({id:`R${i}`, ...r})),doors,vents,terminals,elevator,runnerSpawns,hunterSpawn:floorIn(specs[5]),items};
}

export function validateFacility(map:FacilityMap):{valid:boolean;errors:string[];exitRouteCount:number}{
  const errors:string[]=[]; const start=map.runnerSpawns[0]!;
  const objectives=[...map.terminals.map(t=>t.position),map.elevator];
  for(const p of objectives) if(findPath(map,start,p).length===0) errors.push(`unreachable ${key(p)}`);
  for(const v of map.vents) if(cellAt(map,v.a)!=='floor'||cellAt(map,v.b)!=='floor')errors.push(`invalid vent ${v.id}`);
  const first=findPath(map,start,map.elevator); let routes=first.length?1:0;
  if(first.length){const blocked=new Set(first.slice(2,-2).map(key));if(findPath(map,start,map.elevator,blocked).length)routes++;}
  if(routes<2)errors.push('fewer than two independent evacuation routes');
  if(findPath(map,map.hunterSpawn,map.elevator).length===0)errors.push('hunter disconnected');
  return {valid:errors.length===0,errors,exitRouteCount:routes};
}

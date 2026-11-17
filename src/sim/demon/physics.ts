import type {DemonMatch} from './types';
import type {Vec2} from '../survival/types';
import {segmentAllowed} from '../pursuit/navigation';
import {emit} from './items';
const lerp=(a:Vec2,b:Vec2,t:number):Vec2=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
/** Earliest relative circle contact, including a pre-existing overlap at t=0. */
function impact(a:Vec2,b:Vec2,c:Vec2,d:Vec2,radius:number):number|undefined{
 const x=a.x-c.x,y=a.y-c.y,vx=b.x-a.x-d.x+c.x,vy=b.y-a.y-d.y+c.y,C=x*x+y*y-radius*radius;if(C<=1e-10)return 0;const A=vx*vx+vy*vy;if(A<1e-12)return;const B=2*(x*vx+y*vy),disc=B*B-4*A*C;if(disc<0)return;const t=(-B-Math.sqrt(disc))/(2*A);return t>=-1e-9&&t<=1+1e-9?Math.max(0,Math.min(1,t)):undefined;
}
export function resolveDemonCaptures(m:DemonMatch,starts:Record<string,Vec2>){
 const hunter=m.world.hunter,h0=starts.hunter!,h1={...hunter.kinematics.position};const ends=Object.fromEntries(m.world.runners.map(r=>[r.id,{...r.kinematics.position}]));
 const hits=m.world.runners.filter(r=>r.active).flatMap(r=>{const p0=starts[r.id],p1=ends[r.id]!;if(!p0)return[];const t=impact(h0,h1,p0,p1,m.world.captureRadius);if(t===undefined||!segmentAllowed(m.world.map,lerp(h0,h1,t),lerp(p0,p1,t),m.world.tick))return[];return[{r,t}]}).sort((a,b)=>a.t-b.t||a.r.id.localeCompare(b.r.id));
 for(let i=0;i<hits.length;){const t=hits[i]!.t;let j=i;while(j<hits.length&&Math.abs(hits[j]!.t-t)<1e-8){const r=hits[j]!.r;r.active=false;r.eliminatedAt=m.elapsedTicks;r.eliminationReason='capture';r.kinematics.position=lerp(starts[r.id]!,ends[r.id]!,t);r.kinematics.velocity={x:0,y:0};m.stats.captures++;m.world.events.push({tick:m.elapsedTicks,type:'elimination',actorId:r.id,reason:'capture'});emit(m,'capture',{actorId:r.id});j++}
  if(m.world.runners.filter(r=>r.active).length<=1){hunter.kinematics.position=lerp(h0,h1,t);hunter.kinematics.velocity={x:0,y:0};for(const r of m.world.runners.filter(r=>r.active)){r.kinematics.position=lerp(starts[r.id]!,ends[r.id]!,t);r.kinematics.velocity={x:0,y:0}}break}i=j;
 }
}

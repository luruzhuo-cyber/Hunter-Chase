import type {DemonMatch,DemonItem,DemonEvent} from './types';
import type {Vec2} from '../survival/types';
import {hasLineOfSight} from '../survival/observation';
import {positionCell,isTraversable} from '../survival/pathing';
import {distance,searchMap,cellPoint} from '../pursuit/navigation';
export function emit(m:DemonMatch,type:DemonEvent['type'],extra:Partial<DemonEvent>={}){m.events.push({id:(m.events.at(-1)?.id??0)+1,type,elapsedTick:m.elapsedTicks,stage:m.stage,...extra})}
export function phaseLanding(m:DemonMatch,p:Vec2,threat?:Vec2):Vec2|undefined{
 const map=m.world.map,from=positionCell(map,p),x=from%map.width,y=Math.floor(from/map.width);const reached=searchMap(map,m.entry,m.world.tick);
 return [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}].flatMap(d=>{const wall={x:x+d.x+.5,y:y+d.y+.5},to={x:p.x+2*d.x,y:p.y+2*d.y};const wc=positionCell(map,wall),tc=positionCell(map,to);return distance(p,wall)<=1.6&&map.terrain[wc]==='wall'&&isTraversable(map,tc,'hunter')&&reached.distances[tc]!>=0&&!map.doors.some(door=>door.lockedUntil>m.world.tick&&positionCell(map,door.position)===tc)?[to]:[]}).sort((a,b)=>(threat?distance(b,threat)-distance(a,threat):0))[0];
}
export function availableItems(m:DemonMatch,p:Vec2):DemonItem[]{const items:DemonItem[]=['sprint','decoy'];if(searchMap(m.world.map,p).cells.some(c=>distance(cellPoint(m.world.map,c),p)<=6&&phaseLanding(m,cellPoint(m.world.map,c))))items.push('phase');if(m.world.map.doors.some(d=>distance(d.position,p)<=15))items.push('lock');return items}
export function collectPickups(m:DemonMatch){for(const r of [...m.world.runners].sort((a,b)=>a.id.localeCompare(b.id))){if(!r.active)continue;const pickup=m.pickups.find(p=>!p.collectedBy&&distance(r.kinematics.position,p.position)<1);if(pickup){m.inventory[r.id]=pickup.type;pickup.collectedBy=r.id;emit(m,'pickup',{actorId:r.id,item:pickup.type})}}}
export function useItems(m:DemonMatch){
 for(const r of m.world.runners){if(!r.active)continue;const item=m.inventory[r.id],p=r.kinematics.position,h=m.world.hunter.kinematics.position;const memory=m.pursuit.runners[r.id];const visible=distance(p,h)<=12&&hasLineOfSight(m.world.map,p,h,m.world.tick);if(!item||(!visible&&!(item==='decoy'&&memory?.threat&&m.world.tick-memory.seenTick<=30)))continue;let used=false;
 if(item==='sprint'&&memory?.path.length){m.sprints[r.id]=m.world.tick+20;used=true}
 if(item==='decoy'&&!m.decoy){m.decoy={position:{...p},expiresTick:m.world.tick+30};used=true}
 if(item==='phase'){const to=phaseLanding(m,p,visible?h:memory?.threat);if(to){r.kinematics.position=to;r.kinematics.velocity={x:0,y:0};delete m.pursuit.runners[r.id];used=true}}
 if(item==='lock'){const d=m.world.map.doors.find(d=>d.lockedUntil<=m.world.tick&&m.doorPassages[r.id]?.id===d.id&&m.world.tick-m.doorPassages[r.id]!.tick<=10&&(h.x-d.position.x)*(p.x-d.position.x)+(h.y-d.position.y)*(p.y-d.position.y)<0&&distance(p,d.position)>.8&&distance(p,d.position)<2.2&&distance(h,d.position)>distance(p,d.position)&&!m.world.runners.filter(a=>a.active).concat(m.world.hunter).some(a=>positionCell(m.world.map,a.kinematics.position)===positionCell(m.world.map,d.position)));if(d){d.lockedUntil=m.world.tick+30;used=true}}
 if(used){m.inventory[r.id]=undefined;m.stats.itemUses[item]++;m.pendingEscapes.push({actorId:r.id,item,checkTick:m.world.tick+50});emit(m,'item-use',{actorId:r.id,item})}
 }
 if(m.decoy&&(m.world.tick>=m.decoy.expiresTick||distance(m.world.hunter.kinematics.position,m.decoy.position)<.7))m.decoy=undefined;
 m.pendingEscapes=m.pendingEscapes.filter(e=>{if(m.world.tick<e.checkTick)return true;const r=m.world.runners.find(r=>r.id===e.actorId);if(r?.active&&distance(r.kinematics.position,m.world.hunter.kinematics.position)>8)m.stats.escapes[e.item]++;return false});
}
export function closureStep(m:DemonMatch){
 if(m.stage!==2||m.elapsedTicks<2100)return;
 const map=m.world.map;
 if(!m.closures.length){const search=searchMap(map,map.hunterSpawn,m.world.tick);const outer=search.cells.filter(c=>search.distances[c]!>=10).sort((a,b)=>search.distances[b]!-search.distances[a]!||a-b);for(let i=0;i<outer.length;i+=12)m.closures.push({id:`closure-${i}`,cells:outer.slice(i,i+12),warnedAt:2100+Math.floor(i/12)*40,closed:false})}
 for(const closure of m.closures){if(closure.closed||closure.skipped||m.elapsedTicks<closure.warnedAt)continue;if(m.elapsedTicks===closure.warnedAt)emit(m,'closure-warning',{reason:closure.id});if(m.elapsedTicks<closure.warnedAt+30)continue;
 const occupied=[...m.world.runners.filter(r=>r.active),m.world.hunter].some(r=>closure.cells.includes(positionCell(map,r.kinematics.position)));if(occupied){closure.skipped=true;continue}
 const original=closure.cells.map(c=>map.terrain[c]!);closure.cells.forEach(c=>map.terrain[c]='wall');const reach=searchMap(map,m.world.hunter.kinematics.position,m.world.tick);const safe=reach.cells.length>=30&&map.terrain.filter((_,c)=>isTraversable(map,c,'hunter')).length===reach.cells.length&&reach.distances[positionCell(map,m.entry)]!>=0&&m.world.runners.filter(r=>r.active).every(r=>reach.distances[positionCell(map,r.kinematics.position)]!>=0);
 if(!safe){closure.cells.forEach((c,i)=>map.terrain[c]=original[i]!);closure.skipped=true}else{closure.closed=true;m.pickups=m.pickups.filter(p=>!closure.cells.includes(positionCell(map,p.position)));m.roomGoals={};m.pursuit.runners={};m.pursuit.patrolGoal=undefined;emit(m,'closure',{reason:closure.id})}
 }
}


/** Only the once-per-second hunter sample can discover a beacon; investigation remembers that explicit clue. */
export function senseDecoy(m:DemonMatch):boolean{
 const d=m.decoy;if(!d||m.world.tick>=d.expiresTick||distance(m.world.hunter.kinematics.position,d.position)<.7)return false;
 if(!d.heard&&m.pursuit.hunter.observedAt===m.world.tick&&distance(m.world.hunter.kinematics.position,d.position)<=20&&hasLineOfSight(m.world.map,m.world.hunter.kinematics.position,d.position,m.world.tick))d.heard=true;
 return d.heard===true;
}

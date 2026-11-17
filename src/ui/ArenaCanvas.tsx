import { useEffect, useRef } from 'react';
import type { SurvivalWorld } from '../sim/survival/world';
import type { Vec2 } from '../sim/survival/types';
import { interpolationAlpha } from './interpolation';

const RUNNER_COLORS = ['#c7b36a','#739a91','#a97b62','#aea285','#8e849b','#a3938b','#718d98','#9f956e'];
const TERRAIN: Record<string,string> = { floor:'#222a2a',shadow:'#151b1d',mud:'#40382c',metal:'#3b4647',wall:'#0c1011',pipe:'#335e5d',shelf:'#5a4c37' };
const lerpAngle=(a:number,b:number,t:number)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
const mix=(a:Vec2,b:Vec2,t:number):Vec2=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});

export function ArenaCanvas({ previous, world, snapshotAt, director, playbackSpeed }: { previous: SurvivalWorld; world: SurvivalWorld; snapshotAt: number; director: boolean; playbackSpeed: number }) {
  const ref=useRef<HTMLCanvasElement>(null), props=useRef({previous,world,snapshotAt,director,playbackSpeed}); props.current={previous,world,snapshotAt,director,playbackSpeed};
  useEffect(()=>{let frame=0;const draw=(now:number)=>{const canvas=ref.current;if(!canvas)return;const {previous,world,snapshotAt,director,playbackSpeed}=props.current;
    const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio,2);if(canvas.width!==Math.round(rect.width*dpr)||canvas.height!==Math.round(rect.height*dpr)){canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr)}
    const ctx=canvas.getContext('2d')!;ctx.setTransform(dpr,0,0,dpr,0,0);const w=rect.width,h=rect.height,pad=12,alpha=interpolationAlpha(now,snapshotAt,world.dt,playbackSpeed);
    const baseScale=Math.min((w-pad*2)/world.map.width,(h-pad*2)/world.map.height);let scale=baseScale,ox=(w-world.map.width*scale)/2,oy=(h-world.map.height*scale)/2;
    if(director&&world.tick>0){const runner=[...world.runners].filter(item=>item.active).sort((a,b)=>Math.hypot(a.kinematics.position.x-world.hunter.kinematics.position.x,a.kinematics.position.y-world.hunter.kinematics.position.y)-Math.hypot(b.kinematics.position.x-world.hunter.kinematics.position.x,b.kinematics.position.y-world.hunter.kinematics.position.y))[0];if(runner){const focus={x:(runner.kinematics.position.x+world.hunter.kinematics.position.x)/2,y:(runner.kinematics.position.y+world.hunter.kinematics.position.y)/2};scale=baseScale*1.42;ox=Math.min(pad,Math.max(w-world.map.width*scale-pad,w/2-focus.x*scale));oy=Math.min(pad,Math.max(h-world.map.height*scale-pad,h/2-focus.y*scale))}}
    const point=(p:Vec2)=>({x:ox+p.x*scale,y:oy+p.y*scale});
    ctx.fillStyle='#090d0e';ctx.fillRect(0,0,w,h);
    for(let y=0;y<world.map.height;y++)for(let x=0;x<world.map.width;x++){ctx.fillStyle=TERRAIN[world.map.terrain[y*world.map.width+x]!]!;ctx.fillRect(ox+x*scale,oy+y*scale,scale+.25,scale+.25)}
    ctx.strokeStyle='#75818122';ctx.lineWidth=.6;world.map.rooms.forEach(room=>{ctx.strokeRect(ox+room.x*scale,oy+room.y*scale,room.width*scale,room.height*scale)});
    world.map.shelves.forEach(s=>{ctx.fillStyle='#68573e';ctx.fillRect(ox+s.x*scale,oy+s.y*scale,s.width*scale,s.height*scale)});
    world.map.pipes.forEach(pipe=>{for(const entrance of [pipe.a,pipe.b]){const p=point(entrance);ctx.fillStyle='#477b77';ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,scale*.35),0,Math.PI*2);ctx.fill()}});
    world.map.doors.forEach(door=>{const p=point(door.position),locked=door.lockedUntil>world.tick;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(door.direction.y,door.direction.x)+Math.PI/2);ctx.strokeStyle=locked?'#bb684d':door.kind==='oneway'?'#789999':'#b3965e';ctx.lineWidth=Math.max(2,scale*.18);ctx.beginPath();ctx.moveTo(-scale*.45,0);ctx.lineTo(scale*.45,0);ctx.stroke();if(door.kind==='oneway'){ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.moveTo(0,-scale*.32);ctx.lineTo(scale*.18,-scale*.08);ctx.lineTo(-scale*.18,-scale*.08);ctx.fill()}ctx.restore()});
    const drawZone=(vertices:Vec2[],color:string,dash:number[])=>{ctx.save();ctx.beginPath();vertices.forEach((v,i)=>{const p=point(v);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)});ctx.closePath();ctx.strokeStyle=color;ctx.lineWidth=world.zone.warning?2.4:1.6;ctx.setLineDash(dash);ctx.shadowBlur=world.zone.warning?8:0;ctx.shadowColor=color;ctx.stroke();ctx.restore()};drawZone(world.zone.vertices,'#79aeb0',[]);if(world.zone.warning&&world.zone.next)drawZone(world.zone.next.vertices,'#d89a3d',[7,5]);
    const beacons=world.skills.effects.filter(effect=>effect.skill==='beacon'&&effect.createdTick<=world.tick&&effect.expiresTick>world.tick);
    beacons.forEach(effect=>{const p=point(effect.position),pulse=.72+.18*Math.sin(now/90);ctx.save();ctx.strokeStyle='#d89a3d';ctx.fillStyle='#d89a3d';ctx.shadowColor='#d89a3d';ctx.shadowBlur=10;ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(p.x,p.y,Math.max(4,scale*.5)*pulse,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(p.x,p.y-scale*.7);ctx.lineTo(p.x+scale*.45,p.y+scale*.45);ctx.lineTo(p.x-scale*.45,p.y+scale*.45);ctx.closePath();ctx.fill();ctx.restore()});
    const old=new Map([...previous.runners,previous.hunter].map(a=>[a.id,a]));const pixels:string[]=[];
    const hunterOld=old.get(world.hunter.id)??world.hunter,hp=mix(hunterOld.kinematics.position,world.hunter.kinematics.position,alpha),heading=lerpAngle(hunterOld.kinematics.heading,world.hunter.kinematics.heading,alpha),hpt=point(hp);
    ctx.fillStyle='#a844362b';ctx.beginPath();ctx.moveTo(hpt.x,hpt.y);ctx.arc(hpt.x,hpt.y,12*scale,heading-Math.PI*75/180,heading+Math.PI*75/180);ctx.closePath();ctx.fill();ctx.strokeStyle='#a8443688';ctx.stroke();ctx.save();ctx.translate(hpt.x,hpt.y);ctx.rotate(heading+Math.PI/4);ctx.fillStyle='#a84436';ctx.fillRect(-scale*.45,-scale*.45,scale*.9,scale*.9);ctx.restore();pixels.push(`H:${hpt.x.toFixed(2)},${hpt.y.toFixed(2)}`);
    world.runners.forEach((runner,index)=>{if(!runner.active)return;const prior=old.get(runner.id)??runner,p=point(mix(prior.kinematics.position,runner.kinematics.position,alpha)),radius=Math.max(4,scale*.38);ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fillStyle=RUNNER_COLORS[index]!;ctx.fill();ctx.fillStyle='#121718';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`700 ${Math.max(7,scale*.36)}px Bahnschrift, sans-serif`;ctx.fillText(runner.id,p.x,p.y+.3);pixels.push(`${runner.id}:${p.x.toFixed(2)},${p.y.toFixed(2)}`)});
    if(director){ctx.strokeStyle='#d89a3d55';ctx.strokeRect(ox+3,oy+3,world.map.width*scale-6,world.map.height*scale-6)}
    canvas.dataset.actorPixels=pixels.join('|');canvas.dataset.beaconsRendered=String(beacons.length>0);canvas.dataset.frame=String(Number(canvas.dataset.frame??0)+1);frame=requestAnimationFrame(draw)};frame=requestAnimationFrame(draw);return()=>cancelAnimationFrame(frame)},[]);
  return <canvas ref={ref} className="arena-canvas" aria-label="K-17 生存设施俯视图" data-zone-visible="true" data-tracks-rendered="false" data-sound-rings-rendered="false"/>;
}

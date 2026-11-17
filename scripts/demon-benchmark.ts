import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {SurvivalMap} from '../src/sim/survival/map';
import type {DemonItem} from '../src/sim/demon/types';
import {isTraversable,positionCell} from '../src/sim/survival/pathing';

export type DemonEpisode={seed:number;mapId:string;seconds:number;reason:string;winnerId?:string;captures:number;stage1Survivors:number;stage1ChaseSeconds:number;stage2Reached:boolean;invalidPositions:number;itemUses:Record<DemonItem,number>;escapes:Record<DemonItem,number>;survivalSeconds:Record<string,number>;signature?:string};
const items:DemonItem[]=['sprint','decoy','phase','lock'];
const mean=(xs:number[])=>xs.length?xs.reduce((n,x)=>n+x,0)/xs.length:0;
export function summarizeDemonEpisodes(rows:DemonEpisode[]){
 if(!rows.length)throw Error('benchmark requires episodes');
 return {episodeCount:rows.length,uniqueSurvivorRate:rows.filter(r=>r.reason==='last-survivor').length/rows.length,stage1FourOrLessRate:rows.filter(r=>r.stage1Survivors<=4&&r.stage1ChaseSeconds<=100).length/rows.length,timeoutRate:rows.filter(r=>r.reason==='timeout').length/rows.length,meanSeconds:mean(rows.map(r=>r.seconds)),meanCaptures:mean(rows.map(r=>r.captures)),stage2ReachedRate:rows.filter(r=>r.stage2Reached).length/rows.length,invalidPositions:rows.reduce((n,r)=>n+r.invalidPositions,0),
  perMap:Array.from(new Set(rows.map(r=>r.mapId))).sort().map(mapId=>{const group=rows.filter(r=>r.mapId===mapId);return{mapId,episodes:group.length,uniqueSurvivorRate:group.filter(r=>r.reason==='last-survivor').length/group.length,stage1FourOrLessRate:group.filter(r=>r.stage1Survivors<=4&&r.stage1ChaseSeconds<=100).length/group.length,meanCaptures:mean(group.map(r=>r.captures)),meanSeconds:mean(group.map(r=>r.seconds))}}),
  runners:Array.from({length:8},(_,i)=>String(i+1).padStart(2,'0')).map(id=>({id,meanSurvivalSeconds:mean(rows.map(r=>r.survivalSeconds[id]??r.seconds)),wins:rows.filter(r=>r.winnerId===id&&r.reason==='last-survivor').length,winRate:rows.filter(r=>r.winnerId===id&&r.reason==='last-survivor').length/rows.length})),
  items:Object.fromEntries(items.map(item=>{const uses=rows.reduce((n,r)=>n+r.itemUses[item],0),escaped=rows.reduce((n,r)=>n+r.escapes[item],0);return[item,{uses,safeBeyondEightCellsAfterFiveSeconds:escaped,postUseEscapeRate:uses?escaped/uses:null}]})),
 };
}
export async function runDemonEpisode(maps:SurvivalMap[],seed:number):Promise<DemonEpisode>{
 const {createDemonMatch,stepDemonMatch,advanceDemonTransition}=await import('../src/sim/demon');
 const first=((seed-1)%maps.length+maps.length)%maps.length,ordered=[...maps.slice(first),...maps.slice(0,first)];
 let match=createDemonMatch(ordered,seed),invalidPositions=0,iterations=0;const survivalSeconds:Record<string,number>={};
 while(match.phase!=='finished'){
  if(++iterations>2510)throw Error(`seed ${seed} exceeded rule budget`);
  match=match.phase==='transition'?advanceDemonTransition(match):stepDemonMatch(match);
  for(const actor of [...match.world.runners.filter(r=>r.active),match.world.hunter])if(!Number.isFinite(actor.kinematics.position.x)||!Number.isFinite(actor.kinematics.position.y)||!isTraversable(match.world.map,positionCell(match.world.map,actor.kinematics.position),actor.kind))invalidPositions++;
 }
 for(const id of Array.from({length:8},(_,i)=>String(i+1).padStart(2,'0'))){const death=match.events.find(e=>e.type==='capture'&&e.actorId===id);survivalSeconds[id]=(death?.elapsedTick??match.elapsedTicks)/10}
 return{seed,mapId:String(first+1).padStart(2,'0'),seconds:match.elapsedTicks/10,reason:match.stats.reason??'unknown',winnerId:match.stats.winnerId,captures:match.stats.captures,stage1Survivors:match.stats.stage1Survivors??match.world.runners.filter(r=>r.active).length,stage1ChaseSeconds:(match.stats.stage1ChaseTicks??Math.max(0,match.elapsedTicks-150))/10,stage2Reached:match.stage===2,invalidPositions,itemUses:match.stats.itemUses,escapes:match.stats.escapes,survivalSeconds,signature:createHash('sha256').update(JSON.stringify({world:match.world,events:match.events,stats:match.stats})).digest('hex')};
}
async function main(){
 const count=Number(process.argv[2]??200),offset=Number(process.argv[3]??0),out=resolve(process.argv[4]??'artifacts/demon-benchmark.json');
 if(!Number.isInteger(count)||count<1||!Number.isInteger(offset)||offset<0)throw Error('count and seed offset must be non-negative integers; count>=1');
 const maps=Array.from({length:10},(_,i)=>JSON.parse(readFileSync(new URL(`../public/maps/phase1/${String(i+1).padStart(2,'0')}.json`,import.meta.url),'utf8')) as SurvivalMap),rows:DemonEpisode[]=[],start=performance.now();
 for(let seed=1+offset;seed<=count+offset;seed++){const row=await runDemonEpisode(maps,seed);rows.push(row);console.log(JSON.stringify(row))}
 let repeatabilityMismatches=0;for(const row of rows.slice(0,Math.min(10,count)))if((await runDemonEpisode(maps,row.seed)).signature!==row.signature)repeatabilityMismatches++;
 const report={version:'demon-two-stage-v1',controller:'code-controlled',maxSeconds:250,hunterSpeedRatio:1.35,seedOffset:offset,...summarizeDemonEpisodes(rows),repeatabilityChecked:Math.min(10,count),repeatabilityMismatches,wallSeconds:(performance.now()-start)/1000,goals:{stage1FourOrLessRate:.8,uniqueSurvivorRate:.95},rows};mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:undefined}));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)void main().catch(error=>{console.error(error);process.exitCode=1});

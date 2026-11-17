import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {runDemonEpisode} from './demon-benchmark';
import type {SurvivalMap} from '../src/sim/survival/map';

async function main(){
 const evidence=JSON.parse(readFileSync('artifacts/demon-benchmark-200.json','utf8'));
 const hash=createHash('sha256');
 for(const name of readdirSync('src/sim/demon').filter(n=>n.endsWith('.ts')&&!n.endsWith('.test.ts')).sort()){
  const path=`src/sim/demon/${name}`;hash.update(path);hash.update(readFileSync(path,'utf8').replace(/\r\n/g,'\n'));
 }
 const runtimeSourceHash=hash.digest('hex');
 if(runtimeSourceHash!==evidence.runtimeSourceHash)throw Error('Simulation source differs from validated two-stage baseline');
 const maps=Array.from({length:10},(_,i)=>JSON.parse(readFileSync(`public/maps/phase1/${String(i+1).padStart(2,'0')}.json`,'utf8')) as SurvivalMap);
 const rows=[];
 for(const seed of [1,2,3,4,5,6,7,8,9,10,178]){
  const actual=await runDemonEpisode(maps,seed),before=evidence.rows.find((r:{seed:number})=>r.seed===seed);
  const matches=actual.signature===before?.signature;rows.push({seed,matches,reason:actual.reason,seconds:actual.seconds});
  if(!matches)throw Error(`Presentation upgrade changed match ${seed}`);
 }
 const result={runtimeSourceHash,unchangedRules:true,checkedSeeds:rows.length,signatureMismatches:rows.filter(r=>!r.matches).length,rows};
 mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/lab-presentation-parity.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
void main().catch(error=>{console.error(error);process.exitCode=1});

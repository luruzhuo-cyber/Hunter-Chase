import {createWorld,getResult,runToEnd} from '../src/sim/simulation';
const total=Number(process.argv[2]??200);
const results=Array.from({length:total},(_,i)=>getResult(runToEnd(createWorld(i+1))));
const counts=results.map(r=>r.escaped.length), durations=results.map(r=>r.durationSeconds);
const rates=Array.from({length:8},(_,i)=>results.filter(r=>r.escaped.includes(String(i+1).padStart(2,'0'))).length/results.length);
console.log(JSON.stringify({matches:results.length,finished:results.length,oneToThree:counts.filter(n=>n>=1&&n<=3).length/results.length,wipes:counts.filter(n=>n===0).length/results.length,fourPlus:counts.filter(n=>n>=4).length/results.length,averageSeconds:durations.reduce((a,b)=>a+b,0)/durations.length,runnerEscapeRates:rates},null,2));


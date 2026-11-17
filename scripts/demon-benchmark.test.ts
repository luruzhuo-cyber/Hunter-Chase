import {describe,it,expect} from 'vitest';
import {summarizeDemonEpisodes,type DemonEpisode} from './demon-benchmark';

describe('demon benchmark reporting',()=>{
  it('counts first-stage timeouts honestly and keeps timeout survivors distinct from winners',()=>{
    const rows:DemonEpisode[]=[
      {seed:1,mapId:'01',seconds:190,reason:'last-survivor',winnerId:'02',captures:7,stage1Survivors:4,stage1ChaseSeconds:98,stage2Reached:true,invalidPositions:0,itemUses:{sprint:2,decoy:1,phase:0,lock:0},escapes:{sprint:1,decoy:0,phase:0,lock:0},survivalSeconds:{'01':80,'02':190}},
      {seed:2,mapId:'02',seconds:250,reason:'timeout',captures:5,stage1Survivors:6,stage1ChaseSeconds:100,stage2Reached:true,invalidPositions:0,itemUses:{sprint:0,decoy:0,phase:1,lock:0},escapes:{sprint:0,decoy:0,phase:1,lock:0},survivalSeconds:{'01':250,'02':100}},
    ];
    const result=summarizeDemonEpisodes(rows);
    expect(result.uniqueSurvivorRate).toBe(.5);
    expect(result.stage1FourOrLessRate).toBe(.5);
    expect(result.meanCaptures).toBe(6);
    expect(result.timeoutRate).toBe(.5);
    expect(result.runners.find(r=>r.id==='02')?.winRate).toBe(.5);
    expect(result.runners.find(r=>r.id==='01')?.winRate).toBe(0);
    expect(result.items.sprint).toEqual({uses:2,safeBeyondEightCellsAfterFiveSeconds:1,postUseEscapeRate:.5});
  });
});

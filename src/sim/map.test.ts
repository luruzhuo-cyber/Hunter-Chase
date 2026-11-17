import { describe,expect,it } from 'vitest';
import { generateFacility,validateFacility } from './map';
describe('facility generation',()=>{
  it('is exactly reproducible from a seed',()=>{ expect(generateFacility(1701)).toEqual(generateFacility(1701)); expect(generateFacility(1701)).not.toEqual(generateFacility(1702)); });
  it('always generates a completable facility with two exit routes',()=>{ for(let seed=1;seed<=100;seed++){const result=validateFacility(generateFacility(seed));expect(result.valid,`${seed}: ${result.errors}`).toBe(true);expect(result.exitRouteCount).toBeGreaterThanOrEqual(2);} });
  it('places three reachable terminals and valid vents',()=>{const map=generateFacility(42);expect(map.terminals).toHaveLength(3);expect(map.vents).toHaveLength(2);expect(map.runnerSpawns).toHaveLength(8);});
});

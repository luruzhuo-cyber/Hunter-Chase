import {describe,it,expect} from 'vitest';
import {PresentationClock} from './clock';
describe('presentation clock',()=>{it('freezes while paused and resumes without a wall-clock jump',()=>{const clock=new PresentationClock();clock.advance(0,true);expect(clock.advance(50,true)).toBe(.05);expect(clock.advance(500,false)).toBe(.05);expect(clock.advance(550,true)).toBe(.1);clock.reset();expect(clock.advance(1000,true)).toBe(0)})});

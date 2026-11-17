import { encodeHunterObservation } from './model-format';
import type { HunterObservation } from '../sim/survival/observation';
import type { Vec2 } from '../sim/survival/types';

export const PURSUIT_OBSERVATION_SIZE = 325;
export const PURSUIT_OBSERVATION_SCHEMA_VERSION = 2;
export type PursuitFeatures = {
  targetId?: string; lastPosition?: Vec2; nextWaypoint?: Vec2; pathDistance?: number;
  switchCount: number; locked: boolean; lastSeenTick: number; observedAt: number;
  visibleCount: number; status: 'patrol'|'pursuit'|'search';
};

/** V2 excludes legacy continuously refreshed actors. Target coordinates originate only in the 1 Hz sensor. */
export function encodePursuitObservation(base: HunterObservation, target: PursuitFeatures, dt=.1): number[] {
  const origin=base.self.position;
  const relative=(point:Vec2|undefined)=>point?[(point.x-origin.x)/40,(point.y-origin.y)/40]:[0,0];
  const known=target.targetId!==undefined&&target.lastPosition!==undefined;
  return [...encodeHunterObservation({...base,visibleRunners:[],lastSeen:[],clues:[]}),
    Number(known),...relative(known?target.lastPosition:undefined),
    known?Math.min(1,Math.max(0,(base.tick-target.lastSeenTick)*dt/5)):0,
    Number(target.nextWaypoint!==undefined),...relative(target.nextWaypoint),
    Number.isFinite(target.pathDistance)?Math.min(4,target.pathDistance!/100):0,
    target.switchCount/2,Number(target.locked),target.visibleCount/8,
    target.status==='pursuit'?1:target.status==='search'?.5:0];
}

/** Bounded potential is calculated from the sampled target's known route, never hidden runner truth. */
export function pursuitPotential(target:PursuitFeatures,terminal=false):number {
  return !terminal&&target.targetId&&Number.isFinite(target.pathDistance)? .5/(1+Math.max(0,target.pathDistance!)/10):0;
}

type SceneIdentity={seed:number;mapSeed:number;stage:number;tick:number};
/** Snapshot objects change every step; only identity changes or time reversal break continuity. */
export class PresentationContinuity {
 private previous?:SceneIdentity;
 update(next:SceneIdentity){const p=this.previous;this.previous={...next};return !p||next.seed!==p.seed||next.mapSeed!==p.mapSeed||next.stage!==p.stage||next.tick<p.tick}
}

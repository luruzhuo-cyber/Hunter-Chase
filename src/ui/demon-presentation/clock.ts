export class PresentationClock {
 private last?:number;
 seconds=0;
 advance(now:number,running:boolean){if(this.last!==undefined&&running)this.seconds+=Math.min(.1,Math.max(0,(now-this.last)/1000));this.last=now;return this.seconds}
 reset(){this.seconds=0;this.last=undefined}
}

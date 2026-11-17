export class Rng {
  private state:number;
  constructor(seed:number){ this.state=seed>>>0 || 0x9e3779b9; }
  next(){ let t=this.state+=0x6D2B79F5; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }
  int(min:number,max:number){ return Math.floor(this.next()*(max-min+1))+min; }
  pick<T>(items:T[]):T { return items[Math.floor(this.next()*items.length)]!; }
  shuffle<T>(items:T[]):T[]{ const a=[...items]; for(let i=a.length-1;i>0;i--){const j=this.int(0,i);[a[i],a[j]]=[a[j]!,a[i]!];} return a; }
}

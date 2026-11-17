import type {DemonEvent,DemonItem} from '../../sim/demon/types';
export type Layer={wave?:OscillatorType;from:number;to:number;delay:number;duration:number;level:number;noise?:boolean;filter?:BiquadFilterType};
const tone=(from:number,to:number,duration:number,level=.15,delay=0,wave:OscillatorType='sine'):Layer=>({from,to,duration,level,delay,wave});
const air=(from:number,to:number,duration:number,level=.12,delay=0,filter:BiquadFilterType='bandpass'):Layer=>({from,to,duration,level,delay,noise:true,filter});
/** Original oscillator/noise gestures, with no recordings or external assets. */
export function recipe(type:DemonEvent['type'],item?:DemonItem):Layer[]{
 switch(type){
 case 'summon':return [tone(74,31,.95,.22,0,'triangle'),air(340,65,.8,.17),tone(1171,172,.24,.09,.05,'square'),tone(723,119,.4,.07,.06)];
 case 'capture':return [tone(105,27,.45,.25),air(1900,90,.35,.15),tone(390,40,.35,.07,0,'sawtooth')];
 case 'transition':return [air(1700,160,.65,.16),tone(122,49,.6,.18,0,'triangle'),tone(610,92,.18,.09,.38,'square')];
 case 'pickup':return [tone(820,1040,.14,.09),tone(1420,1280,.22,.06,.08)];
 case 'item-use':switch(item){
 case 'sprint':return [air(450,3600,.45,.17),tone(160,480,.32,.06,0,'triangle')];
 case 'decoy':return [tone(680,740,.1,.1,0,'square'),tone(680,620,.1,.08,.17,'square'),tone(940,760,.16,.07,.34,'triangle')];
 case 'phase':return [tone(180,1600,.24,.09),tone(1300,240,.35,.07,.05),air(2100,400,.3,.06)];
 case 'lock':return [air(3400,1700,.06,.17),tone(410,85,.18,.13,.035,'square')];
 default:return [tone(640,800,.18,.09)];}
 case 'finished':return [tone(196,196,.8,.09),tone(294,392,.85,.07,.12),tone(588,784,.7,.045,.25)];
 case 'last-two':return [tone(65,38,.15,.18),tone(55,32,.18,.14,.24)];
 case 'closure-warning':return [tone(280,260,.18,.08,0,'triangle'),tone(280,260,.18,.07,.26,'triangle')];
 case 'closure':return [air(1800,300,.13,.12),tone(160,70,.22,.12)];
 default:return [air(3200,1200,.045,.09),tone(520,360,.14,.07,.04,'triangle')];
 }
}

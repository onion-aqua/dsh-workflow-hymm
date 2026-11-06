import type { WorkflowPreferences } from '../shared/model.ts';
export type WorkflowSound='completed'|'failed'|'question'|'approval';
/** Local synthesized tones; no remote media, native notification claims, or
 * permission prompts. The first user gesture unlocks browser audio normally. */
export class WorkflowSounds{
  private context?:AudioContext;
  private enabled=false;
  private last=0;
  unlock=()=>{try{this.context??=new AudioContext();void this.context.resume().then(()=>{this.enabled=this.context?.state==='running';}).catch(()=>{});}catch{}};
  play=(kind:WorkflowSound,preferences?:WorkflowPreferences,force=false)=>{
    const sounds=preferences?.sounds;
    if(!force&&(!sounds?.enabled||!sounds[kind]))return;
    if(!this.enabled||!this.context)return;
    const now=Date.now();if(!force&&now-this.last<450)return;this.last=now;
    const base=this.context.currentTime;
    const notes=kind==='completed'?[660,880]:kind==='failed'?[330,247]:kind==='approval'?[554,440]:[523,659];
    for(const [index,frequency] of notes.entries()){
      const oscillator=this.context.createOscillator(),gain=this.context.createGain();oscillator.type='sine';oscillator.frequency.value=frequency;
      gain.gain.setValueAtTime(0,base+index*.14);gain.gain.linearRampToValueAtTime(.075,base+index*.14+.015);gain.gain.exponentialRampToValueAtTime(.001,base+index*.14+.13);
      oscillator.connect(gain);gain.connect(this.context.destination);oscillator.start(base+index*.14);oscillator.stop(base+index*.14+.15);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
    }
  };
  dispose=()=>{void this.context?.close().catch(()=>{});this.context=undefined;this.enabled=false;};
}

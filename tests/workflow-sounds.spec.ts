import {afterEach,describe,expect,it,vi} from 'vitest';
import {WorkflowSounds} from '../src/client/workflow-sounds.ts';
const played:number[]=[],closed:unknown[]=[];
class LocalAudio{
  currentTime=0;state='suspended';destination={};
  async resume(){this.state='running';}
  async close(){closed.push(this);}
  createOscillator(){return {type:'sine',frequency:{value:0},connect(){},disconnect(){},start(){played.push(1);},stop(){},onended:()=>{}};}
  createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
}
afterEach(()=>{vi.unstubAllGlobals();played.length=0;closed.length=0;});
describe('local workflow audio preferences',()=>{
  it('plays no audio before a user gesture or with disabled preferences and never fetches media',async()=>{
    vi.stubGlobal('AudioContext',LocalAudio);const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const audio=new WorkflowSounds(),preferences={sounds:{enabled:true,completed:true,failed:false,question:true,approval:true}};
    audio.play('question',preferences);expect(played).toEqual([]);audio.unlock();await Promise.resolve();
    audio.play('failed',preferences);audio.play('completed',{sounds:{...preferences.sounds,enabled:false}});expect(played).toEqual([]);
    audio.play('question',preferences);expect(played).toHaveLength(2);audio.play('approval',preferences);expect(played).toHaveLength(2);expect(fetch).not.toHaveBeenCalled();audio.dispose();expect(closed).toHaveLength(1);
  });
  it('handles unavailable browser audio without preventing workflow operations',()=>{
    vi.stubGlobal('AudioContext',class{constructor(){throw new Error('Audio is unavailable');}});const audio=new WorkflowSounds();expect(()=>{audio.unlock();audio.play('completed',undefined,true);audio.dispose();}).not.toThrow();
  });
});

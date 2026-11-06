import {Context} from '@deepseek-ai/cordis';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import type {SkillCandidate,SkillLookupOptions,SkillViewOptions} from '@deepseek-ai/dsh-skill';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {NativeSkillCatalog} from '../src/host/native-skills.ts';

const contexts:Context[]=[];
afterEach(async()=>{for(const ctx of contexts.splice(0).reverse())await ctx.fiber.dispose();});
async function open(){const ctx=new Context();contexts.push(ctx);await ctx.plugin(SkillRegistry);const resolveAgent=vi.fn(()=>{throw new Error('Discovery must not restore an Agent');}),ensure=vi.fn(()=>{throw new Error('Discovery must not repair a directory');});ctx.provide('sessionController',{resolveAgent});ctx.provide('workingDirectory',{ensure,defaultDirectory:'D:\\unrelated-default'});return{ctx,catalog:new NativeSkillCatalog(ctx),resolveAgent,ensure};}
const entry=(name:string,userInvocable=true):SkillCandidate=>({name,description:`Native ${name}`,invocation:{modelInvocable:false,userInvocable},source:'project-dsh',provider:'fixture-provider',rank:1,locator:{name}});

describe('read-only native skill catalog',()=>{
  it('uses real registry precedence and human invocation policy, without loading skill bodies',async()=>{
    const {ctx,catalog}=await open(),get=vi.fn();ctx.skills.registerProvider(()=>({name:'fixture-provider',list:async()=>[entry('available'),entry('model-only',false)],get}));
    expect(await catalog.list({cwd:'D:\\selected-workspace'})).toEqual([{name:'available',description:'Native available',source:'project-dsh'}]);expect(get).not.toHaveBeenCalled();
  });
  it('uses an explicit workspace cwd and never substitutes the process or deployment directory when none was selected',async()=>{
    const {ctx,catalog,ensure,resolveAgent}=await open(),calls:SkillLookupOptions[]=[];ctx.skills.registerProvider(()=>({name:'fixture-provider',list:async options=>{calls.push(options);return[entry(options.cwd?'project-skill':'global-skill')];},get:async()=>undefined}));
    expect((await catalog.list({cwd:'D:\\selected-workspace'}))[0]?.name).toBe('project-skill');expect((await catalog.list())[0]?.name).toBe('global-skill');expect(calls.map(item=>item.cwd)).toEqual(['D:\\selected-workspace',undefined]);expect(ensure).not.toHaveBeenCalled();expect(resolveAgent).not.toHaveBeenCalled();
  });
  it('reads the exact source observation and projected cwd without activation, directory repair, skill loading or any original-session mutation',async()=>{
    const {ctx,catalog,ensure,resolveAgent}=await open(),dispose=vi.fn(),events=[{type:'user/message',data:{content:'Original source'}}],original=structuredClone(events),observeSession=vi.fn(async()=>({header:{cwd:'D:\\original'},projections:{values:{workingDirectory:'D:\\recorded-current',agentPreset:undefined}},[Symbol.dispose]:dispose})),get=vi.fn();ctx.provide('sessionQuery',{observeSession});ctx.provide('agents',{get:()=>undefined});const list=vi.spyOn(ctx.skills,'list');ctx.skills.registerProvider(()=>({name:'fixture-provider',list:async()=>[entry('source-available')],get}));
    expect((await catalog.list({sessionId:'original-source',cwd:'D:\\caller-cannot-override'}))[0]?.name).toBe('source-available');expect(observeSession).toHaveBeenCalledWith('original-source',undefined);expect(list).toHaveBeenCalledWith({cwd:'D:\\recorded-current'});expect(dispose).toHaveBeenCalledOnce();expect(events).toEqual(original);expect(get).not.toHaveBeenCalled();expect(ensure).not.toHaveBeenCalled();expect(resolveAgent).not.toHaveBeenCalled();
  });
  it('keeps a cold Session cold and releases its standing preset scope after both successful and failed reads',async()=>{
    const {ctx,catalog,ensure,resolveAgent}=await open(),scope={},release=vi.fn(async()=>{}),acquireScope=vi.fn(async()=>({key:scope,[Symbol.asyncDispose]:release}));ctx.provide('sessionQuery',{observeSession:async()=>({header:{cwd:'D:\\cold'},projections:{values:{agentPreset:'native-preset'}},[Symbol.dispose]:()=>{}})});ctx.provide('agents',{get:()=>undefined});ctx.provide('agentPresets',{acquireScope});const list=vi.spyOn(ctx.skills,'list').mockResolvedValue([entry('preset-skill')]);
    expect((await catalog.list({sessionId:'cold-source'}))[0]?.name).toBe('preset-skill');expect(acquireScope).toHaveBeenCalledExactlyOnceWith('native-preset');expect(list).toHaveBeenCalledWith({cwd:'D:\\cold',scope});expect(release).toHaveBeenCalledOnce();list.mockRejectedValueOnce(new Error('Provider unavailable'));await expect(catalog.list({sessionId:'cold-source'})).rejects.toThrow('Provider unavailable');expect(release).toHaveBeenCalledTimes(2);expect(ensure).not.toHaveBeenCalled();expect(resolveAgent).not.toHaveBeenCalled();
  });
  it('uses the actual live preset registry and scope without falling back to unrelated global skills',async()=>{
    const {ctx,catalog,ensure}=await open(),live={id:'live-source',ctx:{}},list=vi.fn(async()=>[entry('scoped-skill')]),serviceFor=vi.fn(()=>({list})),acquireScope=vi.fn();ctx.provide('sessionQuery',{observeSession:async()=>({header:{cwd:'D:\\live'},projections:{values:{}},[Symbol.dispose]:()=>{}})});ctx.provide('agents',{get:()=>live});ctx.provide('agentPresets',{serviceFor,acquireScope});
    expect((await catalog.list({sessionId:'live-source'}))[0]?.name).toBe('scoped-skill');expect(serviceFor).toHaveBeenCalledWith(live,'skills');expect(list).toHaveBeenCalledWith({cwd:'D:\\live',scope:live});expect(acquireScope).not.toHaveBeenCalled();expect(ensure).not.toHaveBeenCalled();
  });
  it('observes native registration changes on the next request instead of caching a stale menu',async()=>{
    const {ctx,catalog}=await open();const remove=ctx.skills.register({name:'temporary',description:'Real runtime contribution',source:'runtime',content:'Native skill body'});expect((await catalog.list()).map(item=>item.name)).toContain('temporary');remove();expect((await catalog.list()).map(item=>item.name)).not.toContain('temporary');
  });
  it('rejects caller cancellation and missing native capability without inventing entries',async()=>{
    const {catalog}=await open(),controller=new AbortController();controller.abort(new Error('Catalog cancelled'));await expect(catalog.list({signal:controller.signal})).rejects.toThrow('Catalog cancelled');const absent=new Context();contexts.push(absent);await expect(new NativeSkillCatalog(absent).list()).rejects.toThrow('native skill registry is unavailable');
  });
});

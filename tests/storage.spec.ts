import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import * as StorageJson from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import { afterEach, describe, expect, it } from 'vitest';
import VisualWorkflowService from '../src/host/service.ts';
import type { Workflow, WorkflowSaveValue } from '../src/shared/model.ts';
import { layoutWorkflow } from '../src/shared/model.ts';

const roots: string[] = [];
const contexts: Context[] = [];
async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-visual-workflow-test-'));
  roots.push(root);
  return root;
}

async function open(root: string) {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(Storage);
  await ctx.plugin(StorageJson, { root });
  await ctx.plugin(StorageDomain, { backend: 'json' });
  const fiber = ctx.plugin(VisualWorkflowService);
  await fiber;
  const service = ctx.get('visualWorkflow');
  if (!service) throw new Error('Workflow service did not activate');
  return { ctx, service, fiber };
}

function edited(workflow: Workflow): Workflow {
  return {
    ...workflow,
    name: 'Persistent plan',
    nodes: [
      { id: 'task-one', title: 'Research', instruction: 'Read the current repository.', source: 'user', status: 'draft', revision: 1, position: { x: 78.25, y: 110 } },
      { id: 'task-two', title: 'Review', instruction: 'Review evidence.', source: 'user', status: 'draft', revision: 1, position: { x: 510, y: 240 } },
    ],
    edges: [{ id: 'dependency-one', source: 'task-one', target: 'task-two', type: 'dependency' }],
    viewport: { x: -86, y: 44, zoom: 0.85 },
  };
}

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('native Storage Domain workflow persistence', () => {
  it('persists visual groups across restart and preserves them for older clients while trimming deleted drafts',async()=>{
    const root=await freshRoot();const first=await open(root);const {workflow}=await first.service.create({name:'Grouped research'});
    const created=await first.service.save({workflow:{...edited(workflow),groups:[{id:'group-research',title:'  Research group  ',nodeIds:['task-one','task-two']}]},expectedRevision:workflow.revision});if(!created.ok)throw new Error('save');
    expect(created.workflow.groups).toEqual([{id:'group-research',title:'Research group',nodeIds:['task-one','task-two']}]);expect(created.workflow.nodes.every(node=>node.revision===1)).toBe(true);
    await first.ctx.fiber.dispose();const second=await open(root);expect((await second.service.get({id:workflow.id})).workflow).toEqual(created.workflow);
    const legacyClient={...created.workflow};delete legacyClient.groups;
    const legacyRename=await second.service.save({workflow:{...legacyClient,name:'Older client title'},expectedRevision:created.workflow.revision});if(!legacyRename.ok)throw new Error('save');expect(legacyRename.workflow.groups).toEqual(created.workflow.groups);
    const legacyDelete={...legacyRename.workflow,nodes:legacyRename.workflow.nodes.filter(node=>node.id!=='task-two'),edges:[]};delete legacyDelete.groups;
    const trimmed=await second.service.save({workflow:legacyDelete,expectedRevision:legacyRename.workflow.revision});if(!trimmed.ok)throw new Error('save');expect(trimmed.workflow.groups).toEqual([{id:'group-research',title:'Research group',nodeIds:['task-one']}]);
    const ungrouped=await second.service.save({workflow:{...trimmed.workflow,groups:[]},expectedRevision:trimmed.workflow.revision});if(!ungrouped.ok)throw new Error('save');expect(ungrouped.workflow.groups).toEqual([]);expect(ungrouped.workflow.nodes).toEqual(trimmed.workflow.nodes);
    const noGroups={...ungrouped.workflow};delete noGroups.groups;
    const empty=await second.service.save({workflow:{...noGroups,nodes:[],edges:[]},expectedRevision:ungrouped.workflow.revision});if(!empty.ok)throw new Error('save');expect(empty.workflow.groups).toEqual([]);
  });
  it('rejects invalid or nested visual group membership before changing durable state',async()=>{
    const root=await freshRoot();const {service}=await open(root);const {workflow}=await service.create({name:'Invalid groups'});const graph=edited(workflow);const before=await readFile(join(root,'visual_workflow.json'),'utf8');
    const groups=[
      [{id:'group-a',title:' ',nodeIds:['task-one']}],
      [{id:'group-a',title:'Empty',nodeIds:[]}],
      [{id:'group-a',title:'Missing',nodeIds:['missing-node']}],
      [{id:'group-a',title:'Duplicate member',nodeIds:['task-one','task-one']}],
      [{id:'group-a',title:'First',nodeIds:['task-one']},{id:'group-b',title:'Second',nodeIds:['task-one']}],
      [{id:'group-a',title:'First',nodeIds:['task-one']},{id:'group-a',title:'Second',nodeIds:['task-two']}],
      [{id:'group-a',title:'First',nodeIds:['task-one']},{id:'group-b',title:'Nested',nodeIds:['group-a']}],
      [{id:'task-one',title:'Identity collision',nodeIds:['task-two']}],
      [{id:'group-a',title:'x'.repeat(129),nodeIds:['task-one']}],
    ];
    for(const invalid of groups)await expect(service.save({workflow:{...graph,groups:invalid},expectedRevision:workflow.revision})).rejects.toMatchObject({code:'gateway/bad-request'});
    expect(await readFile(join(root,'visual_workflow.json'),'utf8')).toBe(before);expect((await service.get({id:workflow.id})).workflow).toEqual(workflow);
  });
  it('persists catalog groups using opaque native Session IDs without resuming or reading Sessions',async()=>{
    const root=await freshRoot();const first=await open(root);const nativeId='native/session:含空格 context';
    const layout={revision:0,positions:{[nativeId]:{x:100,y:120}},viewport:{x:0,y:0,zoom:1},groups:[{id:'catalog-context',title:'Native context',nodeIds:[nativeId,'other-native-id']}]};
    const saved=await first.service.saveCatalogLayout({layout,expectedRevision:0});expect(saved.ok).toBe(true);expect(saved.layout.groups).toEqual(layout.groups);
    await first.ctx.fiber.dispose();const second=await open(root);
    const oldClient={...saved.layout};delete oldClient.groups;
    const retained=await second.service.saveCatalogLayout({layout:{...oldClient,viewport:{x:40,y:50,zoom:.9}},expectedRevision:1});expect(retained.ok).toBe(true);expect(retained.layout.groups).toEqual(layout.groups);
    const stale=await second.service.saveCatalogLayout({layout:{...oldClient,groups:[]},expectedRevision:1});expect(stale).toEqual({ok:false,layout:retained.layout});
    const cleared=await second.service.saveCatalogLayout({layout:{...retained.layout,groups:[]},expectedRevision:2});expect(cleared.ok).toBe(true);expect(cleared.layout.groups).toEqual([]);
    const stored=JSON.parse(await readFile(join(root,'visual_workflow.json'),'utf8'));expect(stored.tables.catalog_layout.root.groups).toEqual([]);
  });
  it('rejects duplicate, nested, empty and malformed catalog groups without needing a native runtime',async()=>{
    const root=await freshRoot();const {service}=await open(root);
    const invalid=[
      [{id:'group-a',title:'Empty',nodeIds:[]}],
      [{id:'group-a',title:'Duplicate',nodeIds:['native:one','native:one']}],
      [{id:'group-a',title:'First',nodeIds:['native:one']},{id:'group-b',title:'Second',nodeIds:['native:one']}],
      [{id:'group-a',title:'First',nodeIds:['native:one']},{id:'group-a',title:'Second',nodeIds:['native:two']}],
      [{id:'group-a',title:'First',nodeIds:['native:one']},{id:'group-b',title:'Nested',nodeIds:['group-a']}],
      [{id:'group-a',title:'Bad reference',nodeIds:['x'.repeat(513)]}],
    ];
    for(const groups of invalid)await expect(service.saveCatalogLayout({layout:{revision:0,positions:{},viewport:{x:0,y:0,zoom:1},groups},expectedRevision:0})).rejects.toMatchObject({code:'gateway/bad-request'});
  });
  it('restores task edits, connections, coordinates and viewport after service restart', async () => {
    const root = await freshRoot();
    const first = await open(root);
    const { workflow } = await first.service.create({ name: 'New plan' });
    const result = await first.service.save({ workflow: edited(workflow), expectedRevision: workflow.revision });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected the first save to commit');
    expect(result.workflow.revision).toBe(2);
    await first.ctx.fiber.dispose();

    const second = await open(root);
    expect((await second.service.get({ id: workflow.id })).workflow).toEqual(result.workflow);
    expect((await second.service.list()).workflows).toEqual([result.workflow]);
    const text = await readFile(join(root, 'visual_workflow.json'), 'utf8');
    expect(JSON.parse(text).tables.workflows[workflow.id]).toEqual(result.workflow);
    expect(text).not.toContain('sessionId');
    expect(text).not.toContain('focusedNodeId');
  });

  it('rejects stale concurrent saves rather than losing the first writer', async () => {
    const { service } = await open(await freshRoot());
    const { workflow } = await service.create({ name: 'Before' });
    const results = await Promise.all([
      service.save({ workflow: { ...workflow, name: 'First editor' }, expectedRevision: 1 }),
      service.save({ workflow: { ...workflow, name: 'Second editor' }, expectedRevision: 1 }),
    ]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    const conflict = results.find(result => !result.ok);
    expect(conflict).toMatchObject({ ok: false, code: 'conflict', workflow: { revision: 2, name: 'First editor' } });
    expect((await service.get({ id: workflow.id })).workflow?.name).toBe('First editor');
  });

  it('persists new and reordered task layers and sizes across content edits and service restart', async () => {
    const root = await freshRoot(); const first = await open(root);
    const { workflow } = await first.service.create({ name: 'Layered tasks' });
    const initial = edited(workflow);
    initial.nodes = initial.nodes.map((node, index) => ({ ...node, zIndex: index * 5 + 2, width: 400+index*100, height: 240+index*100 }));
    const created = await first.service.save({ workflow: initial, expectedRevision: workflow.revision });
    if (!created.ok) throw new Error('Expected layered tasks to commit');
    expect(created.workflow.nodes.map(node => node.zIndex)).toEqual([2, 7]);
    expect(created.workflow.nodes.map(node=>[node.width,node.height])).toEqual([[400,240],[500,340]]);
    const reordered = await first.service.save({ workflow: { ...created.workflow,
      nodes: created.workflow.nodes.map(node => ({ ...node, zIndex: node.id === 'task-one' ? 11 : 3, width: 660, height: 420 })) }, expectedRevision: created.workflow.revision });
    if (!reordered.ok) throw new Error('Expected layer changes to commit');
    expect(reordered.workflow.nodes.map(node => node.revision)).toEqual([1, 1]);
    const changed = await first.service.save({ workflow: { ...reordered.workflow,
      nodes: reordered.workflow.nodes.map(node => node.id === 'task-one' ? { ...node, title: 'Revised research', zIndex: 15, width: 780, height: 480 } : node) }, expectedRevision: reordered.workflow.revision });
    if (!changed.ok) throw new Error('Expected content and layer change to commit');
    expect(changed.workflow.nodes.map(node => [node.revision, node.zIndex])).toEqual([[2, 15], [1, 3]]);
    expect(changed.workflow.nodes.map(node=>[node.width,node.height])).toEqual([[780,480],[660,420]]);
    const arranged=layoutWorkflow(changed.workflow);
    expect(arranged.nodes[1]!.position.x).toBeGreaterThan(arranged.nodes[0]!.position.x+arranged.nodes[0]!.width!);
    await first.ctx.fiber.dispose(); const second = await open(root);
    expect((await second.service.get({ id: workflow.id })).workflow).toEqual(changed.workflow);
  });

  it('rejects malicious task and catalog layer data before writing durable state', async () => {
    const root = await freshRoot(); const { service } = await open(root);
    const { workflow } = await service.create({ name: 'Valid layers' });
    const before = await readFile(join(root, 'visual_workflow.json'), 'utf8');
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5, Number.MAX_SAFE_INTEGER, 'front']) {
      const malformed = { ...edited(workflow), nodes: edited(workflow).nodes.map(node => ({ ...node, zIndex: invalid })) };
      await expect(Reflect.apply(service.save, service, [{ workflow: malformed, expectedRevision: workflow.revision }])).rejects.toMatchObject({ code: 'gateway/bad-request' });
      await expect(Reflect.apply(service.saveCatalogLayout, service, [{ layout: { revision: 0, positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, zIndices: { source: invalid } }, expectedRevision: 0 }])).rejects.toMatchObject({ code: 'gateway/bad-request' });
    }
    expect((await service.get({ id: workflow.id })).workflow).toEqual(workflow);
    expect(await readFile(join(root, 'visual_workflow.json'), 'utf8')).toBe(before);
  });

  it('reads legacy catalog layouts without zIndices and durably saves layers with CAS', async () => {
    const root = await freshRoot(); const first = await open(root);
    const legacy = { revision: 0, positions: { old: { x: 40, y: 60 } }, viewport: { x: -40, y: 25, zoom: 0.8 } };
    const firstSave = await first.service.saveCatalogLayout({ layout: legacy, expectedRevision: 0 });
    expect(firstSave).toMatchObject({ ok: true, layout: { revision: 1, positions: legacy.positions } });
    await first.ctx.fiber.dispose(); const second = await open(root);
    // Catalog requires a native directory, but this assertion only needs the
    // layout result. Supply an empty read-only directory fixture.
    Reflect.set(second.service, 'native', { catalog: async () => [] });
    expect((await second.service.catalog()).layout).toEqual(firstSave.layout);
    const layers = { ...firstSave.layout, zIndices: { old: 2, other: 8 }, sizes:{old:{width:640,height:360}} };
    const layered = await second.service.saveCatalogLayout({ layout: layers, expectedRevision: 1 });
    expect(layered).toMatchObject({ ok: true, layout: { revision: 2, zIndices: layers.zIndices } });
    expect(layered.layout.sizes).toEqual(layers.sizes);
    expect(await second.service.saveCatalogLayout({ layout: { ...layers, zIndices: { old: 99 } }, expectedRevision: 1 })).toEqual({ ok: false, layout: layered.layout });
    await second.ctx.fiber.dispose(); const third = await open(root);
    Reflect.set(third.service, 'native', { catalog: async () => [] });
    expect((await third.service.catalog()).layout).toEqual(layered.layout);
  });
  it('rejects invalid resize dimensions without changing graph or catalog persistence',async()=>{
    const root=await freshRoot();const {service}=await open(root);const {workflow}=await service.create({name:'Valid dimensions'});const before=await readFile(join(root,'visual_workflow.json'),'utf8');
    for(const size of [{width:Number.NaN,height:300},{width:400,height:Infinity},{width:219,height:300},{width:400,height:139},{width:1601,height:300},{width:400,height:1201}]){
      await expect(service.save({workflow:{...edited(workflow),nodes:edited(workflow).nodes.map(node=>({...node,...size}))},expectedRevision:workflow.revision})).rejects.toMatchObject({code:'gateway/bad-request'});
      await expect(service.saveCatalogLayout({layout:{revision:0,positions:{},viewport:{x:0,y:0,zoom:1},sizes:{source:size}},expectedRevision:0})).rejects.toMatchObject({code:'gateway/bad-request'});
    }
    expect(await readFile(join(root,'visual_workflow.json'),'utf8')).toBe(before);
  });

  it('does not overwrite authoritative memory when the backend cannot publish', async () => {
    const root = await freshRoot();
    const { service } = await open(root);
    const { workflow } = await service.create({ name: 'Committed' });
    const file = join(root, 'visual_workflow.json');
    await rename(file, join(root, 'saved.json'));
    await mkdir(file);
    await expect(service.save({ workflow: { ...workflow, name: 'Not saved' }, expectedRevision: 1 })).rejects.toThrow();
    expect((await service.get({ id: workflow.id })).workflow).toEqual(workflow);
    expect(JSON.parse(await readFile(join(root, 'saved.json'), 'utf8')).tables.workflows[workflow.id]).toEqual(workflow);
  });

  it('does not hide an active workflow if its archive tombstone cannot be durably published',async()=>{
    const root=await freshRoot();const {service}=await open(root);const {workflow}=await service.create({name:'Archive must commit'});
    const file=join(root,'visual_workflow.json');await rename(file,join(root,'before-archive.json'));await mkdir(file);
    await expect(service.delete({workflowId:workflow.id,expectedRevision:workflow.revision})).rejects.toThrow();
    expect((await service.get({id:workflow.id})).workflow).toEqual(workflow);expect((await service.list()).workflows).toEqual([workflow]);
    const durable=JSON.parse(await readFile(join(root,'before-archive.json'),'utf8')).tables.workflows[workflow.id];expect(durable).toEqual(workflow);expect(durable.archivedAt).toBeUndefined();
  });

  it('rejects damaged storage at activation without creating an empty replacement', async () => {
    const root = await freshRoot();
    const text = '{ definitely not a workflow document';
    await writeFile(join(root, 'visual_workflow.json'), text);
    await expect(open(root)).rejects.toThrow();
    expect(await readFile(join(root, 'visual_workflow.json'), 'utf8')).toBe(text);
  });

  it('rejects invalid remote data before changing the saved graph', async () => {
    const { service } = await open(await freshRoot());
    const { workflow } = await service.create({ name: 'Unchanged' });
    const malformed = { workflow: { ...edited(workflow), edges: [{ id: 'bad', source: 'task-one', target: 'missing', type: 'dependency' }] }, expectedRevision: 1 };
    const invoked: Promise<WorkflowSaveValue> = Reflect.apply(service.save, service, [malformed]);
    await expect(invoked).rejects.toMatchObject({ code: 'gateway/bad-request' });
    expect((await service.get({ id: workflow.id })).workflow).toEqual(workflow);
  });

  it('returns definite absence and protects stored snapshots from callers', async () => {
    const { service } = await open(await freshRoot());
    const { workflow } = await service.create({ name: 'Original' });
    workflow.name = 'Local caller mutation';
    expect((await service.get({ id: workflow.id })).workflow?.name).toBe('Original');
    expect(await service.get({ id: 'workflow-missing' })).toEqual({ workflow: null });
    expect(await service.save({ workflow: { ...workflow, id: 'workflow-missing' }, expectedRevision: 1 })).toEqual({ ok: false, code: 'not-found', workflow: null });
  });

  it('unloads the service and releases its domain for a fresh plugin fiber', async () => {
    const { ctx, service, fiber } = await open(await freshRoot());
    const { workflow } = await service.create({ name: 'Retained' });
    await fiber.dispose();
    expect(ctx.get('visualWorkflow')).toBeUndefined();
    await ctx.plugin(VisualWorkflowService);
    expect((await ctx.visualWorkflow.get({ id: workflow.id })).workflow?.name).toBe('Retained');
  });
});

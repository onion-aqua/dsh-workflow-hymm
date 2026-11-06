import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boot } from '@deepseek-ai/dsh-app-boot';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '../src/host/service.ts';
import { afterEach, expect, it } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(projectRoot, '.test-work');
const roots: string[] = [];
const contexts: Context[] = [];

afterEach(async () => {
  for (const context of contexts.splice(0).reverse()) await context.fiber.dispose();
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(fixtureRoot) + sep)) throw new Error('Refusing to remove a path outside owned test fixtures');
    await rm(root, { recursive: true, force: true });
  }
});

it('loads the built plugin through the real rc.3 Loader and restores durable graphs after restart', async () => {
  const pluginEntry = join(projectRoot, 'lib', 'index.js');
  await access(pluginEntry); // This is an artifact integration test: run the plugin build first.
  await mkdir(fixtureRoot, { recursive: true });
  const root = await mkdtemp(join(fixtureRoot, 'loader-'));
  roots.push(root);
  const storageRoot = join(root, 'storage');
  const config = join(root, 'cordis.json');
  await writeFile(config, JSON.stringify([
    { id: 'storage', name: import.meta.resolve('@deepseek-ai/dsh-storage') },
    { id: 'storage-json', name: import.meta.resolve('@deepseek-ai/dsh-storage-json'), config: { root: storageRoot } },
    { id: 'storage-domain', name: import.meta.resolve('@deepseek-ai/dsh-storage-domain'), config: { backend: 'json' } },
    { id: 'workflow-under-test', name: pathToFileURL(pluginEntry).href },
  ], null, 2));

  const open = async () => {
    const context = await boot('visual-workflow-loader-test', config);
    contexts.push(context);
    const service = context.get('visualWorkflow');
    if (!service) throw new Error('The real Loader did not activate the built Workflow plugin');
    return { context, service };
  };

  const first = await open();
  const created = await first.service.create({ name: 'Loader-backed workflow' });
  const workflow = created.workflow;
  const result = await first.service.save({
    expectedRevision: workflow.revision,
    workflow: {
      ...workflow,
      nodes: [
        { id: 'task-research', title: 'Read APIs', instruction: 'Read current public declarations.', source: 'user', status: 'draft', revision: 1, position: { x: 70, y: 140 } },
        { id: 'task-review', title: 'Review', instruction: 'Check the evidence.', source: 'user', status: 'draft', revision: 1, position: { x: 520, y: 230 } },
      ],
      edges: [{ id: 'dependency-review', source: 'task-research', target: 'task-review', type: 'dependency' }],
      viewport: { x: -40, y: 60, zoom: 0.8 },
    },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected initial artifact save to commit');

  const entry = [...first.context.loader.entries()].find(candidate => candidate.options.id === 'workflow-under-test');
  expect(entry?.fiber).toBeDefined();
  await entry!.update({ disabled: true });
  await first.context.loader.await();
  expect(first.context.get('visualWorkflow')).toBeUndefined();
  await entry!.update({ disabled: false });
  await first.context.loader.await();
  expect((await first.context.visualWorkflow.get({ id: workflow.id })).workflow).toEqual(result.workflow);
  await first.context.fiber.dispose();

  const second = await open();
  expect((await second.service.get({ id: workflow.id })).workflow).toEqual(result.workflow);
  const persisted = JSON.parse(await readFile(join(storageRoot, 'visual_workflow.json'), 'utf8'));
  expect(persisted.tables.workflows[workflow.id]).toEqual(result.workflow);
  expect(Object.keys(persisted.tables.workflows[workflow.id])).not.toContain('focusedNodeId');
  expect(Object.keys(persisted.tables.workflows[workflow.id])).not.toContain('sessionId');
});

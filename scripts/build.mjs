import { build } from 'esbuild'
import ts from 'typescript'
import { WorkspaceTypertGenerator, writePackageArtifacts } from '@deepseek-ai/dsh-typert-generator'
import { mkdir, readFile, writeFile, cp, readdir, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lib = join(project, 'lib')
await mkdir(lib, { recursive: true })
// The published analyzer accepts projects below workspace packages/. This
// build-only copy contains our own sources, never the Harness source tree.
const scratch = join(project, 'artifacts', 'typert-workspace')
const packageDir = join(scratch, 'packages', 'workflow')
await mkdir(join(packageDir, 'src'), { recursive: true })
for (const name of ['host', 'shared']) await cp(join(project, 'src', name), join(packageDir, 'src', name), { recursive: true })
const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
await writeFile(join(packageDir, 'package.json'), JSON.stringify(manifest, null, 2))
const hostConfig = {
  compilerOptions: {
    target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
    skipLibCheck: true, allowImportingTsExtensions: true, noEmit: true,
    types: ['node'], lib: ['ES2023', 'DOM', 'ESNext.Disposable'],
  }, include: ['src/host/**/*.ts', 'src/shared/**/*.ts'],
}
// rc.3's analyzer recognizes Remote decorators by a registered protocol
// declaration. Give its workspace inventory an unchanged declaration-only
// copy from the exact installed npm dependency; this is never runtime code.
const protocolDir = join(scratch, 'packages', 'protocol')
await mkdir(join(protocolDir, 'src'), { recursive: true })
const protocolTypes = join(project, 'node_modules/@deepseek-ai/dsh-typert-protocol/lib/types')
for (const file of await readdir(protocolTypes)) {
  if (file.endsWith('.d.ts')) await cp(join(protocolTypes, file), join(protocolDir, 'src', file.replace('.d.ts', '.ts')))
}
await writeFile(join(protocolDir, 'package.json'), JSON.stringify({
  name: '@deepseek-ai/dsh-typert-protocol', version: '0.2.1-rc.3', type: 'module', exports: { '.': './src/index.ts' },
}))
await writeFile(join(protocolDir, 'tsconfig.json'), JSON.stringify(hostConfig, null, 2).replaceAll('src/host/**/*.ts', 'src/**/*.ts'))
const paths = { '@deepseek-ai/dsh-typert-protocol': ['./packages/protocol/src/index.ts'] }
// Session/Workspace add native resource brands to the protocol's open map.
// Register their unchanged declarations in the same Host face as well.
const nativeReferences = []
for (const name of ['session', 'workspace', 'agent', 'agent-preset-registry', 'api-session-controller',
  'compaction', 'commands', 'compaction-image-offload', 'session-title', 'sandbox-policy',
  'tools', 'user-approval', 'working-directory', 'tool-todo', 'subagent', 'session-projection', 'llm', 'api-gateway', 'skill', 'agent-preset-registry']) {
  const nativeDir = join(scratch, 'packages', name)
  const typesDir = join(project, `node_modules/@deepseek-ai/dsh-${name}/lib/types`)
  if (!relative(join(scratch, 'packages'), nativeDir).startsWith('..')) await rm(nativeDir, { recursive: true, force: true })
  else throw new Error('Invalid declaration scratch path')
  await mkdir(join(nativeDir, 'src'), { recursive: true })
  for (const file of await readdir(typesDir, { recursive: true })) {
    if (!file.endsWith('.d.ts')) continue
    const target = join(nativeDir, 'src', file)
    await mkdir(dirname(target), { recursive: true })
    await cp(join(typesDir, file), target)
  }
  const published = JSON.parse(await readFile(join(project, `node_modules/@deepseek-ai/dsh-${name}/package.json`), 'utf8'))
  const declarationExports = Object.fromEntries(Object.entries(published.exports).flatMap(([key, value]) => {
    if (['./typert', './client/typert'].includes(key)) return [[key, value]]
    if (key === './remote') return []
    const target = typeof value === 'object' && value?.types
    return target ? [[key, target.replace('./lib/types/', './src/')]] : []
  }))
  await writeFile(join(nativeDir, 'package.json'), JSON.stringify({ name: published.name, version: published.version, type: 'module', exports: declarationExports,
    files: published.files.filter(file => !file.startsWith('lib/typert.remote-')) }))
  await writeFile(join(nativeDir, 'tsconfig.json'), JSON.stringify({ ...hostConfig, include: ['src/**/*.ts'] }))
  paths[`@deepseek-ai/dsh-${name}`] = [`./packages/${name}/src/index.d.ts`]
  paths[`@deepseek-ai/dsh-${name}/*`] = [`./packages/${name}/src/*.d.ts`]
  for (const [key, target] of Object.entries(declarationExports)) {
    if (typeof target !== 'string') continue
    if (key === '.') continue
    paths[`@deepseek-ai/dsh-${name}/${key.slice(2)}`] = [`./packages/${name}/${target.slice(2)}`]
  }
  nativeReferences.push({ path: `./packages/${name}/tsconfig.json` })
}
await writeFile(join(packageDir, 'tsconfig.host.json'), JSON.stringify(hostConfig, null, 2))
const absolutePaths = Object.fromEntries(Object.entries(paths).map(([key, values]) => [key, values.map(value => resolve(scratch, value))]))
for (const reference of nativeReferences) await writeFile(resolve(scratch, reference.path), JSON.stringify({ ...hostConfig,
  compilerOptions: { ...hostConfig.compilerOptions, paths: absolutePaths }, include: ['src/**/*.ts'] }))
await writeFile(join(packageDir, 'tsconfig.host.json'), JSON.stringify({ ...hostConfig, compilerOptions: { ...hostConfig.compilerOptions, paths: absolutePaths } }))
await writeFile(join(scratch, 'tsconfig.host.json'), JSON.stringify({ ...hostConfig, compilerOptions: { ...hostConfig.compilerOptions, paths }, include: [], files: [], references: [{ path: './packages/workflow/tsconfig.host.json' }, { path: './packages/protocol/tsconfig.json' }, ...nativeReferences] }, null, 2))
const artifacts = new WorkspaceTypertGenerator(scratch).generateContributors(['host']).filter(artifact => artifact.package === manifest.name)
if (artifacts.length !== 1 || !artifacts[0].remote) throw new Error('Workflow Remote descriptors were not generated')
writePackageArtifacts(project, artifacts)
console.log('Generated native rc.3 Typert Host/Client descriptors')

const options = {
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true,
  declaration: true, emitDeclarationOnly: true, allowImportingTsExtensions: true,
  types: ['node'],
  rootDir: join(project, 'src'), outDir: join(lib, 'types'),
  lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.esnext.disposable.d.ts'],
}
const program = ts.createProgram([join(project, 'src/host/service.ts')], options)
const emit = program.emit()
const diagnostics = ts.getPreEmitDiagnostics(program).concat(emit.diagnostics)
if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCurrentDirectory: () => project, getCanonicalFileName: file => file, getNewLine: () => '\n',
}))

await build({ entryPoints: [join(project, 'src/host/service.ts')], bundle: true,
  platform: 'node', format: 'esm', target: 'node22', packages: 'external',
  outfile: join(lib, 'index.js'), sourcemap: true })
await build({ entryPoints: [join(project, 'src/shared/model.ts')], bundle: true,
  platform: 'neutral', format: 'esm', target: 'es2022', outfile: join(lib, 'shared.js') })

const browser = await build({ entryPoints: [join(project, 'src/client/index.tsx')], bundle: true,
  format: 'cjs', platform: 'browser', target: 'es2022', treeShaking: true,
  absWorkingDir: project, metafile: true,
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-api-gateway/client'],
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: join(lib, 'client.cjs'), write: false, minify: false })
const code = browser.outputFiles.find(file => file.path.endsWith('.cjs'))?.text
const css = browser.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n')
if (!code) throw new Error('Missing browser artifact')
const wrapper = `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory:function(require){\nconst __WORKFLOW_CSS__=${JSON.stringify(css)};\nvar module={exports:{}};var exports=module.exports;\n${code}\nreturn module.exports;\n}});\n`
await writeFile(join(lib, 'client.js'), wrapper)
await writeFile(join(lib, 'workflow.css'), css)
const packages = new Set()
for (const input of Object.keys(browser.metafile.inputs)) {
  let directory = dirname(resolve(project, input))
  while (directory.startsWith(join(project, 'node_modules'))) {
    try {
      const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      if (metadata.name) packages.add(directory)
      break
    } catch { directory = dirname(directory) }
  }
}
const notices = ['# Bundled browser dependency licenses', '', 'Generated from the packages included by esbuild. React and DSH are supplied by the host.', '']
for (const directory of [...packages].sort()) {
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  const license = (await readdir(directory)).find(file => /^licen[cs]e(?:\.|$)/i.test(file))
  if (!license) throw new Error(`Missing bundled license: ${relative(project, directory)}`)
  notices.push(`## ${metadata.name}@${metadata.version}`, '', await readFile(join(directory, license), 'utf8'), '')
}
await writeFile(join(project, 'THIRD-PARTY-NOTICES.md'), notices.join('\n'))
console.log(`Built ${manifest.name}@${manifest.version}: ${(await readdir(lib)).join(', ')}`)

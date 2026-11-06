import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '../../outputs/previews/reasoning-slider');
await mkdir(output, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ['previews/reasoning-slider/index.tsx'],
  outfile: resolve(output, 'preview.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  write: false,
});
for (const file of result.outputFiles) await writeFile(file.path, file.contents);
await writeFile(resolve(output, 'index.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH · 思考程度滑条预览</title><link rel="stylesheet" href="./preview.css"></head>
<body><div id="root"></div><script type="module" src="./preview.js"></script></body></html>\n`);
console.log(`Built isolated preview: ${output}`);
if (process.argv.includes('--serve')) {
  const port = Number(process.env.REASONING_PREVIEW_PORT ?? 43133);
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = resolve(output, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
      const child = relative(output, path);
      if (child.startsWith('..') || isAbsolute(child)) { response.writeHead(403).end(); return; }
      const content = await readFile(path);
      response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(content);
    } catch { response.writeHead(404).end(); }
  }).listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}`));
}

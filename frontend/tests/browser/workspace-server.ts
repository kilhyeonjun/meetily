import { resolve } from 'node:path';

const fixtureDir = import.meta.dir;
const runtime = JSON.stringify(resolve(fixtureDir, 'workspace-runtime.ts'));
const bundle = await Bun.build({
  entrypoints: [resolve(fixtureDir, 'workspace-fixture.tsx')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  plugins: [
    {
      name: 'memory-only-workspace',
      setup(builder) {
        builder.onLoad(
          { filter: /node_modules\/.+@tauri-apps\/api\/(core|event)\.(js|ts)$/ },
          () => ({ contents: `export { invoke, listen } from ${runtime};`, loader: 'ts' }),
        );
        builder.onLoad({ filter: /node_modules\/.+next\/navigation\.js$/ }, () => ({
          contents: `export { useRouter } from ${runtime};`,
          loader: 'ts',
        }));
      },
    },
  ],
});
if (!bundle.success) throw new AggregateError(bundle.logs, 'Fixture bundle failed');
const javascript = await bundle.outputs[0].text();
const css = await Bun.file(resolve(fixtureDir, '.workspace.css')).text();
Bun.serve({
  hostname: '127.0.0.1',
  port: 3129,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/fixture.js')
      return new Response(javascript, { headers: { 'Content-Type': 'text/javascript' } });
    if (path === '/fixture.css')
      return new Response(css, { headers: { 'Content-Type': 'text/css' } });
    return new Response(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>:root{--font-source-sans-3:system-ui,sans-serif}body{font-family:system-ui,sans-serif}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
      { headers: { 'Content-Type': 'text/html' } },
    );
  },
});

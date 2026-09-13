import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'vite';
import { designAssetsPlugin } from '../../scripts/design-assets.js';

const run = promisify(execFile);
const entry = resolve('web/src/build-mode.ts');

test('browser mode, server rendering and build-info agree despite conflicting Vite env files', async t => {
  const originalMode = process.env.VITE_WORKBENCH_DEMO;
  const originalNodeEnv = process.env.NODE_ENV;
  const envDir = await mkdtemp(join(tmpdir(), 'aipoch-build-mode-'));
  t.after(() => rm(envDir, { recursive: true, force: true }));
  const cases = [
    { name: 'a production env file cannot opt the default build into Demo', processValue: undefined, fileValue: 'true', expected: false, resolvedEnv: 'true' },
    { name: 'an explicit false stays unavailable despite a Demo env file', processValue: 'false', fileValue: 'true', expected: false, resolvedEnv: 'false' },
    { name: 'the explicit process opt-in produces Demo despite a false env file', processValue: 'true', fileValue: 'false', expected: true, resolvedEnv: 'true' },
  ];
  try {
    for (const scenario of cases) await t.test(scenario.name, async () => {
      if (scenario.processValue === undefined) delete process.env.VITE_WORKBENCH_DEMO;
      else process.env.VITE_WORKBENCH_DEMO = scenario.processValue;
      await writeFile(join(envDir, '.env.production'), `VITE_WORKBENCH_DEMO=${scenario.fileValue}\n`);

      // A fresh process reads the same source that SSR imports, with no module cache
      // or browser define. Vite's envDir is intentionally not an SSR environment.
      const server = await run(process.execPath, [
        '--import', 'tsx', '--input-type=module', '-e',
        `import { DEMO_MODE } from ${JSON.stringify(pathToFileURL(entry).href)}; process.stdout.write(JSON.stringify(DEMO_MODE));`,
      ], { cwd: resolve('.'), env: { ...process.env } });
      const serverMode: unknown = JSON.parse(server.stdout);
      assert.equal(serverMode, scenario.expected, 'SSR must use only the explicit process opt-in');

      let resolvedEnvironment: string | undefined;
      const result = await build({
        configFile: false,
        root: resolve('.'),
        mode: 'production',
        envDir,
        publicDir: false,
        logLevel: 'silent',
        plugins: [designAssetsPlugin(), {
          name: 'capture-build-mode-environment',
          configResolved(config) { resolvedEnvironment = config.env.VITE_WORKBENCH_DEMO; },
        }],
        build: {
          write: false,
          minify: false,
          target: 'esnext',
          lib: { entry, formats: ['es'], fileName: 'build-mode' },
        },
      });
      assert.equal(resolvedEnvironment, scenario.resolvedEnv, 'the conflicting env file must really be loaded by Vite');
      if (Array.isArray(result)) assert.equal(result.length, 1, 'only the requested ES format is built');
      const built = Array.isArray(result) ? result[0] : result;
      assert.ok('output' in built);
      const metadata = built.output.find(file => file.fileName === 'build-info.json');
      assert.ok(metadata?.type === 'asset');
      const info = JSON.parse(typeof metadata.source === 'string' ? metadata.source : Buffer.from(metadata.source).toString('utf8'));
      assert.equal(info.workbench_mode, scenario.expected ? 'demo' : 'unavailable');
      assert.equal(info.real_connector, false, 'neither build claims real Connector support');

      const browserEntry = built.output.find(file => file.type === 'chunk' && file.isEntry);
      assert.ok(browserEntry?.type === 'chunk');
      assert.deepEqual(browserEntry.imports, [], 'evaluate the actual pure browser entry without mocked imports');
      // An opposite runtime process value must not change the compiled browser mode.
      // This also catches a missing define that accidentally leaves the SSR fallback
      // in the browser bundle, independently of the manifest assertion above.
      process.env.VITE_WORKBENCH_DEMO = scenario.expected ? 'false' : 'true';
      const browserModule = await import(`data:text/javascript;base64,${Buffer.from(browserEntry.code).toString('base64')}`);
      assert.equal(browserModule.DEMO_MODE, scenario.expected);
      assert.equal(browserModule.DEMO_MODE, serverMode, 'SSR and the browser must agree during hydration');
      assert.equal(browserModule.DEMO_MODE, info.workbench_mode === 'demo', 'build-info must describe the mode actually shipped');
    });
  } finally {
    if (originalMode === undefined) delete process.env.VITE_WORKBENCH_DEMO;
    else process.env.VITE_WORKBENCH_DEMO = originalMode;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

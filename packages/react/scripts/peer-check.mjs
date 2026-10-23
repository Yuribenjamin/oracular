// Exercise actual tarballs in isolated consumers, without the source aliases used by vitest.
// The core's pending release version is applied only to a temporary package copy. Older metadata
// must be rejected; the minimum supported candidate must install and import in ESM and CJS.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = fileURLToPath(new URL('../', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^npm_(config|package)_/i.test(key)),
);
const scratch = mkdtempSync(join(tmpdir(), 'oracular-peer-check-'));
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, env, stdio: 'pipe', encoding: 'utf8' });
const pack = (cwd, output) => {
  mkdirSync(output, { recursive: true });
  run('npm', ['pack', '--ignore-scripts', '--pack-destination', output], cwd);
  return join(
    output,
    readdirSync(output).find((file) => file.endsWith('.tgz')),
  );
};
try {
  const reactTarball = pack(pkg, join(scratch, 'react-tarball'));
  const reactPath = dirname(createRequire(import.meta.url).resolve('react/package.json'));
  for (const version of ['0.17.0', '0.18.0']) {
    const core = join(scratch, `core-${version}`);
    const consumer = join(scratch, `consumer-${version}`);
    mkdirSync(core);
    mkdirSync(consumer);
    const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    writeFileSync(
      join(core, 'package.json'),
      JSON.stringify({ ...metadata, version, scripts: {}, workspaces: undefined }),
    );
    cpSync(join(root, 'dist'), join(core, 'dist'), { recursive: true });
    cpSync(join(root, 'schema'), join(core, 'schema'), { recursive: true });
    const coreTarball = pack(core, join(scratch, `tarball-${version}`));
    writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify({
        private: true,
        dependencies: {
          '@oracular/react': `file:${reactTarball}`,
          oracular: `file:${coreTarball}`,
          react: `file:${reactPath}`,
        },
      }),
    );
    const result = spawnSync(
      'npm',
      [
        'install',
        '--offline',
        '--strict-peer-deps',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
      ],
      { cwd: consumer, env, encoding: 'utf8' },
    );
    if (version === '0.17.0') {
      assert.notEqual(result.status, 0, 'React must reject core 0.17.0 before an app starts');
      assert.match(result.stderr, /ERESOLVE/);
      assert.match(result.stderr, />=0\.18\.0 <2/);
    } else {
      assert.equal(result.status, 0, result.stderr);
      const esm = `import { createIntentStore } from '@oracular/react'; import { createState, observe, serialize, settleState } from 'oracular';
        if(typeof settleState !== 'function') throw Error('missing core export');
        const config={episodeTimeout:10,intents:{tip:{prior:0.2,priorStrength:10,halfLife:100,signals:{s:2}}}};
        const saved=serialize(observe(createState(config),{name:'s',at:100}));
        const store=createIntentStore(config,{persist:{load:()=>saved,save:()=>{}},now:()=>200,settleOnLoad:true});
        await store.load(); if(store.getState().episode.startedAt!==null) throw Error('settlement did not run'); await store.dispose();`;
      run(process.execPath, ['--input-type=module', '-e', esm], consumer);
      run(
        process.execPath,
        [
          '-e',
          "if(typeof require('@oracular/react').createIntentStore!=='function'||typeof require('oracular').settleState!=='function')process.exit(1)",
        ],
        consumer,
      );
    }
  }
  console.log(
    'peer-check: core 0.17 rejected; candidate 0.18 installs and runs ESM/CJS settlement',
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

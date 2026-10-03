#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = resolveTestCachePath(root, 'bootstrap-json-output');
const fakeBin = path.join(cacheRoot, 'fake-bin');
const fakeNpmScript = path.join(fakeBin, 'fake-npm.js');
const tailMarker = 'FAKE_NPM_TAIL_MARKER';

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(fakeBin, { recursive: true });
await fsPromises.rm(path.join(fixtureRoot, 'node_modules'), { recursive: true, force: true });
await fsPromises.writeFile(
  fakeNpmScript,
  `process.stdout.write('fake npm stdout line\\n');
process.stdout.write('X'.repeat(1_200_000));
process.stdout.write('\\n${tailMarker}\\n');
`,
  'utf8'
);

if (process.platform === 'win32') {
  await fsPromises.writeFile(
    path.join(fakeBin, 'npm.cmd'),
    '@echo off\r\nnode "%~dp0\\fake-npm.js" %*\r\nexit /b 0\r\n',
    'utf8'
  );
} else {
  const npmPath = path.join(fakeBin, 'npm');
  await fsPromises.writeFile(
    npmPath,
    '#!/usr/bin/env node\nimport "./fake-npm.js";\n',
    'utf8'
  );
  await fsPromises.chmod(npmPath, 0o755);
}

const env = applyTestEnv({
  syncProcess: false,
  cacheRoot,
  extraEnv: {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`
  }
});

const result = runNode(
  [
    path.join(root, 'tools', 'setup', 'bootstrap.js'),
    '--repo',
    fixtureRoot,
    '--skip-dicts',
    '--skip-tooling',
    '--skip-index',
    '--skip-artifacts',
    '--json'
  ],
  'bootstrap json output',
  fixtureRoot,
  env,
  {
    stdio: 'pipe',
    spawnOptions: { maxBuffer: 8 * 1024 * 1024 }
  }
);

let payload;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch {
  console.error('bootstrap json-output test failed: stdout is not valid JSON');
  process.exit(1);
}
if (!payload?.steps || typeof payload.steps !== 'object') {
  console.error('bootstrap json-output test failed: missing steps payload');
  process.exit(1);
}
if (String(result.stdout || '').includes('fake npm stdout line')) {
  console.error('bootstrap json-output test failed: child stdout leaked into JSON stdout');
  process.exit(1);
}
if (!String(result.stderr || '').includes('fake npm stdout line')) {
  console.error('bootstrap json-output test failed: expected child stdout on stderr in --json mode');
  process.exit(1);
}
if (!String(result.stderr || '').includes(tailMarker)) {
  console.error('bootstrap json-output test failed: expected untruncated child stdout tail marker on stderr');
  process.exit(1);
}
if (!String(result.stderr || '').includes('[bootstrap]')) {
  console.error('bootstrap json-output test failed: expected bootstrap logs on stderr');
  process.exit(1);
}

console.log('bootstrap json-output test passed');

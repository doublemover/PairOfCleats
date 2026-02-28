#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testLogs', `lsp-embeddings-gates-testing-env-${process.pid}-${Date.now()}`);
const gatePath = path.join(root, 'tools', 'ci', 'run-lsp-embeddings-gates.js');
const probePath = path.join(tempRoot, 'testing-env-probe.test.js');
const testsJsonPath = path.join(tempRoot, 'tests.json');
const junitPath = path.join(tempRoot, 'junit.xml');
const diagnosticsPath = path.join(tempRoot, 'diagnostics.json');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

await fs.writeFile(
  probePath,
  [
    "#!/usr/bin/env node",
    "if (process.env.PAIROFCLEATS_TESTING !== '1') {",
    "  console.error(`expected PAIROFCLEATS_TESTING=1, received ${String(process.env.PAIROFCLEATS_TESTING)}`);",
    '  process.exit(9);',
    '}',
    "console.log('testing env probe passed');"
  ].join('\n'),
  'utf8'
);

await fs.writeFile(
  testsJsonPath,
  `${JSON.stringify([{ label: 'testing-env-probe', file: probePath, timeoutMs: 5000 }], null, 2)}\n`,
  'utf8'
);

const result = spawnSync(
  process.execPath,
  [
    gatePath,
    '--tests-json',
    testsJsonPath,
    '--junit',
    junitPath,
    '--diagnostics',
    diagnosticsPath
  ],
  {
    cwd: root,
    env: applyTestEnv({ testing: '0', syncProcess: false }),
    encoding: 'utf8'
  }
);

if (result.status !== 0) {
  console.error('lsp embeddings gates testing env test failed');
  console.error(result.stderr || result.stdout || '');
}
assert.equal(result.status, 0, `expected gate exit code 0, received ${result.status}`);

const diagnostics = JSON.parse(await fs.readFile(diagnosticsPath, 'utf8'));
assert.equal(diagnostics?.status, 'ok', `expected diagnostics status=ok, received ${String(diagnostics?.status)}`);
assert.equal(diagnostics?.metrics?.executed, 1, 'expected one executed gate test');
assert.equal(diagnostics?.results?.[0]?.status, 'passed', 'expected probe test status=passed');

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('lsp embeddings gates testing env test passed');

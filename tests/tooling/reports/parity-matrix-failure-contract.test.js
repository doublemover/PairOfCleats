#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-parity-failure-contract-'));
const out = path.join(temp, 'matrix');
const queries = path.join(temp, 'queries.txt');
await fs.writeFile(queries, 'fixture\n');
await fs.writeFile(path.join(temp, '.pairofcleats.json'), '{}');
await fs.mkdir(path.join(out, 'runs'), { recursive: true });
const reportPath = path.join(out, 'runs', 'sqlite-off.json');
const oldReport = { summary: { queries: 1, sqliteBackend: 'sqlite', annEnabled: false }, results: [{}] };
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(temp, 'cache'), embeddings: 'off' });
const args = [path.join(root, 'bin', 'pairofcleats.js'), 'report', 'parity', '--repo', temp,
  '--backends', 'sqlite', '--ann-modes', 'off', '--queries', queries, '--out-dir', out];
try {
  for (const variant of ['nonzero', 'no-report', 'invalid-report']) {
    await fs.writeFile(reportPath, JSON.stringify(oldReport));
    const shim = path.join(temp, `${variant}.mjs`);
    const childCode = variant === 'nonzero' ? 'process.exit(7);'
      : variant === 'no-report' ? 'process.exit(0);'
        : `require('node:fs').writeFileSync(${JSON.stringify(reportPath)}, ${JSON.stringify(JSON.stringify({
          ...oldReport, results: []
        }))});`;
    await fs.writeFile(shim, [
      "import childProcess from 'node:child_process';",
      "import { syncBuiltinESMExports } from 'node:module';",
      'const original = childProcess.spawn;',
      'childProcess.spawn = function(command, args, options) {',
      "  if (String(args?.[0] || '').endsWith('equivalence.test.js')) {",
      `    return original(command, ['-e', ${JSON.stringify(childCode)}], options);`,
      '  }',
      '  return original(command, args, options);',
      '};',
      'syncBuiltinESMExports();'
    ].join('\n'));
    const result = runNode(args, `parity child ${variant}`, temp, {
      ...env, NODE_OPTIONS: `${env.NODE_OPTIONS || ''} --import=${pathToFileURL(shim).href}`.trim()
    }, { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
    assert.equal(result.status, 1, result.stderr);
    const matrix = JSON.parse(await fs.readFile(path.join(out, 'matrix.json'), 'utf8'));
    assert.equal(matrix.results[0].status, 'failed');
    assert.equal(matrix.results[0].exitCode, variant === 'nonzero' ? 7 : 0);
    if (variant !== 'nonzero') assert.match(matrix.results[0].error, /Missing or invalid fresh parity report/);
    if (variant === 'invalid-report') {
      assert.deepEqual(JSON.parse(await fs.readFile(reportPath, 'utf8')).results, []);
    } else {
      await assert.rejects(fs.access(reportPath), 'failed children must not reuse a stale report');
    }
  }
  console.log('Parity rejects nonzero children, missing fresh reports and invalid report contents.');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}

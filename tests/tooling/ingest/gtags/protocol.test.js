import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runNode } from '../../../helpers/run-node.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-gtags-cxref-')));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
try {
  const input = path.join(root, 'input.txt'), output = path.join(root, 'output.jsonl');
  const captured = await fs.readFile(path.resolve('tests/fixtures/gtags/native-cxref.txt'), 'utf8');
  await fs.writeFile(input, [captured.trimEnd(), 'blank 9 src/blank.c   ',
    'unicode 3 src/caf%C3%A9%20name.c arbitrary source (with spaces) { /* punctuation */ }',
    'literal 5 src/literal%2520.c source %20 is not part of the path',
    'invalid 0 src/a.c image', 'invalid 1.5 src/a.c image', 'invalid 9007199254740993 src/a.c image',
    'invalid 1 src/bad%ZZ.c image', 'invalid 1 %2e%2e/outside.c image', 'invalid 1 src/%00.c image', ''
  ].join('\n'));
  const result = runNode([path.resolve('bin/pairofcleats.js'), 'ingest', 'gtags', '--repo', path.resolve('tests/fixtures/sample'),
    '--input', input, '--out', output, '--json'], 'native cxref protocol', process.cwd(), process.env,
  { stdio: 'pipe', allowFailure: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const rows = (await fs.readFile(output, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(rows, [
    ['src/main.c', 'alpha', 1], ['src/space % file.c', 'beta', 1], ['src/blank.c', 'blank', 9],
    ['src/café name.c', 'unicode', 3], ['src/literal%20.c', 'literal', 5]
  ].map(([file, name, line]) => ({ file, ext: '.c', name, startLine: line, endLine: line, role: 'definition', source: 'gtags' })));
  assert.equal(JSON.parse(result.stdout).stats.errors, 6);
  assert.equal(JSON.parse(result.stdout).stats.entries, rows.length);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Real GNU cxref columns and encoded paths preserve source identity, blank images, UTF-8 and literal percent; invalid input stays observable.');

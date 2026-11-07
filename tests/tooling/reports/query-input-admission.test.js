import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseQueryFileContent, readQueryInputPlan, readQueryFileSafe } from '../../../tools/shared/query-file-utils.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const { dir } = await prepareIsolatedTestCacheDir('query-input-admission');
try {
  for (const value of [[{ query: 'greet' }, { query: 'clamp' }], [null], [false], [1], [' '], [], {}, { queries: ['greet'], other: true }]) {
    assert.throws(() => parseQueryFileContent(JSON.stringify(value), 'selected.json'), { code: 'ERR_QUERY_INPUT' });
  }
  assert.throws(() => parseQueryFileContent('["valid",false]', 'selected.json'), error => error.entryIndex === 1
    && error.message.includes('selected.json entry 2'));
  assert.throws(() => parseQueryFileContent('[', 'selected.json'), { code: 'ERR_QUERY_INPUT' });
  assert.throws(() => parseQueryFileContent('# only comments\n\n', 'selected.txt'), { code: 'ERR_QUERY_INPUT' });
  assert.deepEqual(parseQueryFileContent('["[object Object]","greet","greet"]', 'selected.json'),
    ['[object Object]', 'greet', 'greet']);
  assert.deepEqual(parseQueryFileContent(' # comment\n greet \n\nclamp\n', 'selected.txt'), ['greet', 'clamp']);
  assert.deepEqual(parseQueryFileContent('[{"query":"greet"},{"query":"clamp"}]', 'selected.json', { jsonMode: 'query-field' }),
    ['greet', 'clamp'], 'the explicitly selected query-field text projection remains supported');
  const selected = path.join(dir, 'selected.json');
  await fs.writeFile(selected, '["greet","greet","clamp"]');
  const original = await readQueryInputPlan(selected);
  const limited = await readQueryInputPlan(selected, { limit: 2 });
  assert.equal(original.selectedCount, 3);
  assert.notEqual(original.key, limited.key);
  assert.notEqual(original.cases[0].caseId, original.cases[1].caseId, 'deliberate repeats retain separate unit-weight occurrences');
  assert.deepEqual(original.cases.map(row => row.weight), [1, 1, 1]);
  assert.throws(() => { original.cases[0].query = 'changed'; }, TypeError);
  assert.throws(() => original.cases.push({ query: 'changed' }), TypeError);
  assert.throws(() => { original.source.selection = 'different'; }, TypeError);
  await fs.writeFile(selected, '["clamp","greet","greet"]');
  const changed = await readQueryInputPlan(selected);
  assert.notEqual(original.key, changed.key);
  assert.notEqual(original.source.contentHash, changed.source.contentHash);
  assert.deepEqual(original.cases.map(row => row.query), ['greet', 'greet', 'clamp'], 'captured workload cannot change with its file');
  const missing = path.join(dir, 'missing.txt');
  const fallback = await readQueryInputPlan(missing, { explicit: false, fallback: ['smoke', 'smoke'] });
  assert.equal(fallback.source.selection, 'missing-default-fallback');
  assert.equal(fallback.source.effectiveSource, 'inline-smoke-fallback');
  assert.deepEqual(fallback.cases.map(row => row.query), ['smoke', 'smoke']);
  await assert.rejects(readQueryInputPlan(missing, { explicit: true, fallback: ['smoke'] }), { code: 'ERR_QUERY_INPUT' });
  for (const code of ['EACCES', 'EIO']) await assert.rejects(readQueryInputPlan(missing, { explicit: false, fallback: ['smoke'],
    readFile: async () => { throw Object.assign(new Error(code), { code }); } }), { code: 'ERR_QUERY_INPUT' });
  const pending = Object.freeze(Object.assign(new Error('read owner pending'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => false
  }));
  await assert.rejects(readQueryInputPlan(missing, { explicit: false, fallback: ['smoke'], readFile: async () => { throw pending; } }),
    error => error.cacheOwnershipPending === true && error.cacheOwnershipReleased() === false);
  const malformed = path.join(dir, 'malformed.json');
  await fs.writeFile(malformed, '{');
  await assert.rejects(readQueryInputPlan(malformed, { explicit: false, fallback: ['smoke'] }), { code: 'ERR_QUERY_INPUT' });
  await assert.rejects(readQueryFileSafe(malformed), { code: 'ERR_QUERY_INPUT' });
  assert.deepEqual(await readQueryFileSafe(missing), []);
  const invalidUtf8 = path.join(dir, 'invalid-utf8.txt');
  await fs.writeFile(invalidUtf8, Buffer.from([0xff]));
  await assert.rejects(readQueryInputPlan(invalidUtf8), { code: 'ERR_QUERY_INPUT' });

  const repo = path.join(dir, 'repo');
  await fs.mkdir(repo);
  const search = path.join(dir, 'search.fixture.js');
  const launched = path.join(dir, 'search-launched');
  await fs.writeFile(search, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(launched)}, 'launched');`);
  const env = applyTestEnv({ syncProcess: false });
  await fs.writeFile(selected, '[{"query":"greet"},{"query":"greet"}]');
  const matrixRoot = path.join(dir, 'matrix');
  const matrixChild = runNode(['tools/reports/parity-matrix.js', '--repo', repo, '--queries', selected,
    '--out-dir', matrixRoot, '--backends', 'sqlite', '--ann-modes', 'off', '--dry-run'],
  'captured query-field text pool', process.cwd(), env, { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  assert.equal(matrixChild.status, 0, matrixChild.stderr);
  const matrix = JSON.parse(await fs.readFile(path.join(matrixRoot, 'matrix.json'), 'utf8'));
  assert.equal(matrix.queryCount, 2);
  assert.deepEqual(JSON.parse(await fs.readFile(matrix.queryFile, 'utf8')), ['greet', 'greet']);
  assert.notEqual(matrix.queryInputPlans[0].cases[0].caseId, matrix.queryInputPlans[0].cases[1].caseId);
  assert.equal(matrix.querySelectionPolicy, 'ordered-query-text-pools-preserve-occurrences');
  for (const queries of [malformed, selected, missing]) {
    // Records are intentionally unsupported here, rather than stringified.
    if (queries === selected) await fs.writeFile(selected, '[{"query":"greet"},{"query":"clamp"}]');
    for (const args of [
      ['tests/retrieval/parity/equivalence.test.js', '--repo', repo, '--queries', queries, '--search', search, '--enforce'],
      ['tools/reports/compare-models.js', '--repo', repo, '--queries', queries, '--models', 'tiny-a,tiny-b', '--json']
    ]) {
      const result = runNode(args, 'invalid explicit query input', process.cwd(), env,
        { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /ERR_QUERY_INPUT/);
      await assert.rejects(fs.stat(launched), { code: 'ENOENT' });
    }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('query input plans reject substituted workloads and preserve ordered source-qualified occurrences');

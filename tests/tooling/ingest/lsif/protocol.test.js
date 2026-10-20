import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runNode } from '../../../helpers/run-node.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lsif-protocol-')));
const repo = path.join(root, 'repo space λ');
await fs.mkdir(repo, { recursive: true });
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
const v = (id, label, rest = {}) => ({ id, type: 'vertex', label, ...rest });
let edgeId = 1000;
const e = (label, outV, inVs, rest = {}) => ({ id: edgeId++, type: 'edge', label, outV, inVs, ...rest });
const range = (id, line, text, label = 'range') => v(id, label, {
  start: { line, character: 1 }, end: { line, character: 4 }, tag: { type: 'reference', text }
});
const vertices = [
  v('meta', 'metaData', { version: '0.6.0', positionEncoding: 'utf-16' }),
  v('project', 'project', { resource: pathToFileURL(repo).href }),
  v('doc-a', 'document', { uri: pathToFileURL(path.join(repo, 'src', 'space%25 name-λ.ts')).href, languageId: 'typescript' }),
  v('doc-b', 'document', { uri: pathToFileURL(path.join(repo, 'src', 'other.ts')).href, languageId: 'typescript' }),
  v('doc-v', 'document', { uri: 'file:///repo/src/virtual%20%CE%BB.ts', languageId: 'typescript' }),
  range('a', 0, 'alpha'), range('b', 4, 'alpha'), range('c', 9, 'beta'), range('d', 2, 'virtual'),
  range('navigation', 8, 'target', 'resultRange'),
  v('set-a', 'resultSet'), v('set-b', 'resultSet'), v('definition', 'definitionResult'),
  v('references-a', 'referenceResult'), v('references-b', 'referenceResult'),
  v('moniker', 'moniker', { kind: 'import', scheme: 'fixture', identifier: 'external:alpha', unique: 'scheme' })
];
const contains = [e('contains', 'doc-a', ['a']), e('contains', 'doc-b', ['b', 'c']), e('contains', 'doc-v', ['d'])];
const next = [
  { id: edgeId++, type: 'edge', label: 'next', outV: 'b', inV: 'set-b' },
  { id: edgeId++, type: 'edge', label: 'next', outV: 'set-b', inV: 'set-a' },
  { id: edgeId++, type: 'edge', label: 'textDocument/definition', outV: 'set-a', inV: 'definition' },
  { id: edgeId++, type: 'edge', label: 'textDocument/references', outV: 'set-a', inV: 'references-a' }
];
const items = [
  e('item', 'definition', ['a', 'c'], { shard: 'project' }),
  e('item', 'references-a', ['a'], { shard: 'doc-a', property: 'definitions' }),
  e('item', 'references-a', ['b'], { shard: 'doc-b', property: 'references' }),
  e('item', 'references-a', ['c'], { shard: 'doc-b', property: 'declarations' }),
  e('item', 'references-b', ['d'], { shard: 'doc-v', property: 'references' }),
  e('item', 'references-a', ['references-b'], { shard: 'project', property: 'referenceResults' }),
  e('item', 'references-a', ['moniker'], { shard: 'project', property: 'referenceLinks' }),
  e('item', 'definition', ['navigation'], { shard: 'doc-a' })
];
const canonical = rows => rows.slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const run = async (name, graph) => {
  const input = path.join(root, `${name}.lsif`), output = path.join(root, `${name}.jsonl`);
  await fs.writeFile(input, graph.map(row => typeof row === 'string' ? row : JSON.stringify(row)).join('\n'));
  const result = runNode([path.resolve('bin/pairofcleats.js'), 'ingest', 'lsif', '--repo', repo, '--input', input,
    '--out', output, '--json'], `LSIF ${name}`, process.cwd(), process.env, { stdio: 'pipe', allowFailure: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const rows = (await fs.readFile(output, 'utf8')).split(/\r?\n/).filter(Boolean).map(row => JSON.parse(row));
  return { rows: canonical(rows), summary: JSON.parse(result.stdout) };
};
try {
  const primary = await run('protocol-06', [...vertices, ...contains, ...next, ...items]);
  assert.equal(primary.rows.length, 6, 'result links and repeated membership cannot manufacture or duplicate locations');
  assert.deepEqual(primary.rows.map(row => [row.file, row.startLine, row.role]).sort(), [
    ['src/space%25 name-λ.ts', 1, 'definition'], ['src/space%25 name-λ.ts', 9, 'definition'],
    ['src/other.ts', 5, 'reference'], ['src/other.ts', 10, 'definition'], ['src/other.ts', 10, 'other'],
    ['src/virtual λ.ts', 3, 'reference']
  ].sort());
  assert.equal(primary.summary.stats.definitions, 3);
  assert.equal(primary.summary.stats.references, 2);
  assert.equal(primary.summary.stats.errors, 0);
  const legacy = await run('legacy-document-shard', [
    ...vertices.filter(row => !['meta', 'navigation'].includes(row.id)), ...next,
    ...items.filter(row => !row.inVs.includes('navigation')).map(row => row.inVs.includes('d')
      ? { ...row, shard: undefined, document: 'doc-v' } : row), ...contains.filter(row => row.outV !== 'doc-v')
  ]);
  assert.deepEqual(legacy.rows, primary.rows.filter(row => row.name !== 'target'),
    'older document hints and later containment retain identical concrete occurrences');
  assert.equal(legacy.summary.stats.errors, 0);
  const invalid = await run('invalid-authority', [...vertices,
    v('remote', 'document', { uri: 'file://untrusted.example/repo/src/remote.ts' }),
    v('encoded', 'document', { uri: 'file:///repo/src%2Fescape.ts' }),
    range('bad-position', -1, 'bad'), range('unowned', 0, 'bad'), range('remote-range', 0, 'bad'),
    range('encoded-range', 0, 'bad'), range('conflict', 0, 'bad'), range('mismatch', 0, 'bad'),
    ...contains, ...items,
    e('contains', 'doc-a', ['conflict', 'mismatch']), e('contains', 'doc-b', ['conflict']),
    e('item', 'a', ['definition']), e('item', 'unknown-result', ['a']),
    e('item', 'definition', ['bad-position'], { shard: 'doc-a' }),
    e('item', 'definition', ['unowned'], { shard: 'project' }),
    e('item', 'definition', ['remote-range'], { shard: 'remote' }),
    e('item', 'definition', ['encoded-range'], { shard: 'encoded' }),
    e('item', 'definition', ['conflict']), e('item', 'definition', ['mismatch'], { shard: 'doc-b' }), '{broken-json'
  ]);
  assert.deepEqual(invalid.rows, primary.rows, 'invalid direction, ownership, URI and positions cannot add or replace valid occurrences');
  assert.equal(invalid.summary.stats.errors, 9, 'each rejected protocol/authority witness is observable');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('LSIF result-to-range items preserve roles, shared results, document/shard authority and native/virtual URI decoding.');

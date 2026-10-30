import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { parseFilterExpression, serializeFilterExpression } from '../../../src/retrieval/filters.js';
import { filterChunks } from '../../../src/retrieval/output.js';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { search } from '../../../src/integrations/core/search.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { META_V2_SCHEMA_VERSION } from '../../../src/index/metadata/meta-v2.js';
import { createSqliteFilterFactWriter, sealSqliteFilterFacts } from '../../../src/storage/sqlite/filter-facts.js';
import { readSqliteFilterFactPage } from '../../../src/retrieval/sqlite-filter-page.js';
import { createFilterEnumeration } from '../../../src/retrieval/pipeline/filter-enumeration.js';
import { stableStringify } from '../../../src/shared/stable-json.js';

const projection = value => Object.fromEntries(['file', 'lang', 'ext', 'type'].map(key => [key, value[key]]));
for (const [input, expected] of [
  ['file:src,lang:python', { file: ['src'], lang: ['python'], ext: null, type: null }],
  ['file:src lang:python', { file: ['src'], lang: ['python'], ext: null, type: null }],
  ['file:"My File.js" lang=python', { file: ['My File.js'], lang: ['python'], ext: null, type: null }],
  ['"file:My File.js" lang:python', { file: ['My File.js'], lang: ['python'], ext: null, type: null }],
  ['lang:js,ts,type:FunctionDeclaration', { file: null, lang: ['js', 'ts'], ext: null, type: ['FunctionDeclaration'] }],
  [String.raw`C:\src\file.js file:"notes, old.py"`, { file: [String.raw`C:\src\file.js`, 'notes, old.py'], lang: null, ext: null, type: null }],
  [String.raw`file:"/My File\.py$/"`, { file: [String.raw`/My File\.py$/`], lang: null, ext: null, type: null }],
  ["file:O'Brien.py", { file: ["O'Brien.py"], lang: null, ext: null, type: null }]
]) {
  const result = parseFilterExpression(input);
  assert.deepEqual(result.errors, [], input); assert.deepEqual(projection(result), expected, input);
  for (const term of result.terms) {
    assert.ok(term.start >= 0 && term.end <= input.length && term.start < term.end);
    assert.ok(term.valueStart >= term.start && term.valueEnd <= term.end);
  }
}
for (const [input, code] of [['file:"unterminated', 'unclosed_quote'], ['file:src,unknown:python', 'unknown_field'],
  ['file:', 'empty_value'], ['file:""', 'empty_value'], ['file:src,', 'empty_value'],
  ['file:"a"trailing', 'trailing_quote_text'], ['x'.repeat(65537), 'expression_limit']]) {
  const result = parseFilterExpression(input);
  assert.ok(result.diagnostics.some(row => row.code === code), input.slice(0, 80));
  assert.ok(result.errors.every(message => / at \d+$/.test(message)));
}
const values = ['My File.py', 'notes, old.py', String.raw`C:\src\file.py`, String.raw`\\host\share`,
  '"quoted".py', "O'Brien.py", ' 日本語.py ', '/My File[.]py$/', 'line\nname.py', 'tab\tname.py'];
for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) {
  const typed = { file: [values[i], values[j]], lang: ['python', 'js'], ext: ['.py'], type: ['FunctionDeclaration'] };
  const parsed = parseFilterExpression(serializeFilterExpression(typed));
  assert.deepEqual(parsed.errors, []); assert.deepEqual(projection(parsed), typed);
}

const { dir } = await prepareIsolatedTestCacheDir('filter-expression-consumer');
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off' });
try {
  const indexDir = await createCompatibilityIndex(repo, { published: true, mode: 'code', compatibilityKey: 'filter-grammar' });
  const rows = [['src/My File.py', 'python', 'Jane Doe'], ['src/other.js', 'javascript', 'Jane Smith'],
    ['docs/notes, old.py', 'python', 'John Doe']].map(([file, lang, author], id) => ({
    id, file, lang, name: `row-${id}`, chunkUid: `grammar:${id}`, start: 0, end: 5,
    kind: 'FunctionDeclaration', tokens: ['alpha'], last_author: author,
    metaV2: { schemaVersion: META_V2_SCHEMA_VERSION, lang }
  }));
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(rows));
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), JSON.stringify({ vocab: ['alpha'],
    postings: [[[0, 1], [1, 1], [2, 1]]], docLengths: [1, 1, 1], totalDocs: 3, avgDocLen: 1 }));
  const indexed = buildFilterIndex(rows, { fileChargramN: 3 });
  for (const filterIndex of [null, indexed]) {
    assert.deepEqual(filterChunks(rows, { file: 'My File.py', author: 'Jane Doe' }, filterIndex).map(row => row.id), [0]);
    assert.deepEqual(filterChunks(rows, { author: 'Jane Doe' }, filterIndex).map(row => row.id), [0]);
  }
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE chunks (id INTEGER PRIMARY KEY,mode TEXT NOT NULL)');
    const put = createSqliteFilterFactWriter(db);
    for (const row of rows) {
      db.prepare('INSERT INTO chunks VALUES (?,?)').run(row.id, 'code');
      put({ ...row, mode: 'code', metaV2_json: JSON.stringify(row.metaV2) });
    }
    assert.equal(sealSqliteFilterFacts(db, 'code'), true);
    for (const [groups, expected] of [[[['src'], ['My File.py']], [0]], [[['other.js'], ['My File.py']], []]]) {
      const filters = { file: groups.flat(), filePrefilter: { allGroups: groups } };
      assert.deepEqual(filterChunks(rows, filters, indexed).map(row => row.id), expected);
      const page = await readSqliteFilterFactPage({ db, mode: 'code', filters, offset: 0, limit: 10, rowCount: rows.length });
      assert.deepEqual(page.ids, expected); assert.equal(page.total, expected.length);
    }
    assert.equal(await readSqliteFilterFactPage({ db, mode: 'code', filters: { file: ['src'],
      filePrefilter: { allGroups: [['/My File[.]py$/']] } }, offset: 0, limit: 10, rowCount: rows.length }), null,
    'an unsupported regex conjunction retains the exact metadata fallback');
  } finally { db.close(); }
  const filters = { file: 'My File.py' }, modes = ['code'], generation = { buildId: 'grammar-source' };
  const current = createFilterEnumeration({ filters, modes, generation });
  const oldRequest = createHash('sha256').update(stableStringify({ version: 1, filters, modes })).digest('hex');
  assert.notEqual(current.request, oldRequest);
  const oldCursor = Buffer.from(JSON.stringify({ version: 1, generation: current.generation,
    request: oldRequest, offsets: { code: 0 }, modifiedAfter: null })).toString('base64url');
  assert.throws(() => createFilterEnumeration({ cursor: oldCursor, filters, modes, generation }), { code: 'INVALID_REQUEST' },
    'old predicate meaning cannot reenter through a continuation or persisted match-cache identity');
  for (const query of [undefined, 'alpha']) for (const expression of ['file:src,lang:python', 'file:src lang:python',
    'file:"My File.py" lang:py', '"file:My File.py" lang:python', 'file:"/My File[.]py$/"']) {
    const result = await search(repo, { query, args: ['--backend', 'memory', '--mode', 'code', '--no-ann', '--filter', expression] });
    assert.deepEqual(result.code.map(row => row.file), ['src/My File.py'], expression);
  }
  const comma = await search(repo, { query: 'alpha', args: ['--backend', 'memory', '--mode', 'code', '--no-ann',
    '--filter', 'file:"notes, old.py",lang:python'] });
  assert.deepEqual(comma.code.map(row => row.file), ['docs/notes, old.py']);
  const impossible = await search(repo, { query: 'alpha', args: ['--backend', 'memory', '--mode', 'code', '--no-ann',
    '--lang', 'js', '--filter', 'file:src,lang:python'] });
  assert.deepEqual(impossible.code, [], 'explicit flags intersect the expression rather than weakening it');
  for (const temperature of ['cold', 'warm']) {
    const disjointFiles = await search(repo, { query: 'alpha', args: ['--backend', 'memory', '--mode', 'code', '--no-ann',
      '--file', 'other.js', '--filter', 'file:"My File.py"'] });
    assert.deepEqual(disjointFiles.code, [], `${temperature}: explicit filename and expression filename stay conjunctive`);
  }
  await assert.rejects(search(repo, { query: 'alpha', args: ['--filter', 'file:src,unknown:python'] }),
    error => error.code === 'INVALID_REQUEST' && /Unknown filter key unknown at 9/.test(error.message)
      && error.details.filterDiagnostics[0].start === 9);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Bounded filter grammar, exact typed roundtrips and real ranked/enumeration consumers preserve authored boundaries.');

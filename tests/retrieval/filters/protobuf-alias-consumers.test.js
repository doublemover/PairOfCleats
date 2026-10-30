import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { prepareRegisteredLanguage } from '../../helpers/registered-language-acceptance.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { normalizeLangFilter, mergeLangFilters } from '../../../src/retrieval/filters.js';
import { parseSearchArgs } from '../../../src/retrieval/cli-args.js';
import { normalizeSearchOptions } from '../../../src/retrieval/cli/normalize-options.js';
import { filterChunks } from '../../../src/retrieval/output.js';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { createSqliteFilterFactWriter, sealSqliteFilterFacts } from '../../../src/storage/sqlite/filter-facts.js';
import { readSqliteFilterFactPage } from '../../../src/retrieval/sqlite-filter-page.js';
import { search } from '../../../src/integrations/core/search.js';
import { LANGUAGE_ROUTE_DESCRIPTORS } from '../../../src/index/language-registry/descriptors.js';

const fixture = await prepareRegisteredLanguage({ ext: '.proto', text: 'syntax="proto3"; message Needle { string needle = 1; }' });
assert.equal(fixture.lang.id, 'proto');
const proto = fixture.payloads.find(row => row.name?.includes('Needle'));
assert.ok(proto); assert.equal(proto.metaV2.lang, 'proto');
const rows = [{ ...proto, id: 0, tokens: ['needle'] }, { ...proto, id: 1, file: 'other.js', lang: 'javascript',
  chunkUid: 'non-proto-row', metaV2: { ...proto.metaV2, lang: 'javascript' }, tokens: ['needle'] }];
const { dir } = await prepareIsolatedTestCacheDir('protobuf-alias-consumers');
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off' });
const aliases = ['proto', 'protobuf', 'PROTOBUF', 'protocol buffer', 'protocol buffers'];
for (const descriptor of LANGUAGE_ROUTE_DESCRIPTORS) assert.deepEqual(normalizeLangFilter(descriptor.id), [descriptor.id]);
const options = args => normalizeSearchOptions({ argv: parseSearchArgs(args), rawArgs: args,
  rootDir: repo, userConfig: {}, metricsDir: null, policy: {} });
const index = buildFilterIndex(rows);
const db = new Database(':memory:');
try {
  db.exec('CREATE TABLE chunks(id INTEGER PRIMARY KEY,mode TEXT NOT NULL)');
  const put = createSqliteFilterFactWriter(db);
  for (const row of rows) { db.prepare('INSERT INTO chunks VALUES (?,?)').run(row.id, 'code'); put({ ...row, mode: 'code', metaV2_json: JSON.stringify(row.metaV2) }); }
  assert.equal(sealSqliteFilterFacts(db, 'code'), true);
  for (const alias of aliases) {
    const expression = `lang:${JSON.stringify(alias)}`;
    const request = options(['--mode', 'code', '--lang', 'proto', '--filter', expression, 'needle']);
    assert.equal(request.langImpossible, false); assert.deepEqual(request.langFilter, ['proto']);
    assert.deepEqual(normalizeLangFilter(alias, { preserveValues: true }), ['proto']);
    assert.deepEqual(mergeLangFilters(normalizeLangFilter('proto'), normalizeLangFilter(alias, { preserveValues: true })).values, ['proto']);
    for (const filterIndex of [null, index]) assert.deepEqual(filterChunks(rows, { lang: request.langFilter }, filterIndex).map(row => row.id), [0]);
    const page = await readSqliteFilterFactPage({ db, mode: 'code', filters: { lang: request.langFilter }, offset: 0, limit: 10, rowCount: 2 });
    assert.deepEqual(page.ids, [0]);
  }
  for (const [alias, language] of [['js', 'javascript'], ['ts', 'typescript'], ['c++', 'clike'], ['bash', 'shell']]) {
    assert.deepEqual(normalizeLangFilter(alias), [language]); assert.deepEqual(normalizeLangFilter(language), [language]);
  }
  const indexDir = await createCompatibilityIndex(repo, { published: true, mode: 'code', compatibilityKey: 'protobuf-alias' });
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(rows));
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), JSON.stringify({ vocab: ['needle'], postings: [[[0, 1], [1, 1]]],
    docLengths: [1, 1], totalDocs: 2, avgDocLen: 1 }));
  for (const args of [['--lang', 'proto'], ['--lang', 'protobuf'], ['--lang', 'PROTOBUF'],
    ['--filter', 'lang:"protocol buffer"'], ['--filter', 'lang:"protocol buffers"'],
    ['--lang', 'protobuf', '--filter', 'lang:proto']]) {
    const result = await search(repo, { query: 'needle', args: ['--backend', 'memory', '--mode', 'code', '--no-ann', ...args] });
    assert.deepEqual(result.code.map(row => row.id), [0], args.join(' '));
  }
} finally { db.close(); await fs.rm(dir, { recursive: true, force: true }); }
console.log('Registered proto identities agree across aliases, CLI intersections, indexed/fallback predicates and SQLite facts.');

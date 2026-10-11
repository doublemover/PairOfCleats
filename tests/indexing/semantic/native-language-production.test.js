import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { createSemanticFindService } from '../../../src/semantic/find.js';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';
import { createSqliteSemanticStore } from '../../../src/semantic/sqlite-store.js';
import { buildDatabaseFromArtifacts } from '../../../src/storage/sqlite/build/from-artifacts.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-native-production-')), repoRoot = path.join(temp, 'repo');
await fs.mkdir(repoRoot);
try {
  for (const [file, text] of [
    ['main.py', 'def run(x):\n    if x:\n        return helper(x)\n    return 0\n'],
    ['main.c', 'int run(int x) { if (x) return helper(x); return 0; }'],
    ['main.swift', 'func run(_ x: Int) -> Int { if x > 0 { return helper(x) }; return 0 }'],
    ['main.rs', 'fn run(x: i32) -> i32 { if x > 0 { return helper(x); } return 0; }']
  ]) await fs.writeFile(path.join(repoRoot, file), text);
  applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'stub', testConfig: {
    indexing: { semantic: { enabled: true, languages: ['python', 'c', 'swift', 'rust'], enrichment: { bindings: 'off', localFlow: 'eager' } },
      embeddings: { enabled: false }, typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, treeSitter: { enabled: true } }
  } });
  const build = () => buildIndex(repoRoot, { mode: 'code', stage: 'stage2', incremental: true, 'stub-embeddings': true, 'scm-provider': 'none' });
  const open = () => openPublishedSemanticStore({ repoRoot, indexDir: getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot)), requireQueryIndex: true });
  await build(); const cold = await open();
  await build(); const { store, manifest } = await open();
  assert.notEqual(cold.manifest.generation.baseBuildId, manifest.generation.baseBuildId);
  assert.deepEqual(manifest.partitions.map(part => part.canonicalHash).sort(), cold.manifest.partitions.map(part => part.canonicalHash).sort());
  assert.ok(manifest.partitions.every(part => Object.values(part.members).flat().every(piece => piece.path.startsWith('semantic-cache-'))), 'warm native build reuses syntax and flow');
  const languages = new Set();
  for (const part of manifest.partitions.filter(part => part.partitionId.startsWith('sy1:'))) {
    for await (const source of store.iterateRows(part.partitionId, 'semantic_sources')) languages.add(source.language);
    assert.ok((await store.getCoverage([part.partitionId])).some(row => row.phase === 'syntax' && row.state === 'complete'));
  }
  assert.deepEqual([...languages].sort(), ['c', 'python', 'rust', 'swift']);
  const scope = { repoRoot, generation: manifest.generation };
  const result = await createSemanticFindService()({ store, request: { ...scope, selector: { field: 'invocationKind', value: 'call' } } });
  assert.equal(result.records.length, 4);
  const request = { ...scope, refs: result.records.map(row => row.ref), include: ['operands', 'names', 'ownership'] };
  const hydrate = async currentStore => {
    const service = createSemanticDetailService(), rows = { records: [], operands: [], names: [], ownership: [], coverage: [] };
    let cursor = null, pages = 0;
    do {
      const page = await service({ store: currentStore, request: { ...request, limits: { records: 2, rows: 8 }, ...(cursor ? { cursor } : {}) } });
      for (const family of ['records', 'operands', 'names', 'ownership']) rows[family].push(...page[family]);
      rows.coverage.push(...page.coverage.extraction, ...page.coverage.analysis);
      cursor = page.cursor; assert.ok(++pages < 32, 'bounded pagination makes progress');
    } while (cursor);
    rows.coverage = [...new Map(rows.coverage.map(row => [JSON.stringify(row), row])).values()];
    return rows;
  };
  const artifact = await hydrate(store);
  assert.ok(artifact.coverage.some(row => row.phase === 'localFlow' && row.state === 'partial'));
  const outPath = path.join(temp, 'native.sqlite');
  await buildDatabaseFromArtifacts({ Database, outPath, indexDir: getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot)), mode: 'code',
    vectorConfig: {}, modelConfig: {}, emitOutput: false, validateMode: 'full', optimize: false });
  const db = new Database(outPath, { readonly: true });
  try {
    const sqlite = createSqliteSemanticStore({ db, repoRoot, indexPath: outPath, artifactSurfaceVersion: manifest.artifactSurfaceVersion, generation: manifest.generation });
    assert.deepEqual(await hydrate(sqlite), artifact);
  } finally { db.close(); }
  console.log('Four-language cold/warm production indexing, retained flow and SQLite detail parity passed');
} finally { await fs.rm(temp, { recursive: true, force: true }); }

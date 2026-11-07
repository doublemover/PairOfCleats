import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createHistoryAgentReader } from '../../../src/integrations/inference-history/agent-reader.js';
import { DEFAULT_ARCHIVE_ANALYZER, registerArchiveAnalyzer } from '../../../src/integrations/inference-history/lexical-analyzer.js';
import { digest } from '../../../src/integrations/inference-history/common.js';
import { projectArtifact } from '../../../src/integrations/inference-history/artifact-projection.js';
import { createLocalSourceHistoryService } from '../../../src/integrations/inference-history/service.js';
import { searchHybridHistory } from '../../../src/integrations/inference-history/hybrid.js';
import { searchHistory } from '../../../src/integrations/inference-history/reader.js';
import { historyIndexState } from '../../../src/integrations/inference-history/generation.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('hybrid-pagination-contract');
const source = path.join(dir, 'artifacts-0001.json'), indexPath = path.join(dir, 'archive.sqlite');
const records = Array.from({ length: 1001 }, (_, id) => projectArtifact({ text: `cobalt evidence ${id}`,
  sourceSha256: digest(String(id)), locator: `cobalt-${id}.txt` })).flat();
await fs.writeFile(source, JSON.stringify(records));
const bootstrap = await createLocalSourceHistoryService({ sources: [{ path: source, sha256: digest(await fs.readFile(source)) }], indexPath });
await bootstrap.dispose();
const db = new Database(indexPath);
registerArchiveAnalyzer(db, Object.freeze({ ...DEFAULT_ARCHIVE_ANALYZER,
  terms(text) {
    assert.equal(db.inTransaction, true, 'each synchronous search retains one SQLite read snapshot');
    return DEFAULT_ARCHIVE_ANALYZER.terms(text);
  }
}));
try {
  searchHistory(db, { query: 'cobalt', top: 3 });
  assert.equal(db.inTransaction, false, 'the search closes only its own read snapshot');
  db.transaction(() => {
    searchHistory(db, { query: 'cobalt', top: 3 });
    assert.equal(db.inTransaction, true, 'an existing caller transaction remains owned by its caller');
  })();
  const generationRef = historyIndexState(db).generationRef;
  assert.equal(searchHistory(db, { query: 'cobalt', top: 3, expectedGeneration: generationRef }).hits.length, 3);
  for (const expectedGeneration of ['f'.repeat(64), null, 'invalid']) {
    assert.throws(() => searchHistory(db, { query: 'cobalt', expectedGeneration }), { code: 'ERR_INFERENCE_HISTORY_STALE' });
  }
  const semantic = { kind: 'local', indexGenerationRef: historyIndexState(db).generationRef,
    modelId: 'synthetic-no-model', modelVersion: '1', dimensions: 2,
    async search() { return { candidates: [], complete: true }; } };
  const reader = createHistoryAgentReader({ partition: 'synthetic', service: {
    search: request => searchHybridHistory(db, request, semantic, async () => {}) } });
  for (const mode of ['hybrid', 'auto']) {
    let page = await reader.execute('search', { query: 'cobalt', mode, top: 3, candidateLimit: 10 });
    const seen = new Set(); let pages = 0;
    for (;;) {
      assert.equal(page.ok, true); assert.equal(page.page.complete, false);
      assert.equal(page.page.contract.kind, 'bounded-fused-pool');
      for (const item of page.evidence) { assert.equal(seen.has(item.sourceRef), false); seen.add(item.sourceRef); }
      pages++;
      if (!page.page.next) break;
      assert.equal(page.page.next.request.continuation, undefined);
      page = await reader.execute(page.page.next.command, page.page.next.request);
      assert.ok(pages <= 4);
    }
    assert.equal(seen.size, 10); assert.equal(pages, 4);
    assert.equal(page.page.contract.furtherContinuation, 'unavailable', 'do not skip the unreturned lexical window');
  }
  const lexicalRequest = { query: 'cobalt', mode: 'lexical', top: 100 };
  // Full detail includes the retained result and provenance. The default
  // summary projection intentionally fits more evidence into the same budget.
  const bounded = await reader.execute('search', lexicalRequest, { detail: 'full' });
  assert.equal(bounded.ok, false);
  assert.equal(bounded.error.code, 'OUTPUT_BUDGET', '100 full evidence records cannot silently exceed the default transport budget');
  const outputOptions = { detail: 'full', maxOutputBytes: 2097152 };
  const lexical = await reader.execute('search', lexicalRequest, outputOptions);
  assert.equal(lexical.ok, true); assert.ok(lexical.page.next);
  assert.equal(lexical.evidence.length, 100, 'the explicitly selected supported output budget retains the original page');
  const next = await reader.execute(lexical.page.next.command, lexical.page.next.request, outputOptions);
  assert.equal(next.ok, true, 'lexical continuation retains its independent contract');
  const wrong = await reader.execute('search', { query: 'cobalt', mode: 'hybrid', expectedGeneration: 'f'.repeat(64) });
  assert.equal(wrong.ok, false); assert.equal(wrong.error.code, 'ERR_INFERENCE_HISTORY_STALE');
  await assert.rejects(searchHybridHistory(db, { query: 'cobalt', mode: 'hybrid', continuation: 'lexical-token' }, semantic, async () => {}), { code: 'ERR_INFERENCE_HISTORY_INPUT' });
} finally { db.close(); }
console.log('hybrid next actions replay within the fused pool and decline cross-channel cursor continuation');

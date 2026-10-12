import assert from 'node:assert/strict';
import { createFilterEnumeration, enumerateFilterMatches, buildFilterPagination } from '../../../src/retrieval/pipeline/filter-enumeration.js';
import { createChunkFilterPredicate } from '../../../src/retrieval/output/filters.js';

const meta = Array.from({ length: 10000 }, (_, id) => ({ id, kind: 'FunctionDeclaration', file: 'src/' + id + '.js' }));
const filters = { type: 'FunctionDeclaration' }, generation = { id: 'bounded-matches' };
let cursor = null, scanned = 0, returned = 0;
do {
  const enumeration = createFilterEnumeration({ cursor, filters, generation, modes: ['code'] });
  const hits = await enumerateFilterMatches({ meta, match: createChunkFilterPredicate(filters), mode: 'code', topN: 257, enumeration });
  scanned += enumeration.byMode.code.cost.scannedMetadata; returned += hits.length;
  const page = buildFilterPagination(enumeration, { code: hits });
  assert.ok(page.cost.byMode.code.cacheBytes <= 64 * 1024 * 1024);
  assert.equal(page.total, meta.length); cursor = page.nextCursor;
} while (cursor);
assert.equal(scanned, meta.length, 'one compiled matching scan serves all warm pages');
assert.equal(returned, meta.length);
let heartbeat = false;
const heartbeatTimer = setTimeout(() => { heartbeat = true; }, 0);
const signal = AbortSignal.timeout(1);
const slow = Array.from({ length: 10000 }, (_, id) => ({ id, kind: 'FunctionDeclaration' }));
Object.defineProperty(slow, 1, { get() {
  const until = performance.now() + 12; while (performance.now() < until) {}
  return { id: 1, kind: 'FunctionDeclaration' };
} });
const started = performance.now();
await assert.rejects(enumerateFilterMatches({ meta: slow, match: createChunkFilterPredicate(filters), mode: 'code', topN: 1,
  enumeration: createFilterEnumeration({ filters, generation: { id: 'cancel' }, modes: ['code'] }),
  throwIfAborted: () => signal.throwIfAborted() }), { name: 'TimeoutError' });
clearTimeout(heartbeatTimer);
const cancellationMs = performance.now() - started;
assert.equal(heartbeat, true, 'a timer heartbeat runs while enumeration is active');
assert.ok(cancellationMs < 250, 'timer cancellation is observed within the declared 250ms fixture allowance');
console.log(JSON.stringify({ contract: 'async-filter-checkpoints', cancellationMs, cancellationBudgetMs: 250, heartbeat,
  warmAllPageScans: scanned, rows: meta.length, additionalCacheMaxBytes: 64 * 1024 * 1024,
  qualification: 'memory-predicate-only; cold process and native backend receipts are separate' }));

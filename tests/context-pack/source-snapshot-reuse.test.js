import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createExcerptSourceContext, prefetchFileRanges, resolveExcerpt } from '../../src/context-pack/excerpt-cache.js';
import { hydrateRiskCallSiteDetails } from '../../src/context-pack/assemble/call-sites.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'excerpt-source-snapshot-'));
const file = path.join(root, 'source.js');
const text = 'a'.repeat(4 * 1024 * 1024);
const hash = createHash('sha1').update(text).digest('hex');
const originalRead = fs.readSync;
let bytesRead = 0;
try {
  fs.writeFileSync(file, text);
  const rows = Array.from({ length: 20 }, (_, index) => ({ file: 'source.js',
    callSiteId: 'call-' + index, start: index * 16, end: index * 16 + 16, fileHash: hash }));
  const context = createExcerptSourceContext();
  fs.readSync = (...args) => { const bytes = originalRead(...args); bytesRead += bytes; return bytes; };
  prefetchFileRanges(rows.map(row => ({ filePath: file, start: row.start, end: row.end })), 'generation', root, context);
  for (const row of rows) {
    const hydrated = hydrateRiskCallSiteDetails({ row, repoRoot: root, indexSignature: 'generation', sourceContext: context });
    assert.equal(hydrated.details.excerpt, 'a'.repeat(16));
  }
  assert.equal(bytesRead, text.length, 'one assembly reads and hashes a source once for all ranges');
  context.clear();
  assert.throws(() => resolveExcerpt({ filePath: file, repoRoot: root, sourceContext: context }), /has ended/);

  fs.writeFileSync(file, 'b'.repeat(text.length));
  const fresh = createExcerptSourceContext();
  const updated = resolveExcerpt({ filePath: file, repoRoot: root, sourceContext: fresh,
    indexSignature: 'generation', indexedHash: hash, start: 0, end: 16 });
  assert.equal(updated.excerpt, 'b'.repeat(16));
  assert.equal(updated.sourceIdentity.drift, 'changed', 'a new assembly verifies current bytes despite the same generation');
  fresh.clear();

  const small = path.join(root, 'small.js'), other = path.join(root, 'other.js');
  fs.writeFileSync(small, 'abc'); fs.writeFileSync(other, 'def');
  const bounded = createExcerptSourceContext({ maxBytes: 3 });
  bytesRead = 0;
  for (const filePath of [small, other, small]) resolveExcerpt({ filePath, repoRoot: root,
    start: 0, end: 3, sourceContext: bounded });
  assert.equal(bytesRead, 9, 'bounded source ownership evicts rather than retaining both files');
  bounded.clear();
  assert.throws(() => createExcerptSourceContext({ maxBytes: -1 }), TypeError);
  console.log('Request-scoped excerpt snapshots share verified reads and expire with bounded ownership.');
} finally {
  fs.readSync = originalRead;
  fs.rmSync(root, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerToolingProvider, TOOLING_PROVIDERS } from '../../../src/index/tooling/provider-registry.js';
import { createLspProviderTempRepo } from '../../helpers/lsp-provider-fixture.js';

// Authored actual replay-consumer regression; deferred to lead validation.
const saved = new Map(TOOLING_PROVIDERS);
const root = await createLspProviderTempRepo({ name: 'provider-cache-source-bytes' });
const chunkUid = 'ck64:v1:test:provider-cache-source-bytes';
const base = { virtualPath: 'source.fixture', containerPath: 'source.fixture', text: 'first',
  docHash: 'same-caller-asserted-hash', languageId: 'fixture', effectiveExt: '.fixture' };
const request = document => ({ documents: [document], kinds: ['types'], targets: [{ virtualPath: document.virtualPath,
  languageId: document.languageId, chunkRef: { chunkUid, chunkId: 'source-bytes', file: document.containerPath,
    segmentUid: document.segmentUid || null, range: { start: 0, end: 5 } } }] });
const ctx = { repoRoot: root, buildRoot: root, toolingConfig: { enabledTools: ['source-bytes-fixture'] },
  cache: { enabled: true, dir: path.join(root, 'cache') } };
let calls = 0;
try {
  TOOLING_PROVIDERS.clear();
  registerToolingProvider({ id: 'source-bytes-fixture', version: '1.0.0', priority: 1,
    languages: ['fixture', 'fixture-other'], kinds: ['types'],
    capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
    getConfigHash: () => 'unchanged-config', async run(_ctx, inputs) {
      calls += 1;
      return { byChunkUid: { [chunkUid]: { payload: { returnType: inputs.documents[0].text === 'first' ? 'First' : 'Second' } } } };
    } });
  assert.equal((await runToolingProviders(ctx, request(base))).byChunkUid.get(chunkUid).payload.returnType, 'First');
  await runToolingProviders(ctx, request(base));
  assert.equal(calls, 1, 'control proves a real persisted cache hit');
  const files = await fs.readdir(ctx.cache.dir);
  assert.ok(files.some(file => file.includes('tooling-provider_lk5_')));
  const edited = { ...base, text: 'other' };
  assert.equal((await runToolingProviders(ctx, request(edited))).byChunkUid.get(chunkUid).payload.returnType, 'Second');
  assert.equal(calls, 2, 'claimed docHash cannot hide different actual source bytes');
  await runToolingProviders(ctx, request({ ...edited, languageId: 'fixture-other' }));
  assert.equal(calls, 3, 'language interpretation is part of replay identity');
  await runToolingProviders(ctx, request({ ...edited, containerPath: 'template.fixture', segmentUid: 'segment-2',
    segmentStart: 10, segmentEnd: 15, lineStart: 1, lineEnd: 1 }));
  assert.equal(calls, 4, 'different source mapping cannot reuse a prior projection');
  const unknown = { ...base }; delete unknown.text;
  await runToolingProviders(ctx, request(unknown));
  await runToolingProviders(ctx, request(unknown));
  assert.equal(calls, 6, 'unavailable source bytes retain live execution without durable replay');
} finally {
  TOOLING_PROVIDERS.clear();
  for (const [id, provider] of saved) TOOLING_PROVIDERS.set(id, provider);
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Provider replay retains source bytes, language and source mapping rather than trusting a claimed document hash');

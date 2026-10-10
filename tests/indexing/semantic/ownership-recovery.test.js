#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { collectFileSemanticFacts } from '../../../src/index/semantic/collect-file.js';
import { collectSemanticOwnership } from '../../../src/index/semantic/ownership.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { parseJavaScriptAst } from '../../../src/lang/javascript/parse.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';

const fixture = await createRecoveryFixture('export const value = f(1);');
try {
  const policy = normalizeSemanticConfig({ enabled: true, storage: { batchRows: 2 } });
  const facts = await collectFileSemanticFacts({
    bytes: fixture.bytes, text: fixture.bytes.toString(), ast: parseJavaScriptAst(fixture.bytes.toString()),
    language: 'javascript', relPath: 'original.js', repositoryNamespace: fixture.root,
    stagingRoot: fixture.stagingRoot, diskAccount: fixture.account, policy
  });
  const options = { facts, bytes: fixture.bytes, repositoryNamespace: fixture.root,
    stagingRoot: fixture.stagingRoot, diskAccount: fixture.account, policy,
    storage: { generation: fixture.generation, relativePath: 'semantic' } };
  const retained = fixture.account.used;
  const directories = await fixture.partDirectories();
  const before = new AbortController();
  before.abort();
  await assert.rejects(collectSemanticOwnership({ ...options, chunks: [], signal: before.signal }),
    { name: 'AbortError' });
  assert.equal(fixture.account.used, retained);
  assert.deepEqual(await fixture.partDirectories(), directories);
  const during = new AbortController();
  await assert.rejects(collectSemanticOwnership({ ...options,
    chunks: [{ start: 0, end: fixture.source.textLength, chunkUid: 'fixture-chunk' }],
    signal: during.signal, scheduleIo: async (fn) => { await fn(); during.abort(); }
  }), { name: 'AbortError' });
  assert.equal(fixture.account.used, retained, 'cancelled ownership only releases its own flushed parts');
  assert.deepEqual(await fixture.partDirectories(), directories, 'syntax part survives failed ownership');
  await validateSemanticPartitions({ store: fixture.store([facts.partition]), partitions: [facts.partition] });

  const noChunks = await collectSemanticOwnership({ ...options, chunks: [] });
  const ownership = noChunks.partitions.find(partition => partition.partitionId.startsWith('sa1:'));
  assert.ok(ownership);
  assert.equal(ownership.members.semantic_ownership.length, 0);
  await validateSemanticPartitions({ store: fixture.store(noChunks.partitions), partitions: noChunks.partitions });
  assert.deepEqual(await fs.readFile(fixture.original), fixture.bytes);
  console.log('semantic ownership cancellation isolation and zero-chunk source facts passed');
} finally { await fixture.cleanup(); }

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { enqueueSemanticArtifacts } from '../../../src/index/build/artifacts/writers/semantic/family.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';

const fixture = await createRecoveryFixture('/* preserved published source */ f(1);');
try {
  const repoCacheRoot = getRepoCacheRoot(fixture.root, {});
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const priorRoot = path.join(buildsRoot, 'prior');
  await seedPublishedArtifacts({ buildRoot: priorRoot, buildId: 'prior' });
  await promoteBuild({ repoRoot: fixture.root, userConfig: {}, buildId: 'prior',
    buildRoot: priorRoot, stage: 'stage2', modes: ['code'] });
  const currentPath = path.join(buildsRoot, 'current.json');
  const priorPointer = await fs.readFile(currentPath);
  const previous = await fixture.write();
  const priorSemanticRoot = path.join(priorRoot, 'index-code', 'semantic');
  await fs.cp(fixture.stagingRoot, priorSemanticRoot, { recursive: true });
  const priorStore = fixture.store([previous], { root: priorSemanticRoot,
    generation: { baseBuildId: 'prior', semanticRevision: 0 } });
  const previousRow = await priorStore.getRecords([{ partitionId: previous.partitionId, localId: 0 }]);
  const nextRoot = path.join(buildsRoot, 'failed-next');
  const outDir = path.join(nextRoot, 'index-code');
  await fs.mkdir(path.join(outDir, 'semantic'), { recursive: true });
  await fs.cp(fixture.stagingRoot, path.join(outDir, 'semantic'), { recursive: true });
  const ref = createSemanticFactsRef({ source: fixture.source, partitions: [previous],
    syntaxPartitionId: previous.partitionId,
    storage: { generation: { baseBuildId: 'failed-next', semanticRevision: 0 }, relativePath: 'semantic' },
    coverage: [] });
  let registered = 0;
  const queue = [];
  const enqueue = (signal) => enqueueSemanticArtifacts({
    state: { semanticFactsByFile: new Map([['original.js', ref]]) }, root: fixture.root,
    outDir, indexState: { buildId: 'failed-next' }, enabled: true, signal,
    enqueueWrite: (_label, fn) => queue.push(fn), addPieceFile: () => { registered += 1; },
    declareArtifactFamily: () => {}
  });
  const dataPath = path.join(outDir, 'semantic', previous.members.semantic_records[0].path);
  await fs.appendFile(dataPath, ' ');
  enqueue();
  await assert.rejects(queue.shift()(), { code: 'ERR_SEMANTIC_INTEGRITY' });
  assert.equal(registered, 0, 'failed family reconciliation cannot register incomplete artifacts');
  await assert.rejects(fs.access(path.join(outDir, 'semantic_manifest.json')), { code: 'ENOENT' });
  await assert.rejects(promoteBuild({ repoRoot: fixture.root, userConfig: {}, buildId: 'failed-next',
    buildRoot: nextRoot, stage: 'stage2', modes: ['code'] }), /missing publication record/);
  assert.deepEqual(await fs.readFile(currentPath), priorPointer, 'failed publication preserves exact previous pointer');

  await fs.copyFile(path.join(fixture.stagingRoot, previous.members.semantic_records[0].path), dataPath);
  const sourcePath = path.join(outDir, 'semantic', 'semantic-sources', fixture.source.byteHash + '.utf8');
  const editedSource = Buffer.from(fixture.bytes);
  editedSource[0] = 'X'.charCodeAt(0);
  await fs.writeFile(sourcePath, editedSource);
  enqueue();
  await assert.rejects(queue.shift()(), /source.*(hash|identity|mismatch)|integrity/i,
    'source byte hashes must reconcile before publishing any family metadata');
  assert.equal(registered, 0);
  await assert.rejects(fs.access(path.join(outDir, 'semantic_manifest.json')), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(currentPath), priorPointer);

  const cancel = new AbortController();
  cancel.abort();
  enqueue(cancel.signal);
  await assert.rejects(queue.shift()(), { name: 'AbortError' });
  assert.equal(registered, 0);
  assert.deepEqual(await fs.readFile(currentPath), priorPointer);
  assert.deepEqual(await priorStore.getRecords([{ partitionId: previous.partitionId, localId: 0 }]), previousRow);
  assert.equal((await priorStore.getSourceSpans([{ partitionId: previous.partitionId, localId: 0 }]))[0].text,
    fixture.bytes.toString());
  assert.deepEqual(await fs.readFile(fixture.original), fixture.bytes);
  console.log('semantic failed family publication preserves prior pointer, rows and originals');
} finally { await fixture.cleanup(); }

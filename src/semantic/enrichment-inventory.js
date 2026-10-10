import { assertCompilerTaskAuthority } from '../index/semantic/compiler-dependencies.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openPublishedSemanticStore } from './published-store.js';
import { resolveSemanticGenerationIndexDir } from './generation.js';
import { resolveSemanticPartPath } from './artifact-store.js';
import { getBuildsRoot, getRepoCacheRoot } from '../shared/dict-utils.js';
import { assertCurrentIndexFormat } from '../contracts/index-format.js';
import { assertSemanticTask } from '../contracts/validators/semantic-task.js';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import { validateSemanticPartitions } from '../index/semantic/reconcile.js';
import { checksumFile } from '../shared/hash.js';
import { loadPiecesManifest } from '../shared/artifact-io/manifest-read.js';
import { isWithinRoot, toRealPathSync } from '../workspace/identity.js';
import { throwIfAborted } from '../shared/abort.js';

export const enrichmentError = (message, code = 'ERR_SEMANTIC_ENRICHMENT_STALE') => Object.assign(new Error(message), { code });
export const enrichmentSame = (a, b) => canonicalSemanticJson(a) === canonicalSemanticJson(b);
export const enrichmentByteHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const createEnrichmentBudget = (maxMs, signal) => {
  const deadline = AbortSignal.timeout(maxMs), combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const check = () => {
    throwIfAborted(signal);
    if (deadline.aborted) throw enrichmentError('Semantic enrichment allowance exhausted.', 'ERR_SEMANTIC_ENRICHMENT_BUDGET');
  };
  return { signal: combined, check, async run(fn) { try { return await fn(); } catch (error) { check(); throw error; } } };
};
export const readEnrichmentCurrent = async ({ repoRoot, userConfig }) => {
  const filename = path.join(getBuildsRoot(repoRoot, userConfig), 'current.json');
  if ((await fs.stat(filename)).size > 512 * 1024) throw enrichmentError('Current pointer exceeds its allowance.');
  const bytes = await fs.readFile(filename), pointer = JSON.parse(bytes.toString('utf8'));
  assertCurrentIndexFormat({ operation: 'semantic_enrichment', component: 'build pointer',
    foundVersion: pointer.artifactSurfaceVersion, repoRoot, indexPath: filename });
  const relative = pointer.buildRootsByMode?.code || (pointer.modes?.includes('code') ? pointer.buildRoot : null);
  if (!relative) throw enrichmentError('Current code generation is unavailable.', 'ERR_SEMANTIC_UNAVAILABLE');
  const cacheRoot = toRealPathSync(getRepoCacheRoot(repoRoot, userConfig)), buildRoot = toRealPathSync(path.resolve(cacheRoot, relative));
  if (!isWithinRoot(buildRoot, cacheRoot)) throw enrichmentError('Current code root escapes its repository cache.');
  return { pointer, hash: enrichmentByteHash(bytes), buildRoot };
};

export const openEnrichmentInventory = async ({ repoRoot, userConfig, generation, budget, indexDir = null }) => {
  budget.check();
  indexDir ||= await resolveSemanticGenerationIndexDir({ repoRoot, generation, userConfig });
  const { store, manifest } = await budget.run(() => openPublishedSemanticStore({ indexDir, repoRoot, generation }));
  const syntax = manifest.partitions.filter(partition => partition.partitionId.startsWith('sy1:'));
  const sources = new Map(), tasks = new Map();
  for (const partition of syntax) {
    for await (const source of store.iterateRows(partition.partitionId, 'semantic_sources', { signal: budget.signal })) {
      budget.check();
      if (sources.size >= 100000 || sources.has(source.sourceUnitId)) throw enrichmentError('Source inventory is duplicate or exceeds its descriptor allowance.');
      sources.set(source.sourceUnitId, source);
    }
  }
  for (const partition of manifest.partitions) {
    for await (const task of store.iterateRows(partition.partitionId, 'semantic_frontier', { signal: budget.signal })) {
      budget.check(); assertSemanticTask(task);
      if (task.baseBuildId !== generation.baseBuildId) throw enrichmentError('Frontier belongs to another base generation.');
      if (tasks.size >= 4096) throw enrichmentError('Frontier descriptor scan exceeds its allowance.', 'ERR_SEMANTIC_ENRICHMENT_BUDGET');
      const previous = tasks.get(task.taskId);
      if (previous && !enrichmentSame(previous, task)) throw enrichmentError('Conflicting immutable frontier task.');
      tasks.set(task.taskId, task);
    }
  }
  const manifestHash = enrichmentByteHash(await fs.readFile(path.join(indexDir, 'semantic_manifest.json')));
  return { indexDir, store, manifest, manifestHash, syntax, sources, tasks };
};

export const verifyEnrichmentTask = async ({ inventory, task, budget, deep = false }) => {
  budget.check();
  if (task.targetsRef !== 'semantic-frontier-targets/' + task.targetSetHash + '.json') throw enrichmentError('Task target reference is not content-addressed.');
  const root = path.join(inventory.indexDir, 'semantic');
  const filename = await resolveSemanticPartPath(root, task.targetsRef);
  if ((await fs.stat(filename)).size > 32 * 1024 * 1024) throw enrichmentError('Target set exceeds its metadata allowance.');
  const bytes = await fs.readFile(filename), target = JSON.parse(bytes.toString('utf8'));
  const registered = inventory.manifest.frontierTargets?.find(row => row.path === task.targetsRef);
  const checksum = await checksumFile(filename);
  const pieces = loadPiecesManifest(inventory.indexDir, { repoRoot: inventory.store.repoRoot });
  if (!registered || registered.hash !== enrichmentByteHash(bytes) || registered.bytes !== bytes.length
    || !pieces.pieces.some(piece => piece.name === 'semantic_frontier_targets' && piece.path === 'semantic/' + task.targetsRef
      && piece.checksum === checksum.algo + ':' + checksum.value)) throw enrichmentError('Task target inventory is not registered and verified.');
  if (Object.keys(target).filter(key => key !== 'compilerInventory').sort().join(',') !== 'generation,schemaVersion,sourceUnits,syntaxPartitionRefs'
    || target.schemaVersion !== 1 || !enrichmentSame(target.generation, inventory.manifest.generation)
    || semanticHash('pairofcleats.semantic.binding-targets.v1', target) !== task.targetSetHash
    || !enrichmentSame(target.sourceUnits, [...task.sourceUnits].sort())
    || !Array.isArray(target.syntaxPartitionRefs) || target.syntaxPartitionRefs.length !== task.sourceUnits.length) throw enrichmentError('Task targets do not match its frozen generation and source units.');
  assertCompilerTaskAuthority(task, target);
  const selected = [];
  for (const ref of target.syntaxPartitionRefs) {
    const partition = inventory.syntax.find(row => row.partitionId === ref.partitionId && row.sourceUnitId === ref.sourceUnitId && row.canonicalHash === ref.canonicalHash);
    if (Object.keys(ref).sort().join(',') !== 'canonicalHash,partitionId,sourceUnitId' || !partition
      || !task.sourceUnits.includes(ref.sourceUnitId) || !task.inputHashes.includes(ref.canonicalHash)) throw enrichmentError('Task input hash or source partition is stale.');
    selected.push(partition);
  }
  if (new Set(target.syntaxPartitionRefs.map(row => row.sourceUnitId)).size !== task.sourceUnits.length
    || !enrichmentSame([...new Set(selected.map(row => row.canonicalHash))].sort(), [...task.inputHashes].sort())) throw enrichmentError('Task input inventory is incomplete.');
  if (deep) await budget.run(() => validateSemanticPartitions({ store: inventory.store, partitions: selected, signal: budget.signal }));
  return target;
};

/** Exact original-byte check; embedded units are authorized only through their retained parent snapshot. */
export const verifyEnrichmentLiveSources = async ({ repoRoot, inventory, budget }) => {
  const checked = new Map(), root = toRealPathSync(repoRoot), buffer = Buffer.alloc(64 * 1024);
  for (const source of inventory.sources.values()) {
    budget.check();
    await budget.run(() => inventory.store.verifySource(source, { signal: budget.signal }));
    if (source.mapping) {
      if (!inventory.sources.has(source.mapping.parentSourceUnitId)) throw enrichmentError('Embedded task source has no retained parent authority.');
      continue;
    }
    const filename = toRealPathSync(path.resolve(root, source.path));
    if (!isWithinRoot(filename, root)) throw enrichmentError('Task source escapes its repository authority.');
    if (checked.has(filename)) {
      if (checked.get(filename) !== source.byteHash) throw enrichmentError('Original source path has conflicting immutable snapshots.');
      continue;
    }
    checked.set(filename, source.byteHash);
    const handle = await fs.open(filename, 'r'), hash = createHash('sha256');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== source.byteLength) throw enrichmentError('Original source size changed.');
      let bytes = 0;
      for (;;) {
        budget.check(); const read = await handle.read(buffer, 0, buffer.length, null);
        if (!read.bytesRead) break;
        bytes += read.bytesRead; if (bytes > source.byteLength) throw enrichmentError('Original source changed while checking.');
        hash.update(buffer.subarray(0, read.bytesRead));
      }
      if (bytes !== source.byteLength || hash.digest('hex') !== source.byteHash) throw enrichmentError('Original source bytes changed; task cannot be retargeted.');
    } finally { await handle.close(); }
  }
};

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openPublishedSemanticStore } from '../../semantic/published-store.js';
import { readEnrichmentCurrent } from '../../semantic/enrichment-inventory.js';
import { resolveSemanticPartPath, createArtifactSemanticStore } from '../../semantic/artifact-store.js';
import { persistSemanticEvidence } from './lsp-evidence.js';
import { createAnalysisPartitionId, semanticHash } from './identity.js';
import { createSemanticFactsRef } from './file-ref.js';
import { writeSemanticAnalysis } from './analysis-write.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';

/** Only registered, checksum-verified current-generation receipts can inform later admission. */
export const loadCompilerAdmissionReceipts = async runtime => {
  try {
    const current = await readEnrichmentCurrent({ repoRoot: runtime.root, userConfig: runtime.userConfig });
    const indexDir = path.join(current.buildRoot, 'index-code');
    const { manifest } = await openPublishedSemanticStore({ indexDir, repoRoot: runtime.root });
    const result = [];
    for (const item of (manifest.compilerAdmissions || []).slice(-64)) {
      if (!item.receiptRef) continue;
      const descriptor = manifest.evidenceArtifacts.find(row => row.path === item.receiptRef);
      if (!descriptor || descriptor.bytes > 1048576) continue;
      const file = await resolveSemanticPartPath(path.join(indexDir, 'semantic'), descriptor.path);
      const bytes = await fs.readFile(file);
      if (bytes.length !== descriptor.bytes || createHash('sha256').update(bytes).digest('hex') !== descriptor.hash) continue;
      result.push(JSON.parse(bytes.toString('utf8')));
    }
    return result;
  } catch (error) {
    // Prior telemetry is optional. It never makes an incompatible index readable.
    runtime.log?.('[semantic] compiler measurement unavailable: ' + (error.code || 'unavailable'));
    return [];
  }
};

export const persistCompilerAdmission = async ({ state, selected, decision, receipt = null, signal = null }) => {
  const first = selected[0];
  state.semanticEvidenceArtifacts ||= [];
  const write = value => persistSemanticEvidence({ value, stagingRoot: first.root, diskAccount: state.semanticDiskAccount,
    inventory: state.semanticEvidenceArtifacts, signal });
  const decisionRef = await write(decision), receiptRef = receipt ? await write(receipt) : null;
  state.semanticCompilerAdmissions ||= [];
  state.semanticCompilerAdmissions.push({ taskIds: selected.map(item => item.task.taskId).sort(), decisionRef, receiptRef });
  return decisionRef;
};

/** Admission refusal is durable phase coverage; immutable input facts remain selected. */
export const persistCompilerAdmissionDeferral = async ({ state, runtime, selected, decision, signal }) => {
  await persistCompilerAdmission({ state, selected, decision, signal });
  for (const item of selected) for (const [file, current] of state.semanticFactsByFile) {
    if (!item.task.sourceUnits.includes(current.sourceUnitId)) continue;
    const store = createArtifactSemanticStore({ root: item.root, repoRoot: runtime.root, generation: item.generation,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, partitions: current.partitions });
    let source;
    for await (const row of store.iterateRows(current.syntaxPartitionId, 'semantic_sources', { signal })) source = row;
    const partitionId = createAnalysisPartitionId({ pass: { name: 'compiler-admission', version: '1' },
      inputPartitionHashes: item.task.inputHashes, compilerContext: null, dependencySummaryHashes: [],
      analysisPolicy: { taskId: item.task.taskId, decisionHash: semanticHash('semantic.compiler-admission-decision.v1', decision) } });
    const coverage = { scope: { sourceUnitId: source.sourceUnitId }, phase: item.phase, state: 'deferred',
      reason: decision.reason, observedCount: null, completedCount: 0, frontierRef: item.task.taskId };
    const partition = await writeSemanticAnalysis({ policy: item.policy, stagingRoot: item.root, source,
      sourceBytes: await fs.readFile(path.join(item.root, 'semantic-sources', source.byteHash + '.utf8')), partitionId,
      producerHash: semanticHash('semantic.compiler-admission-producer.v1', { version: 1 }), policyHash: decision.policyHash,
      diskAccount: state.semanticDiskAccount, signal, rows: [{ family: 'coverage', row: coverage }] });
    state.semanticFactsByFile.set(file, createSemanticFactsRef({ source, storage: current.storage,
      syntaxPartitionId: current.syntaxPartitionId, partitions: [...current.partitions, partition], coverage: [...current.coverage, coverage] }));
  }
};

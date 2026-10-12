import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { createArtifactSemanticStore } from '../../semantic/artifact-store.js';
import { getToolingConfig } from '../../shared/dict-utils.js';
import { schedulerAdmissionReason, normalizeCompilerAdmissionPolicy } from './compiler-admission.js';
import { persistCompilerAdmissionDeferral } from './compiler-admission-evidence.js';
import { semanticHash } from './identity.js';
import { verifyNativeTaskAuthority, nativeTaskInventoryHash } from './native-task-authority.js';
import { enterNativeExecution } from './native-execution-context.js';
import { runNativeSemanticProviders } from './native-provider-pass.js';

/** Actual clangd uses the existing relations scheduler and durable attempt
 * lifecycle. It never receives a TypeScript Program capability.
 */
export const prepareNativeTaskExecution = async ({ state, runtime, selected }) => {
  const snapshot = runtime.scheduler.stats(), item = selected[0];
  const policy = normalizeCompilerAdmissionPolicy(item?.policy.execution.compilerAdmission), bytes = policy.maxResidentBytes;
  const unit = (snapshot.adaptive?.memoryPerTokenMb ?? runtime.schedulerConfig?.adaptiveMemoryPerTokenMb
    ?? runtime.schedulerConfig?.memoryPerTokenMb) * 1024 * 1024;
  const validUnit = Number.isSafeInteger(unit) && unit > 0;
  const request = { cpu: 1, io: 1, mem: validUnit ? Math.max(1, Math.ceil(bytes / unit)) : 1, bytes };
  const inventory = item?.nativeInventory, authorityHash = inventory ? nativeTaskInventoryHash(inventory) : null;
  const sourceBytes = inventory?.files.reduce((sum, row) => sum + row.bytes, 0);
  const reason = selected.length !== 1 ? 'native_single_project_batch_required'
    : !inventory ? 'native_closure_authority_unavailable'
      : item.policy.enrichment.bindings === 'auto' && !runtime.semanticEnrichmentDrain ? 'native_process_cost_measurement_unavailable'
        : inventory.files.length > policy.maxFiles ? 'native_project_files_exceeded'
          : sourceBytes > policy.maxBytes ? 'native_project_bytes_exceeded'
            : bytes < 256 * 1024 * 1024 ? 'native_resident_reservation_exceeded'
              : sourceBytes > bytes ? 'native_input_exceeds_reservation'
                : !Number.isSafeInteger(unit) || unit < 1 ? 'scheduler_memory_token_unit_unavailable' : schedulerAdmissionReason(request, snapshot);
  const decision = { schemaVersion: 1, admitted: !reason, reason, request, inputHash: authorityHash,
    policyHash: semanticHash('semantic.native.admission-policy.v1', policy),
    reservation: { bytes, basis: 'explicit-policy-ceiling', memoryTokenBytes: validUnit ? unit : null },
    limitations: ['Native child-process cost is unmeasured; scheduler reservation is policy admission, not a hard memory limit.'] };
  let dispose = null;
  return { decision,
    enter() {
      const current = runtime.scheduler.stats();
      const currentUnit = (current.adaptive?.memoryPerTokenMb ?? runtime.schedulerConfig?.adaptiveMemoryPerTokenMb
        ?? runtime.schedulerConfig?.memoryPerTokenMb) * 1024 * 1024;
      const reason = currentUnit !== unit ? 'scheduler_memory_token_unit_changed' : schedulerAdmissionReason(request, current);
      if (reason) throw Object.assign(new Error(reason), { code: 'ERR_SEMANTIC_COMPILER_ADMISSION', reason });
      dispose = enterNativeExecution(state, { authorityHash,
        sourceUnits: new Set(item.task.sourceUnits), launch: item.nativeInventory.launch });
    },
    async verify(signal) {
      for (const item of selected) {
        const store = createArtifactSemanticStore({ root: item.root, repoRoot: runtime.root,
          artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: item.generation, partitions: item.syntaxPartitions });
        await verifyNativeTaskAuthority({ task: item.task, target: item.targetSet, repoRoot: runtime.root,
          toolingConfig: getToolingConfig(runtime.root), sources: new Map([...item.sources.values()].map(source => [source.sourceUnitId, source])), store, signal });
      }
    },
    defer: (decision, signal) => persistCompilerAdmissionDeferral({ state, runtime, selected, decision, signal }),
    dispose() { dispose?.(); }
  };
};
export const executeNativeTask = async ({ state, runtime, signal }) => {
  const result = await runNativeSemanticProviders({ state, runtime, toolingConfig: getToolingConfig(runtime.root),
    log: runtime.log || (() => {}), signal });
  return result.output || { schemaVersion: 1, contexts: [], partitions: [], coverageRef: null, diagnosticsRef: null };
};

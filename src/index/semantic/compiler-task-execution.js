import { planCompilerAdmission, assertCompilerAdmissionStart, makeCompilerAdmissionReceipt, normalizeCompilerAdmissionPolicy } from './compiler-admission.js';
import { loadCompilerAdmissionReceipts, persistCompilerAdmission, persistCompilerAdmissionDeferral } from './compiler-admission-evidence.js';
import { semanticHash } from './identity.js';
import { getToolingConfig } from '../../shared/dict-utils.js';
import { compilerInventoryHash, verifyCompilerDependencyInventory } from './compiler-dependencies.js';

/** Compiler-specific authority and admission; lease/publication lifecycle is shared. */
export const prepareCompilerTaskExecution = async ({state,runtime,selected}) => {
  const authorities = new Map(selected.map(item => [compilerInventoryHash(item.compilerInventory), item.compilerInventory]));
  if (authorities.size !== 1) throw new Error('Compiler batch requires one complete shared closure authority.');
  const inventory = [...authorities.values()][0], phases = selected.map(item => item.task.kind);
  const policies = selected.map(item => normalizeCompilerAdmissionPolicy(item.policy.execution.compilerAdmission));
  const admissionPolicy = Object.fromEntries(Object.keys(policies[0]).map(key => [key,
    key === 'measurementHeadroom' ? Math.max(...policies.map(policy => policy[key])) : Math.min(...policies.map(policy => policy[key]))]));
  const providerConfig = getToolingConfig(runtime.root)?.typescript || {};
  if (Number.isFinite(providerConfig.maxProgramFiles)) admissionPolicy.maxFiles = Math.min(admissionPolicy.maxFiles, Math.max(1, providerConfig.maxProgramFiles));
  const runtimeHash = semanticHash('semantic.compiler-admission-runtime.v1', { node: process.version, v8: process.versions.v8,
    platform: process.platform, arch: process.arch, execArgv: process.execArgv, compiler: inventory.compilerReceipt,
    analyses: [...new Set(selected.map(item => item.policy.identity.analysis))].sort() });
  const receipts = await loadCompilerAdmissionReceipts(runtime);
  const admissionOptions = { inventory, policy: admissionPolicy, schedulerStats: runtime.scheduler.stats(), schedulerConfig: runtime.schedulerConfig,
    runtimeHash, phases, explicit: Boolean(runtime.semanticEnrichmentDrain) || selected.some(item => item.policy.enrichment[item.phase] === 'eager'),
    inlineBudgetMs: Math.min(...selected.map(item => item.policy.planning.inlineBudgetMs)) };
  let decision = planCompilerAdmission(admissionOptions);
  for (const receipt of receipts.slice().reverse()) {
    const measured = planCompilerAdmission({ ...admissionOptions, receipt });
    if (measured.measurement.usable) { decision = measured; break; }
  }
  if (Number.isFinite(providerConfig.maxFileBytes) && inventory.closure.maxFileBytes > providerConfig.maxFileBytes) {
    decision = { ...decision, admitted: false, reason: 'compiler_closure_file_bytes_exceeded' };
  }
  return { decision,
    verify: signal => verifyCompilerDependencyInventory({inventory,repoRoot:runtime.root,toolingConfig:getToolingConfig(runtime.root),signal}),
    enter() {
      assertCompilerAdmissionStart(decision,runtime.scheduler.stats(),runtime.schedulerConfig);
      state.semanticCompilerDependencyInventories=[...authorities.values()];
      state.semanticCompilerAdmissionGrant={authorityHash:compilerInventoryHash(inventory),decision};
    },
    defer: (decision,signal) => persistCompilerAdmissionDeferral({state,runtime,selected,decision,signal}),
    complete: (elapsedMs,signal) => persistCompilerAdmission({state,selected,decision,signal,receipt:makeCompilerAdmissionReceipt({decision,runtimeHash,elapsedMs,peakRssBytes:process.resourceUsage().maxRSS*1024,complete:true})})
  };
};

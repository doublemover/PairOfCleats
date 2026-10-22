// Source UNVALIDATED. Async actual report/install probes retain exact managed
// physical bytes until shared child close or confirmed error reconciliation.
import { retainManagedToolInstallation } from '../../src/shared/managed-installation.js';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { redactDiagnosticText } from '../../src/shared/diagnostic-text.js';
import { resolveNoProvisionToolingEnvironment, isNonZeroToolingProbeSuccess } from '../../src/index/tooling/command-resolver.js';
import { identifyProvisioningExecutable } from './provisioning-plan.js';
import { applyToolLayoutValidation, locateToolExecutable, resolveDetectArgCandidates } from './utils.js';
import { resolveToolRoot } from '../shared/dict-utils.js';

export const detectToolOwned = async (tool, { signal = null, env = process.env } = {}, dependencies = {}) => {
  signal?.throwIfAborted();
  const located = (dependencies.locate || locateToolExecutable)(tool);
  if (!located.found || !located.path) return located;
  signal?.throwIfAborted();
  let held = null, pending = null, primary = null;
  const release = () => {
    if (held && !held.release()) throw new Error('Managed probe installation lease changed before release.');
    held = null;
    return true;
  };
  try {
    if (tool.managedInstallation) held = await (dependencies.retain || retainManagedToolInstallation)({ toolingRoot: tool.toolingRoot,
      toolId: tool.id, descriptorId: tool.managedInstallation.descriptorId, installId: tool.managedInstallation.installId });
    if (held && held.receipt.installId !== tool.managedInstallation.installId) throw new Error('Managed physical tool selection changed before probe.');
    const command = held?.command || located.path;
    const prefix = held?.args || tool.managedInstallation?.args || [];
    const configured = tool.detect?.args || ['--version'];
    const configuredWithoutPrefix = prefix.every((value, index) => configured[index] === value) ? configured.slice(prefix.length) : configured;
    const candidates = resolveDetectArgCandidates({ ...tool, detect: { ...tool.detect, args: configuredWithoutPrefix } });
    const identify = dependencies.identify || identifyProvisioningExecutable;
    const identity = identify(command);
    const attempts = [];
    let selectedProbe = null;
    for (const args of candidates) {
      signal?.throwIfAborted();
      if (identify(command).sha256 !== identity.sha256) throw new Error('Selected tool command bytes changed before probe.');
      const cwd = resolveToolRoot();
      let spawned = false;
      let closeObserved = false;
      try {
        const result = await (dependencies.spawn || spawnResolvedSubprocess)(command, [...prefix, ...args], { cwd, signal,
          env: resolveNoProvisionToolingEnvironment(env, { command, providerId: tool.id, toolingRoot: tool.toolingRoot, cwd }),
          timeoutMs: 4000, outputEncoding: 'utf8', maxOutputBytes: 65536, rejectOnNonZeroExit: false,
          onSpawn: () => { spawned = true; } });
        closeObserved = true;
        signal?.throwIfAborted();
        if (identify(command).sha256 !== identity.sha256) throw new Error('Selected tool command bytes changed during probe.');
        const truncated = result.outputCapture?.stdout?.truncated || result.outputCapture?.stderr?.truncated;
        const recognized = !truncated && result.exitCode !== 0 && isNonZeroToolingProbeSuccess({ providerId: tool.id, command,
          stdout: result.stdout, stderr: result.stderr });
        const ok = !truncated && (result.exitCode === 0 || recognized);
        attempts.push({ args: [...prefix, ...args], outcome: truncated ? 'output-limit' : ok ? 'ok' : 'nonzero', status: result.exitCode,
          signal: result.signal || null, ...(ok ? {} : { stdoutExcerpt: redactDiagnosticText(result.stdout), stderrExcerpt: redactDiagnosticText(result.stderr) }) });
        if (ok) {
          selectedProbe = { ok: true, outcome: 'ok', attempts, verificationLevel: 'bounded-command-transport-and-layout',
            ...(recognized ? { acceptance: 'recognized-transport-usage' } : {}) };
          break;
        }
      } catch (error) {
        const termination = error.result?.termination;
        const settled = closeObserved || !spawned || error.cacheOwnershipReleased?.() === true
          || (termination?.closeObserved === true && termination.treeCleanupSettled === true && termination.treeCleanupFailed === false);
        if (!settled || error.cacheOwnershipPending) {
          pending = error;
          error.cacheOwnershipPending = true;
          Object.defineProperty(error, 'managedProbeSession', { configurable: true, value: {
            installId: held?.receipt.installId || null, root: held?.root || null,
            releaseAfterClosure: () => {
              if (error.cacheOwnershipReleased?.() !== true) throw new Error('Actual managed probe child/tree closure remains pending.');
              return release();
            }
          } });
          throw error;
        }
        if (signal?.aborted) throw error;
        attempts.push({ args: [...prefix, ...args], outcome: error.name === 'SubprocessTimeoutError' ? 'timeout' : error.code === 'ENOENT' ? 'missing' : 'spawn-error',
          status: error.result?.exitCode ?? null, signal: error.result?.signal || null, errorCode: error.code || null,
          stderrExcerpt: redactDiagnosticText(error.message) });
      }
    }
    const probe = (dependencies.validate || applyToolLayoutValidation)(tool, command, selectedProbe || {
      ok: false, outcome: attempts.some(attempt => attempt.outcome === 'timeout') ? 'timeout' : attempts[0]?.outcome || 'inconclusive', attempts });
    return { found: probe.ok, path: probe.ok ? command : null, source: held ? 'managed' : located.source,
      probe, executableIdentity: identity, ...(held ? { installId: held.receipt.installId, descriptorId: held.receipt.descriptorId } : {}) };
  } catch (error) { primary = error; throw error; }
  finally {
    if (!pending) {
      try { release(); }
      catch (error) { if (primary) primary.managedProbeReleaseError = error; else throw error; }
    }
  }
};

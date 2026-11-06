#!/usr/bin/env node
import { exitLikeChildResult } from './postinstall-exit.js';
import { applyPatchesAsync } from './apply-patches.js';
import { withCheckoutMutation, requireCheckoutMutationSession } from './checkout-mutation.js';
import { readErrorDataProperty } from '../../src/shared/error-data.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { withCheckoutStageJournal } from './checkout-stage-journal.js';

/** The npm lifecycle borrows the same original owner across patches and native
 * preparation. Calling the actual native implementation in-process avoids a
 * second coordinator waiting on its parent's checkout lock. Imports are inert.
 */
export const runPackagePostinstall = async ({ root = process.cwd(), signal = null, session = null,
  log = console.log, rebuild = null } = {}) => {
  let terminalFailure, terminalResult;
  try {
    return await withCheckoutMutation(root, actual => withCheckoutStageJournal(root, actual,
      { schemaVersion: 1, kind: 'package-postinstall-plan', root: actual.root,
        stages: [{ id: 'postinstall', operations: ['patches', 'native-preparation-if-patches-exist'] }] },
      async (journal, owned) => {
        const execute = async () => {
          const result = await runPackagePostinstallOwned({ root: actual.root, signal, session: actual, log, rebuild });
          if (result.exitCode !== 0 || result.signal) {
            terminalResult = result;
            terminalFailure = Object.assign(new Error('Native postinstall returned an unsuccessful terminal result.'), {
              code: 'ERR_POSTINSTALL_NATIVE_EXIT', childResult: { status: result.exitCode, signal: result.signal }
            });
            throw terminalFailure;
          }
          return result;
        };
        return owned ? journal.runStage('postinstall', execute) : execute();
      }), { signal, session, kind: 'package-postinstall' });
  } catch (error) {
    // Preserve the public terminal-result contract only after successful owner
    // retirement. Independent journal/cleanup failures remain failures.
    if (terminalFailure && error === terminalFailure) return terminalResult;
    throw error;
  }
};

const runPackagePostinstallOwned = async ({ root, signal, session: actual, log, rebuild }) => {
  root = actual.root;
  const patchCount = await applyPatchesAsync(root, { signal, session: actual, log });
  if (!patchCount) {
    log('[postinstall] no patch files found; skipping patch step.');
    return { patchCount, exitCode: 0, signal: null };
  }
  signal?.throwIfAborted(); requireCheckoutMutationSession(root, actual);
  const native = rebuild || (await import('./rebuild-native.js')).runNativeRebuild;
  const result = await native([], { root, signal, session: actual });
  signal?.throwIfAborted(); requireCheckoutMutationSession(root, actual);
  const exitCode = readErrorDataProperty(result, 'exitCode'), childSignal = readErrorDataProperty(result, 'signal');
  if (!(Number.isInteger(exitCode) && exitCode >= 0 && (childSignal == null || childSignal === '')
    || exitCode == null && typeof childSignal === 'string' && childSignal.length > 0)) throw Object.assign(
    new Error('Native postinstall did not provide an unambiguous terminal result.'), { code: 'ERR_POSTINSTALL_NATIVE_RESULT', result });
  return { patchCount, exitCode: exitCode ?? null, signal: childSignal || null };
};

if (isDirectExecution(import.meta.url)) {
  if (process.argv.length > 2) {
    process.stderr.write('Usage: node tools/setup/postinstall.js\n'); process.exitCode = 2;
  } else {
    const controller = new AbortController(), interrupt = () => controller.abort('SIGINT'), terminate = () => controller.abort('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    let terminal;
    try {
      const result = await runPackagePostinstall({ signal: controller.signal });
      terminal = { status: result.exitCode, signal: result.signal };
    } catch (error) {
      const message = readErrorDataProperty(error, 'message');
      process.stderr.write('[postinstall] ' + (typeof message === 'string' ? message : 'Package setup failed; original failure retained.') + '\n');
      const original = readErrorDataProperty(error, 'childResult');
      terminal = controller.signal.aborted ? { status: controller.signal.reason === 'SIGTERM' ? 143 : 130, signal: null }
        : original || { status: 1, signal: null };
    } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
    // Dispatch a child signal only after the original mutation owner's actual
    // retirement and removal of this entry's signal handlers.
    exitLikeChildResult(terminal);
  }
}

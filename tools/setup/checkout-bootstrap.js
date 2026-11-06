#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { CHECKOUT_BOOTSTRAP_USAGE, parseCheckoutBootstrapArguments } from './checkout-bootstrap-arguments.js';
import { readErrorDataProperty } from '../../src/shared/error-data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The canonical entry owns argument admission and exact stage ordering. Source
 * checkout preparation is always rooted at the application, never a target repo.
 * Information paths load only dependency-free metadata readers, never children.
 */
export const runCheckoutBootstrap = async (args, { root = ROOT, env = process.env, signal = null,
  inspect = null, captureInputs = null, command = null, progress = message => process.stderr.write(message + '\n') } = {}) => {
  const options = parseCheckoutBootstrapArguments(args);
  if (options.mode === 'help') return immutable({ schemaVersion: 1, kind: 'checkout-bootstrap-help', text: CHECKOUT_BOOTSTRAP_USAGE, exitCode: 0 });
  root = path.resolve(root); env = { ...env };
  const readiness = await import('../../src/shared/bootstrap-readiness.js');
  inspect ||= readiness.inspectBootstrapReadiness;
  captureInputs ||= readiness.captureBootstrapInputs;
  const inputs = captureInputs(root), diagnosis = await inspect({ root, probeNatives: false });
  const native = mode => ({ id: mode === 'verify' ? 'native-verification' : 'native-preparation', command: process.execPath,
    args: [path.join(root, 'tools/setup/rebuild-native.js'), ...(mode === 'verify' ? ['--verify'] : mode === 'repair' ? ['--repair'] : [])] });
  const stages = options.mode === 'verify' ? [native('verify')]
    : options.mode === 'repair' ? [{ id: 'patches', command: process.execPath, args: [path.join(root, 'tools/setup/apply-patches.js')] }, native('repair')]
      : options.policy === 'locked' && diagnosis.ready ? [native('verify')] : [
        { id: 'prerequisites', command: process.execPath, args: [path.join(root, 'tools/setup/preflight.js')] },
        { id: 'dependencies', command: env.npm_execpath && path.isAbsolute(env.npm_execpath) ? process.execPath : 'npm',
          args: [...(env.npm_execpath && path.isAbsolute(env.npm_execpath) ? [env.npm_execpath] : []),
            options.policy === 'locked' ? 'ci' : 'install', '--include=dev', '--ignore-scripts'] },
        { id: 'patches', command: process.execPath, args: [path.join(root, 'tools/setup/apply-patches.js')] }, native('prepare')
      ];
  const plan = immutable({ schemaVersion: 1, kind: 'checkout-bootstrap-plan', root, policy: options.policy, mode: options.mode,
    inputId: hash(inputs), inputs, runtime: { node: process.version, abi: process.versions.modules, platform: process.platform,
      arch: process.arch, executable: process.execPath, npmExecutable: env.npm_execpath || null, npmSelection: 'canonical-npm-command' },
    prerequisites: 'not-probed; existing preflight owns discovery and selected compiler capability', stages,
    readiness: diagnosis, receipt: path.join(root, readiness.BOOTSTRAP_RECEIPT), targetProvisioning: 'none',
    qualification: 'declared-stage-plan-not-executed' });
  if (['plan', 'status'].includes(options.mode)) return { ...plan, exitCode: options.mode === 'status' && !diagnosis.ready ? 1 : 0 };
  const { withCheckoutMutation, requireCheckoutMutationSession } = await import('./checkout-mutation.js');
  const { withCheckoutStageJournal } = await import('./checkout-stage-journal.js');
  const { addStorageFailureContext } = await import('../../src/shared/storage/operation-error.js');
  return withCheckoutMutation(root, session => withCheckoutStageJournal(root, session, plan, async journal => {
    const checkInputs = () => {
      requireCheckoutMutationSession(root, session);
      const selected = rows => options.policy === 'resolve' ? rows.filter(([file]) => file !== 'package-lock.json') : rows;
      if (hash(selected(captureInputs(root))) !== hash(selected(plan.inputs))) throw Object.assign(
        new Error('Checkout setup inputs changed after admission; inspect a fresh plan before mutation continues.'), { code: 'ERR_CHECKOUT_BOOTSTRAP_INPUT_CHANGED' });
    };
    const execute = async stage => {
      if (command) return command(stage.command, stage.args, { cwd: root, env, signal, stdio: 'inherit', windowsHide: true });
      if (stage.id === 'patches') {
        await (await import('./apply-patches.js')).applyPatchesAsync(root, { signal, session });
        return { ok: true, status: 0, signal: null };
      }
      if (['native-preparation', 'native-verification'].includes(stage.id)) {
        const native = await (await import('./rebuild-native.js')).runNativeRebuild(stage.args.slice(1), { root, signal, session });
        return { ok: native.exitCode === 0, status: native.exitCode, signal: null };
      }
      return (await import('./owned-command.js')).runSetupCommand(stage.command, stage.args,
        { cwd: root, env, signal, stdio: 'inherit', windowsHide: true });
    };
    const results = [];
    for (const stage of stages) {
      signal?.throwIfAborted(); checkInputs();
      progress('[bootstrap] started: ' + stage.id);
      const result = await journal.runStage(stage.id, async () => {
        const actual = await execute(stage);
        try { checkInputs(); }
        catch (error) { throw addStorageFailureContext(error, { checkoutStageResult: actual }, null, { nonEnumerable: ['checkoutStageResult'] }); }
        return actual;
      });
      results.push({ id: stage.id, ok: result.ok, status: result.status, signal: result.signal });
      if (!result.ok) throw Object.assign(new Error('Checkout bootstrap failed at ' + stage.id + '.'), {
        code: 'ERR_CHECKOUT_BOOTSTRAP_STAGE', stage: stage.id, result, plan, results
      });
      checkInputs(); progress('[bootstrap] completed: ' + stage.id);
    }
    return { schemaVersion: 1, kind: 'checkout-bootstrap-result', plan, results, exitCode: 0,
      transaction: { runId: session.runId, scope: 'application-checkout-dependency-tree' },
      qualification: 'existing-native-and-patch-verifier-owned; ordinary-entry-rechecks-readiness' };
  }), { signal });
};

if (isDirectExecution(import.meta.url)) {
  // Admission is synchronous and precedes signal handlers, metadata reads and
  // dynamic owner imports. A misspelled/help flag cannot reach npm or patches.
  let options;
  try { options = parseCheckoutBootstrapArguments(process.argv.slice(2)); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 2; }
  if (options) {
    const controller = new AbortController(), interrupt = () => controller.abort('SIGINT'), terminate = () => controller.abort('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    try {
      const result = await runCheckoutBootstrap(process.argv.slice(2), { signal: controller.signal });
      if (options.json) process.stdout.write(JSON.stringify(result) + '\n');
      else if (options.mode === 'help') process.stderr.write(result.text + '\n');
      else if (['plan', 'status'].includes(options.mode)) process.stderr.write(JSON.stringify(result, null, 2) + '\n');
      process.exitCode = result.exitCode;
    } catch (error) {
      const message = readErrorDataProperty(error, 'message'), status = readErrorDataProperty(readErrorDataProperty(error, 'result'), 'status');
      process.stderr.write((typeof message === 'string' ? message : 'Checkout bootstrap failed; original failure retained by the stage owner.') + '\n');
      process.exitCode = controller.signal.aborted ? controller.signal.reason === 'SIGTERM' ? 143 : 130
        : Number.isInteger(status) && status > 0 ? status : 1;
    } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
  }
}

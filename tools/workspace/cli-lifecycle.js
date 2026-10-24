import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';

const wantsJson = args => {
  let selected = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--no-json' || args[index] === '--json=false') selected = false;
    else if (args[index] === '--json=true') selected = true;
    else if (args[index] === '--json') selected = args[index + 1] !== 'false';
  }
  return selected;
};

/** Signal lifetime covers the actual command, including manifest publication.
 * Process-local callers use each command directly to retain thrown resources.
 */
export const reportWorkspaceCliFailure = (error, { action, rawArgs = process.argv.slice(2), signal = null, exitCode = 1 }) => {
  let failure, retained;
  try { failure = describeStorageFailure(error, { phase: `workspace-${action}-cli`, defaultCode: 'ERR_WORKSPACE_COMMAND' }); }
  catch (pending) { retained = pending; }
  const payload = { ok: false, action, state: retained ? 'settlement-pending' : signal?.aborted ? 'cancelled' : 'blocked',
    ...(failure ? { error: failure } : { nextAction: 'Wait for the actual retained resource owner to settle before retrying.' }),
    mutationPerformed: ['manifest', 'build'].includes(action) ? null : false };
  if (wantsJson(rawArgs)) console.log(JSON.stringify(payload, null, 2));
  else console.error(JSON.stringify(payload, null, 2));
  process.exitCode = exitCode;
  if (retained) Object.defineProperty(payload, 'resourceFailure', { value: retained });
  return payload;
};

export const runWorkspaceCliLifecycle = async (main, { action, rawArgs = process.argv.slice(2) }) => {
  const controller = new AbortController();
  let cancellationExitCode = null;
  const interrupt = () => { cancellationExitCode ??= 130; controller.abort(new Error('Workspace command interrupted.')); };
  const terminate = () => { cancellationExitCode ??= 143; controller.abort(new Error('Workspace command terminated.')); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try { return await main(rawArgs, { signal: controller.signal }); }
  catch (error) { return reportWorkspaceCliFailure(error, { action, rawArgs, signal: controller.signal, exitCode: cancellationExitCode || 1 }); }
  finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
    if (cancellationExitCode) process.exitCode = cancellationExitCode;
  }
};

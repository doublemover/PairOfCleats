#!/usr/bin/env node
// Dependency-free reviewed prerequisite front door; source UNVALIDATED.
import path from 'node:path';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { createWindowsPrerequisitePlan, applyWindowsPrerequisitePlan } from './windows-prerequisite-plan.js';
import { runSetupPreflight } from './preflight.js';
import { readVerifiedContainedFile } from '../../src/shared/contained-file.js';

const readInput = async (file, { signal = null } = {}) => {
  const resolved = path.resolve(file);
  return JSON.parse((await readVerifiedContainedFile(path.parse(resolved).root, resolved,
    { maxBytes: 1024 * 1024, signal })).buffer.toString('utf8'));
};

export const runPrerequisiteCli = async (args, dependencies = {}) => {
  const signal = dependencies.signal || null;
  signal?.throwIfAborted();
  const flags = new Set(['--json', '--approve-system-changes', '--accept-installer-terms']);
  const values = new Map();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (flags.has(key)) { if (values.has(key)) throw new Error('Repeated prerequisite option: ' + key); values.set(key, true); continue; }
    if (!['--plan', '--apply-plan'].includes(key) || !args[index + 1] || args[index + 1].startsWith('--') || values.has(key)) throw new Error('Usage: node tools/setup/prerequisites.js --plan request.json | --apply-plan plan.json --approve-system-changes --accept-installer-terms [--json]');
    values.set(key, args[++index]);
  }
  if (Number(values.has('--plan')) + Number(values.has('--apply-plan')) !== 1) throw new Error('Select exactly one prerequisite --plan or --apply-plan.');
  const read = dependencies.readInput || readInput;
  const input = await read(values.get('--plan') || values.get('--apply-plan'), { signal });
  signal?.throwIfAborted();
  if (values.has('--plan')) {
    if (values.has('--approve-system-changes') || values.has('--accept-installer-terms')) throw new Error('Approval flags belong only to explicit --apply-plan.');
    return (dependencies.plan || createWindowsPrerequisitePlan)(input, { signal });
  }
  return (dependencies.apply || applyWindowsPrerequisitePlan)(input, { approveSystemChanges: values.has('--approve-system-changes'),
    acceptInstallerTerms: values.has('--accept-installer-terms'), discover: runSetupPreflight, signal });
};

if (isDirectExecution(import.meta.url)) {
  const cancellation = new AbortController();
  let cancellationExitCode = null;
  const onInterrupt = () => { cancellationExitCode = 130; cancellation.abort(new Error('Prerequisite operation interrupted.')); };
  const onTerminate = () => { cancellationExitCode = 143; cancellation.abort(new Error('Prerequisite operation terminated.')); };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    const result = await runPrerequisiteCli(process.argv.slice(2), { signal: cancellation.signal });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = cancellationExitCode || (result.blockers?.length || result.state && result.state !== 'prerequisites-verified-locked-bootstrap-required' ? 1 : 0);
  } catch (error) {
    console.log(JSON.stringify({ schemaVersion: 1, kind: 'windows-prerequisite-result', state: cancellation.signal.aborted ? 'cancelled' : 'blocked',
      ...(error.prerequisiteOutcome || {}), error: { code: error.code || 'ERR_PREREQUISITE_PLAN', message: error.message },
      ...(error.prerequisiteApplySession ? { settlement: 'pending-actual-child-closure' } : {}) }));
    process.exitCode = cancellationExitCode || 1;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
}

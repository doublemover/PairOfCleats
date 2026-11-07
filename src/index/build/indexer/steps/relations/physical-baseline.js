import { advisePhysicalWorkGraph, scheduleAdvisedBaseline } from '../../../runtime/physical-work-advisor.js';
import { updateBuildState } from '../../../build-state.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../runtime/scheduler.js';
import { semanticHash } from '../../../../semantic/identity.js';

/** Actual relations work keeps its existing baseline and scheduler reservation.
 * No alternative or calibration is fabricated: absent measurements remain null.
 * This wrapper owns no extra buffers; run owns its existing resource cleanup. */
export const scheduleRelationsPhysicalBaseline = async ({ runtime, mode, stage, run,
  chunks = 0, files = 0, signal = null, write = updateBuildState,
  timestamp = () => new Date().toISOString() }) => {
  if (typeof run !== 'function' || !['prepare', 'propagate'].includes(stage)
    || typeof mode !== 'string' || !mode || !Number.isSafeInteger(chunks) || chunks < 0
    || !Number.isSafeInteger(files) || files < 0) throw new TypeError('Registered bounded relations baseline required.');
  const resources = { cpu: 1, io: 0, mem: 1, bytes: 0 };
  const scheduler = runtime.scheduler;
  if (typeof scheduler?.schedule !== 'function') return run();
  // Legacy/custom runtimes lacking a durable build identity retain their
  // existing scheduling route without a fabricated world or durable receipt.
  if (typeof runtime.buildId !== 'string' || !runtime.buildId || runtime.buildId === 'unknown'
    || typeof runtime.buildRoot !== 'string' || !runtime.buildRoot) {
    return scheduler.schedule(SCHEDULER_QUEUE_NAMES.stage2Relations, { ...resources, signal }, run);
  }
  const contractId = 'relations-' + stage + '-existing-baseline/v1';
  const implementationId = 'builtin-relations-' + stage + '/v1';
  const plan = advisePhysicalWorkGraph({ identity: {
    worldRoot: runtime.buildId, hardwareId: 'unmeasured:' + process.platform + ':' + process.arch,
    runtimeId: 'node:' + process.version, providerId: implementationId,
    configId: typeof runtime.configHash === 'string' && runtime.configHash ? runtime.configHash
      : semanticHash('relations.physical-config.v1', runtime.analysisPolicy || {})
  }, capabilities: ['existing-relations-scheduler'], calibrations: [], now: Date.now(), nodes: [{
    id: stage, predecessors: [], contractId, inputRoots: [runtime.buildId],
    shapeId: 'chunks:' + chunks + '/files:' + files, baselineId: 'existing',
    alternatives: [{ id: 'existing', implementationId, contractId, requires: ['existing-relations-scheduler'],
      resources, calibrationId: null }]
  }] });
  const phase = 'relations-physical:' + mode + ':' + stage;
  const startedAt = timestamp();
  const detail = { schemaVersion: 1, generation: { buildId: runtime.buildId, mode },
    stage, planId: plan.planId, mode: 'baseline-with-shadow-advice',
    effectiveImplementation: implementationId, prediction: 'unavailable-no-calibration',
    hardwareQualification: 'unmeasured', publication: 'pending', semanticCoverage: 'not-implied' };
  await write(runtime.buildRoot, { phases: { [phase]: { status: 'running', startedAt,
    updatedAt: startedAt, detail } } });
  try {
    const executed = await scheduleAdvisedBaseline({ plan, nodeId: stage, scheduler,
      queueName: SCHEDULER_QUEUE_NAMES.stage2Relations, signal,
      operators: new Map([[implementationId, { contractId, start: () => ({
        completion: Promise.resolve().then(run), releaseWorking: () => {}
      }) }]]) });
    const finishedAt = timestamp();
    await write(runtime.buildRoot, { phases: { [phase]: { status: 'done', startedAt, updatedAt: finishedAt,
      finishedAt, detail: { ...detail, execution: executed.receipt } } } });
    return executed.result;
  } catch (error) {
    const finishedAt = timestamp();
    try {
      await write(runtime.buildRoot, { phases: { [phase]: { status: 'failed', startedAt, updatedAt: finishedAt,
        finishedAt, detail: { ...detail, canceled: signal?.aborted === true,
          errorCode: typeof error?.code === 'string' ? error.code : error?.name || 'Error' } } } });
    } catch (checkpointError) {
      if (error && typeof error === 'object' && Object.isExtensible(error)) error.checkpointError ||= checkpointError;
    }
    throw error;
  }
};

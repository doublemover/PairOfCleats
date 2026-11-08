import { canonicalSemanticJson, semanticHash } from '../../semantic/identity.js';
import { throwIfAborted } from '../../../shared/abort.js';

const plans = new WeakMap(), executions = new WeakMap();
const key = canonicalSemanticJson;
const text = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096;
const fields = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype
  && !Object.getOwnPropertySymbols(value).length && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), 'value'));
const fail = message => { throw new TypeError('Physical work advisor: ' + message); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const amount = value => Number.isSafeInteger(value) && value >= 0;
const resourceValid = value => fields(value, ['cpu', 'io', 'mem', 'bytes']) && Object.values(value).every(amount);
const intervalValid = value => Array.isArray(value) && value.length === 2
  && value.every(item => Number.isFinite(item) && item >= 0) && value[0] <= value[1];

/** Supplied measured intervals remain predictions. This advisor never changes scheduler policy or dispatch choices. */
export const advisePhysicalWorkGraph = ({ identity, nodes, capabilities, calibrations, now, maxBytes = 1024 * 1024 }) => {
  if (!fields(identity, ['worldRoot', 'hardwareId', 'runtimeId', 'providerId', 'configId']) || !Object.values(identity).every(text)
    || !Array.isArray(nodes) || !nodes.length || nodes.length > 64 || !Array.isArray(capabilities) || capabilities.length > 128
    || capabilities.some(value => !text(value)) || !Array.isArray(calibrations) || calibrations.length > 256
    || !amount(now) || !amount(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) fail('bounded pinned graph required');
  const calibrationMap = new Map();
  for (const calibration of calibrations) {
    if (!fields(calibration, ['id', 'identity', 'implementationId', 'shapeId', 'observedAt', 'expiresAt',
      'coverage', 'evidenceRef', 'totalMilliseconds']) || !text(calibration.id) || calibrationMap.has(calibration.id)
      || !fields(calibration.identity, Object.keys(identity)) || !Object.values(calibration.identity).every(text)
      || !text(calibration.implementationId) || !text(calibration.shapeId) || !amount(calibration.observedAt)
      || !amount(calibration.expiresAt) || calibration.expiresAt < calibration.observedAt
      || !['representative-complete', 'partial', 'failed'].includes(calibration.coverage)
      || !text(calibration.evidenceRef) || !intervalValid(calibration.totalMilliseconds)) fail('invalid supplied calibration receipt');
    calibrationMap.set(calibration.id, calibration);
  }
  const ids = new Set(), normalized = [], finishLower = new Map(), finishUpper = new Map();
  let serialLower = 0, serialUpper = 0, allCalibrated = true, serializedBytes = Buffer.byteLength(key({ identity, calibrations }));
  for (const node of nodes) {
    if (!fields(node, ['id', 'predecessors', 'contractId', 'inputRoots', 'shapeId', 'baselineId', 'alternatives'])
      || !text(node.id) || ids.has(node.id) || !text(node.contractId) || !text(node.shapeId) || !text(node.baselineId)
      || !Array.isArray(node.predecessors) || node.predecessors.length > 64 || new Set(node.predecessors).size !== node.predecessors.length
      || node.predecessors.some(id => !ids.has(id)) || !Array.isArray(node.inputRoots) || node.inputRoots.length > 128
      || node.inputRoots.some(root => !text(root)) || !Array.isArray(node.alternatives) || !node.alternatives.length
      || node.alternatives.length > 16) fail('topologically ordered complete work nodes required');
    ids.add(node.id);
    const alternatives = [], alternativeIds = new Set();
    for (const alternative of node.alternatives) {
      if (!fields(alternative, ['id', 'implementationId', 'contractId', 'requires', 'resources', 'calibrationId'])
        || !text(alternative.id) || alternativeIds.has(alternative.id) || !text(alternative.implementationId)
        || !text(alternative.contractId) || !Array.isArray(alternative.requires) || alternative.requires.length > 32
        || alternative.requires.some(value => !text(value)) || !resourceValid(alternative.resources)
        || !(alternative.calibrationId === null || text(alternative.calibrationId))) fail('invalid physical alternative');
      alternativeIds.add(alternative.id);
      const reasons = [];
      if (alternative.contractId !== node.contractId) reasons.push('semantic-contract-mismatch');
      if (alternative.requires.some(capability => !capabilities.includes(capability))) reasons.push('capability-unavailable');
      const calibration = calibrationMap.get(alternative.calibrationId);
      const qualified = calibration && key(calibration.identity) === key(identity)
        && calibration.implementationId === alternative.implementationId && calibration.shapeId === node.shapeId
        && calibration.coverage === 'representative-complete' && calibration.observedAt <= now && calibration.expiresAt >= now;
      alternatives.push({ ...alternative, legalCandidate: !reasons.length, rejectionReasons: reasons,
        predictedMilliseconds: qualified ? calibration.totalMilliseconds : null,
        calibrationStatus: qualified ? 'compatible-supplied-measurement' : 'missing-stale-partial-or-incompatible' });
    }
    const baseline = alternatives.find(alternative => alternative.id === node.baselineId);
    if (!baseline || !baseline.legalCandidate) fail('legal baseline required');
    const candidates = alternatives.filter(alternative => alternative.legalCandidate && alternative.predictedMilliseconds)
      .sort((a, b) => a.predictedMilliseconds[1] - b.predictedMilliseconds[1] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const preferred = candidates[0] || baseline;
    normalized.push({ ...node, alternatives, shadowPreferredId: preferred.id, effectiveId: baseline.id });
    serializedBytes += Buffer.byteLength(key(node));
    if (serializedBytes > maxBytes) throw new RangeError('Physical work graph metadata allowance exceeded.');
    if (!baseline.predictedMilliseconds || node.predecessors.some(id => finishLower.get(id) === null)) {
      allCalibrated = false; finishLower.set(node.id, null); finishUpper.set(node.id, null);
    } else {
      const [lower, upper] = baseline.predictedMilliseconds;
      serialLower += lower; serialUpper += upper;
      finishLower.set(node.id, Math.max(0, ...node.predecessors.map(id => finishLower.get(id))) + lower);
      finishUpper.set(node.id, Math.max(0, ...node.predecessors.map(id => finishUpper.get(id))) + upper);
      if (![serialLower, serialUpper, finishLower.get(node.id), finishUpper.get(node.id)].every(Number.isFinite)) fail('prediction overflow');
    }
  }
  const data = freeze(JSON.parse(key({ identity, nodes: normalized, capabilities, calibrations, now })));
  const plan = Object.freeze({ planId: semanticHash('pairofcleats.physical-work-advice.v1', data), identity: data.identity,
    nodes: data.nodes, mode: 'shadow-only', serialBaselineMilliseconds: allCalibrated ? [serialLower, serialUpper] : null,
    dependencyPathMilliseconds: allCalibrated ? [Math.max(...finishLower.values()), Math.max(...finishUpper.values())] : null,
    overlap: 'not-qualified', resourceContention: 'not-modeled', measuredSpeedup: 'not-claimed' });
  plans.set(plan, data);
  return plan;
};

/** Submit the unchanged baseline to the existing scheduler; keep its reservation through actual completion. */
export const scheduleAdvisedBaseline = async ({ plan, nodeId, scheduler, queueName, operators, signal,
  predecessorReceipts = [], nowMilliseconds = () => performance.now() }) => {
  const data = plans.get(plan), node = data?.nodes.find(value => value.id === nodeId);
  if (!node || typeof scheduler?.schedule !== 'function' || !text(queueName) || !(operators instanceof Map)
    || typeof nowMilliseconds !== 'function' || !Array.isArray(predecessorReceipts) || predecessorReceipts.length > 64) fail('owned plan and existing scheduler required');
  if (node.predecessors.some(id => !predecessorReceipts.some(receipt => {
    const prior = executions.get(receipt); return prior?.plan === plan && prior.nodeId === id;
  }))) fail('unfinished or incompatible predecessor');
  const baseline = node.alternatives.find(value => value.id === node.baselineId), operator = operators.get(baseline.implementationId);
  if (!operator || operator.contractId !== node.contractId || typeof operator.start !== 'function') fail('registered exact baseline implementation required');
  const queuedAt = nowMilliseconds();
  return scheduler.schedule(queueName, { ...baseline.resources, signal }, async () => {
    throwIfAborted(signal);
    const startedAt = nowMilliseconds();
    // start owns cleanup if it throws before returning this fence-bearing working allocation.
    const operation = await operator.start({ inputRoots: [...node.inputRoots], identity: data.identity, signal });
    if (!operation || typeof operation.completion?.then !== 'function' || typeof operation.releaseWorking !== 'function') {
      fail('baseline must return actual completion fence and working-resource release');
    }
    let result, completionAt, primaryError = null, failed = false;
    try {
      result = await operation.completion;
      completionAt = nowMilliseconds();
      throwIfAborted(signal);
    } catch (error) {
      primaryError = error; failed = true; throw error;
    } finally {
      try { await operation.releaseWorking(); }
      catch (releaseError) {
        if (!failed) throw releaseError;
        if (primaryError && typeof primaryError === 'object' && Object.isExtensible(primaryError)) primaryError.cleanupError ||= releaseError;
      }
    }
    const releasedAt = nowMilliseconds();
    const receipt = freeze({ planId: plan.planId, nodeId, requestedImplementation: baseline.implementationId,
      effectiveImplementation: baseline.implementationId, shadowPreferredId: node.shadowPreferredId,
      contractId: node.contractId, predictedMilliseconds: baseline.predictedMilliseconds,
      queueMilliseconds: startedAt - queuedAt, completionMilliseconds: completionAt - startedAt,
      releaseMilliseconds: releasedAt - completionAt, reservation: { ...baseline.resources },
      schedulerAuthority: 'existing-owner', outputPublication: 'operator-owned', mode: 'baseline-with-shadow-advice' });
    executions.set(receipt, { plan, nodeId });
    return { result, receipt };
  });
};

import path from 'node:path';
import { resolveBuildStateDurabilityClass } from './durability.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';

const readCause = (cause, phase) => {
  const observation = observeStorageResource(cause, { phase });
  let code = '', name = '', inspection, inspectionPresent = false;
  try {
    observation.requireSettled();
    const rawCode = observation.primary.code;
    if (typeof rawCode === 'string') code = rawCode.slice(0, 128);
    if (!code) { const rawName = observation.primary.name; if (typeof rawName === 'string') name = rawName.slice(0, 128); }
    observation.requireSettled();
  } catch (error) { inspection = error; inspectionPresent = true; }
  return { code, name, observation, inspection, inspectionPresent };
};

/** Classification cannot discard the original resource or invoke coercion. */
export const readBuildStateFailureCode = (cause, phase = 'build-state-failure-code') => {
  const observation = observeStorageResource(cause, { phase });
  observation.requireSettled();
  let code;
  try { code = observation.primary.code; }
  catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled();
  return typeof code === 'string' ? code : '';
};

export const createBuildStateWriteFailureError = ({ buildRoot, target, phase, cause }) => {
  const captured = readCause(cause, 'build-state-write-diagnostic');
  const resolvedBuildRoot = buildRoot ? path.resolve(buildRoot) : null;
  const error = Object.assign(new Error(
    `[build_state] ${target} write failed (${captured.code || captured.name || 'UNKNOWN'})${resolvedBuildRoot ? ` for ${resolvedBuildRoot}` : ''}.`,
    { cause }), { code: 'ERR_BUILD_STATE_WRITE_FAILED', target, phase, buildRoot: resolvedBuildRoot, causeCode: captured.code });
  return captured.observation.wrap(error, captured);
};

const pidValue = value => typeof value === 'number' || typeof value === 'string' && /^\d{1,16}$/u.test(value)
  ? Number(value) : NaN;
export const normalizeBuildStateLockOwner = (info, fallbackPid = null) => {
  if (!info || typeof info !== 'object') {
    const pid = pidValue(fallbackPid);
    return Number.isSafeInteger(pid) && pid > 0 ? { pid } : null;
  }
  const observation = observeStorageResource(info, { phase: 'build-state-lock-owner' });
  observation.requireSettled();
  const owner = {};
  try {
    const pid = pidValue(info.pid ?? fallbackPid);
    if (Number.isSafeInteger(pid) && pid > 0) owner.pid = pid;
    for (const field of ['lockId', 'scope', 'startedAt']) {
      const value = info[field]; if (typeof value === 'string' && value.trim()) owner[field] = value.trim().slice(0, 256);
    }
  } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled();
  return Object.keys(owner).length ? owner : null;
};

export const formatBuildStateLockOwner = value => {
  const owner = normalizeBuildStateLockOwner(value);
  if (!owner) return null;
  return ['pid', 'lockId', 'scope', 'startedAt'].filter(field => owner[field] !== undefined)
    .map(field => `${field}=${owner[field]}`).join(', ') || null;
};

export const createBuildStateLockUnavailableError = ({ buildRoot, durabilityClass, owner = null, cause = null }) => {
  const captured = readCause(cause, 'build-state-lock-diagnostic');
  const resolvedBuildRoot = buildRoot ? path.resolve(buildRoot) : null;
  let normalizedOwner = null, ownerDetail = null;
  try { normalizedOwner = normalizeBuildStateLockOwner(owner); ownerDetail = formatBuildStateLockOwner(normalizedOwner); }
  catch (inspection) {
    // An owner diagnostic is independently required; preserve any earlier
    // cause inspection through the existing observation composer.
    captured.inspection = captured.inspectionPresent
      ? addStorageFailureContext(captured.inspection, {}, inspection, { secondaryPresent: true }) : inspection;
    captured.inspectionPresent = true;
  }
  const error = Object.assign(new Error(
    `[build_state] state write lock unavailable${resolvedBuildRoot ? ` for ${resolvedBuildRoot}` : ''}${ownerDetail ? ` (owner: ${ownerDetail})` : ''}.`,
    cause !== null ? { cause } : undefined), { code: 'ERR_BUILD_STATE_LOCK_UNAVAILABLE', buildRoot: resolvedBuildRoot,
    retryable: true, ...(captured.code ? { causeCode: captured.code } : {}), lockOwner: normalizedOwner,
    buildState: { retryable: true, reason: 'lock-unavailable', durabilityClass: resolveBuildStateDurabilityClass(durabilityClass),
      buildRoot: resolvedBuildRoot, lockOwner: normalizedOwner } });
  return captured.observation.wrap(error, captured);
};

export const createBuildStateLockUnavailableResult = ({ buildRoot, durabilityClass, owner = null }) => {
  const resolvedBuildRoot = buildRoot ? path.resolve(buildRoot) : null, normalizedOwner = normalizeBuildStateLockOwner(owner);
  return { ok: false, deferred: true, retryable: true, code: 'ERR_BUILD_STATE_LOCK_UNAVAILABLE', buildRoot: resolvedBuildRoot,
    lockOwner: normalizedOwner, buildState: { retryable: true, reason: 'lock-unavailable',
      durabilityClass: resolveBuildStateDurabilityClass(durabilityClass), buildRoot: resolvedBuildRoot, lockOwner: normalizedOwner } };
};

export const isBuildStateLockUnavailableResult = value => {
  if (!value || typeof value !== 'object') return false;
  const observation = observeStorageResource(value, { phase: 'build-state-lock-result' });
  observation.requireSettled();
  let result;
  try { result = value.code === 'ERR_BUILD_STATE_LOCK_UNAVAILABLE' && value.retryable === true && value.buildState?.reason === 'lock-unavailable'; }
  catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled(); return result;
};

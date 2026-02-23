import {
  isOptionalArtifactMissingError,
  isOptionalArtifactTooLargeError
} from './index-artifact-helpers.js';

/**
 * Dispatch optional-artifact fallback handlers for known non-fatal errors.
 *
 * @param {unknown} err
 * @param {{name?:string|null,onTooLarge?:(name:string|null,err:unknown)=>void,onMissing?:(name:string|null,err:unknown)=>void}} [options]
 * @returns {boolean}
 */
const handleOptionalArtifactFallback = (
  err,
  { name = null, onTooLarge = null, onMissing = null } = {}
) => {
  if (isOptionalArtifactTooLargeError(err)) {
    if (typeof onTooLarge === 'function') onTooLarge(name, err);
    return true;
  }
  if (isOptionalArtifactMissingError(err)) {
    if (typeof onMissing === 'function') onMissing(name, err);
    return true;
  }
  return false;
};

/**
 * Execute optional loader synchronously and convert missing/oversized artifacts
 * into null fallback values.
 *
 * @template T
 * @param {() => T} loader
 * @param {{name?:string|null,onTooLarge?:(name:string|null,err:unknown)=>void,onMissing?:(name:string|null,err:unknown)=>void}} [options]
 * @returns {T|null}
 */
export function loadOptionalSyncWithFallback(
  loader,
  { name = null, onTooLarge = null, onMissing = null } = {}
) {
  try {
    return loader();
  } catch (err) {
    if (handleOptionalArtifactFallback(err, { name, onTooLarge, onMissing })) {
      return null;
    }
    throw err;
  }
}

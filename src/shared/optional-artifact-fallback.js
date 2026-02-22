import {
  isOptionalArtifactMissingError,
  isOptionalArtifactTooLargeError
} from './index-artifact-helpers.js';

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

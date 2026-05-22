const OPTIONAL_ARTIFACT_MISSING_CODES = new Set([
  'ERR_MANIFEST_ENTRY_MISSING',
  'ERR_MANIFEST_MISSING',
  'ERR_ARTIFACT_PARTS_MISSING'
]);

const OPTIONAL_ARTIFACT_MISSING_PREFIXES = [
  'Missing JSON artifact:',
  'Missing JSONL artifact:',
  'Missing manifest parts for'
];

const OPTIONAL_ARTIFACT_MISSING_PATTERNS = [
  /Missing index artifact/,
  /Missing manifest entry for /
];

/**
 * Normalize loader errors that represent optional-artifact absence.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isOptionalArtifactMissingError(err) {
  const code = typeof err?.code === 'string' ? err.code : '';
  if (OPTIONAL_ARTIFACT_MISSING_CODES.has(code)) return true;
  const message = String(err?.message || '');
  if (OPTIONAL_ARTIFACT_MISSING_PREFIXES.some((prefix) => message.startsWith(prefix))) {
    return true;
  }
  return OPTIONAL_ARTIFACT_MISSING_PATTERNS.some((pattern) => pattern.test(message));
}

export const isOptionalArtifactTooLargeError = (err) => err?.code === 'ERR_JSON_TOO_LARGE';

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

export async function loadOptionalWithFallback(
  loader,
  { name = null, onTooLarge = null, onMissing = null } = {}
) {
  try {
    return await loader();
  } catch (err) {
    if (handleOptionalArtifactFallback(err, { name, onTooLarge, onMissing })) {
      return null;
    }
    throw err;
  }
}

/**
 * Wrap an optional async iterable loader and suppress expected missing/too-large
 * failures while preserving stream shape.
 *
 * @param {() => Promise<AsyncIterable<any>|null>} loader
 * @param {{name?:string|null,onTooLarge?:(name:string|null,err:unknown)=>void,onMissing?:(name:string|null,err:unknown)=>void}} [options]
 * @returns {AsyncIterable<any>}
 */
export function iterateOptionalWithFallback(
  loader,
  { name = null, onTooLarge = null, onMissing = null } = {}
) {
  return (async function* iterateOptionalRows() {
    try {
      const rows = await loader();
      if (!rows) return;
      for await (const row of rows) {
        yield row;
      }
    } catch (err) {
      if (handleOptionalArtifactFallback(err, { name, onTooLarge, onMissing })) {
        return;
      }
      throw err;
    }
  })();
}

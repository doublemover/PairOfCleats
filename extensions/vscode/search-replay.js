const path = require('node:path');
const { buildSearchArgs } = require('./search-contract.js');

const stringOptions = ['mode', 'backend', 'file', 'path', 'lang', 'ext', 'type',
  'asOf', 'snapshot', 'filter', 'author', 'modifiedAfter', 'churn', 'cursor'];
const booleanOptions = ['annEnabled', 'caseSensitive', 'explain'];
const optionKeys = new Set([...stringOptions, ...booleanOptions, 'maxResults',
  'contextLines', 'modifiedSince', 'extraArgs']);
const sameRoot = (left, right) => {
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
};

// Executables and argv are diagnostic history. Only a bounded semantic search
// request may be reconstructed through the current configured CLI/API owner.
function normalizeSearchRequest(value) {
  if (!value || value.version !== 1 || typeof value.repoRoot !== 'string' || !path.isAbsolute(value.repoRoot)
    || typeof value.query !== 'string' || !value.options || typeof value.options !== 'object'
    || Array.isArray(value.options) || Object.keys(value).some(key => !['version', 'repoRoot', 'query', 'options'].includes(key))
    || Object.keys(value.options).some(key => !optionKeys.has(key))) return null;
  const options = { ...value.options };
  if (stringOptions.some(key => options[key] !== undefined && typeof options[key] !== 'string')
    || booleanOptions.some(key => options[key] !== undefined && typeof options[key] !== 'boolean')
    || !Number.isSafeInteger(options.maxResults) || options.maxResults < 1
    || options.contextLines !== 0 || options.modifiedSince !== null
      && (!Number.isSafeInteger(options.modifiedSince) || options.modifiedSince < 0)
    || !Array.isArray(options.extraArgs) || options.extraArgs.some(arg => typeof arg !== 'string')) return null;
  try {
    if (Buffer.byteLength(JSON.stringify(value)) > 65536) return null;
    buildSearchArgs(value.query, value.repoRoot, options);
  } catch { return null; }
  options.extraArgs = Object.freeze([...options.extraArgs]);
  return Object.freeze({ version: 1, repoRoot: path.resolve(value.repoRoot), query: value.query,
    options: Object.freeze(options) });
}

function captureSearchRequest(repoRoot, query, options) {
  return normalizeSearchRequest({ version: 1, repoRoot, query, options });
}

function admitSearchReplay(invocation, repoRoot, query, currentExtraArgs) {
  const request = normalizeSearchRequest(invocation?.request);
  if (!request || invocation.requestInvalid || !sameRoot(request.repoRoot, repoRoot) || request.query !== query) {
    throw new Error('Saved search has no matching semantic request. Reopen its evidence or deliberately run a new search.');
  }
  if (JSON.stringify(request.options.extraArgs) !== JSON.stringify(currentExtraArgs)) {
    throw new Error('Search extra arguments changed. Run a new search to deliberately capture the current configured arguments.');
  }
  return request;
}

module.exports = { normalizeSearchRequest, captureSearchRequest, admitSearchReplay };

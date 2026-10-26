import { parse } from 'parse5';
import { createHash } from 'node:crypto';
import { throwIfAborted } from '../shared/abort.js';
import { describeStorageFailure } from '../shared/storage/failure-observation.js';
import { installedPackageVersion } from '../shared/installed-package-version.js';

const documents = new WeakMap();
const profileFor = ({ sourceCodeLocationInfo = true, scriptingEnabled = true, forceParseError = false } = {}) =>
  Object.freeze({ sourceCodeLocationInfo: sourceCodeLocationInfo === true, scriptingEnabled: scriptingEnabled === true,
    forceParseError: forceParseError === true, treeAdapter: 'parse5-default', sourceCoordinates: 'utf16le-js-string' });
const canonicalProfile = options => profileFor({ forceParseError: options?.html?.forceParseError === true });
const profileKey = profile => JSON.stringify(profile);
export const htmlPreparationProfileKey = options => profileKey(canonicalProfile(options));

/** Branded, source-owned and explicitly released; no path/global last-document cache. */
export const prepareHtmlDocument = (text, options = {}) => {
  const signal = options.signal || options.abortSignal;
  throwIfAborted(signal);
  const profile = profileFor(options), handle = Object.freeze({});
  const state = { text, document: null, profile, released: false, parseCalls: 0, status: 'pending', reason: null,
    source: { encoding: 'utf16le-js-string', codeUnits: typeof text === 'string' ? text.length : null,
      utf8Bytes: typeof text === 'string' ? Buffer.byteLength(text) : null,
      sha256: typeof text === 'string' ? createHash('sha256').update(text, 'utf16le').digest('hex') : null },
    sourceStringBytes: typeof text === 'string' ? text.length * 2 : 0, visits: { chunks: 0, metadata: 0 } };
  documents.set(handle, state);
  try {
    try {
      if (profile.forceParseError) throw new Error('forced parse5 error');
      state.parseCalls++;
      state.document = parse(text, { sourceCodeLocationInfo: profile.sourceCodeLocationInfo, scriptingEnabled: profile.scriptingEnabled });
      state.status = 'parsed';
    } catch (error) {
      // A report cannot hide pending resource ownership. Ordinary parse failures
      // retain the existing explicit Tree-sitter/document fallback path.
      describeStorageFailure(error, { phase: 'html-document-parse' });
      throwIfAborted(signal);
      state.status = 'parse-failed'; state.reason = 'parse-failed';
    }
    throwIfAborted(signal);
    return handle;
  } catch (error) { releaseHtmlDocument(handle); throw error; }
};

export const releaseHtmlDocument = handle => {
  const state = documents.get(handle);
  if (state) { state.document = null; state.text = null; state.released = true; }
};

export const getHtmlPreparationDiagnostics = handle => {
  const state = documents.get(handle);
  if (!state) return null;
  return { parser: { id: 'parse5', version: installedPackageVersion('parse5') }, profile: state.profile,
    source: { ...state.source }, parseCalls: state.parseCalls, status: state.status, reason: state.reason,
    sourceStringBytes: state.sourceStringBytes, treeRetained: state.document !== null,
    released: state.released, visits: { ...state.visits },
    memoryScope: 'source-string-bytes-only;parse-tree-and-projections-unmeasured' };
};

/** Consumers accept only a live exact-text/exact-profile handle. Otherwise they
 * prepare and retire their own tree without inheriting any caller-supplied AST. */
export const withHtmlDocument = (text, options, prepared, project) => {
  throwIfAborted(options?.signal || options?.abortSignal);
  const previous = documents.get(prepared);
  const reuse = previous && !previous.released && previous.text === text
    && profileKey(previous.profile) === htmlPreparationProfileKey(options);
  const handle = reuse ? prepared : prepareHtmlDocument(text, {
    ...canonicalProfile(options), signal: options?.signal || options?.abortSignal
  });
  const state = documents.get(handle);
  try {
    const result = project({ document: state.document, status: state.status,
      recordVisit: kind => { state.visits[kind]++; } });
    throwIfAborted(options?.signal || options?.abortSignal);
    return result;
  } finally { if (!reuse) releaseHtmlDocument(handle); }
};

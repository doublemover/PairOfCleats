import { throwIfAborted } from '../../../../shared/abort.js';
import { observeStorageResource } from '../../../../shared/storage/failure-observation.js';

/** One collection's finite pull owner. It requests only currently open original
 * documents; result IDs and related-document reports grant no source authority.
 * There is no prior-response cache, so `unchanged` cannot establish an answer.
 * A refresh can trigger one bounded second pass, never an unbounded retry loop.
 */
export const createDiagnosticPull = ({ now = Date.now } = {}) => {
  let revision = 0;
  return Object.freeze({
    refresh: () => { revision++; },
    collect: async ({ capability, openDocs, request, setDiagnosticsForUri, invalidateDiagnosticsForUri, maxDocuments = 1000,
      maxDurationMs = 4000, signal = null }) => {
      throwIfAborted(signal);
      if (!Number.isSafeInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > 10000
        || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 0 || maxDurationMs > 30000
        || !(openDocs instanceof Map) || typeof request !== 'function' || typeof setDiagnosticsForUri !== 'function'
        || typeof invalidateDiagnosticsForUri !== 'function') {
        throw new TypeError('Pull diagnostics requires bounded original document/request owners.');
      }
      if (!capability || typeof capability !== 'object') return { mode: 'push', supported: false };
      const started = now(), deadline = started + maxDurationMs;
      const documents = [];
      let omittedDocuments = 0;
      for (const [ownerKey, document] of openDocs) {
        if (document.closed || typeof document.uri !== 'string' || !Number.isSafeInteger(document.version)) continue;
        if (documents.length === maxDocuments) { omittedDocuments++; continue; }
        documents.push({ ownerKey, document });
      }
      const identifier = typeof capability.identifier === 'string' ? capability.identifier : null;
      const invalidate = () => {
        for (const { ownerKey, document } of documents) if (!document.closed && openDocs.get(ownerKey) === document) {
          invalidateDiagnosticsForUri(document.uri, document.version);
        }
      };
      let requested = 0, observed = 0, passes = 0, complete = omittedDocuments === 0, reason = null, observedRevision = revision;
      outer: for (let pass = 0; pass < 2; pass++) {
        observedRevision = revision; observed = 0; passes++;
        for (const { ownerKey, document } of documents) {
          throwIfAborted(signal);
          if (revision !== observedRevision) { complete = false; reason = 'refresh'; break; }
          const remaining = Math.floor(deadline - now());
          if (remaining <= 0) { complete = false; reason = 'deadline'; break outer; }
          // The caller can close/replace an original document while awaiting a
          // prior request. Do not admit another URI from that changed owner.
          if (document.closed || openDocs.get(ownerKey) !== document) {
            complete = false; reason = 'document-retired'; break outer;
          }
          const version = document.version, uri = document.uri;
          let report;
          try {
            requested++;
            report = await request('textDocument/diagnostic', { textDocument: { uri }, ...(identifier ? { identifier } : {}) }, remaining);
          } catch (error) {
            observeStorageResource(error, { phase: 'lsp-pull-diagnostic-request' }).requireSettled();
            throwIfAborted(signal);
            complete = false; reason = 'request-failed'; break outer;
          }
          throwIfAborted(signal);
          if (now() > deadline) { complete = false; reason = 'deadline'; break outer; }
          if (document.closed || document.uri !== uri || document.version !== version || openDocs.get(ownerKey) !== document) {
            complete = false; reason = 'document-changed'; break outer;
          }
          if (revision !== observedRevision) { complete = false; reason = 'refresh'; break; }
          const observation = observeStorageResource(report, { phase: 'lsp-pull-diagnostic-report' }); observation.requireSettled();
          const kind = observation.read('kind'), items = observation.read('items'), related = observation.read('relatedDocuments');
          observation.requireSettled();
          if (kind !== 'full' || !Array.isArray(items)) {
            complete = false; reason = 'unsupported-report'; break outer;
          }
          setDiagnosticsForUri(uri, items, version); observed++;
          if (related && Object.keys(related).length) {
            complete = false; reason = 'unrequested-related-documents';
          }
        }
        if (revision === observedRevision) break;
        invalidate();
        // A second pass is fresh work against the same finite admission. It
        // replaces reports from the interrupted pass rather than merging them.
        if (pass === 0) { complete = omittedDocuments === 0; reason = null; }
        else { complete = false; reason = 'refresh-limit'; }
      }
      if (revision !== observedRevision) invalidate();
      complete &&= revision === observedRevision && observed === documents.length;
      return { mode: 'pull', supported: true, complete, requested, observed, passes, omittedDocuments,
        reason: reason || (complete ? null : 'incomplete'), durationMs: Math.max(0, now() - started) };
    }
  });
};

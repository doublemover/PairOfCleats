import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createTuiSettingsSession } from './settings.js';
import { assertTuiSearchRequest, assertTuiSearchDiagnostics } from '../../../src/contracts/validators/tui-search.js';
import { buildSearchRequestArgs } from '../../../src/shared/search-request.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { createExcerptSourceContext, resolveExcerpt } from '../../../src/context-pack/excerpt-cache.js';
import { getSearchRequestSchema } from '../../api/validation.js';
import { readVerifiedContainedFile, assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { resolveTrustedTuiCommand, runTrustedTuiCommand } from './command.js';
import { buildSearchDiagnostics } from '../../../src/retrieval/output/search-diagnostics.js';
import { captureOwnedCleanup, combineOwnedErrors, createOwnedCleanupRetirements, ownedCleanupIsPending } from './settle-owned.js';
import { readTuiSearchChildFailure, tuiFailureCode, getTuiFailureInspections } from './operation-failure.js';

const MODES = [['code', 'code'], ['prose', 'prose'], ['extractedProse', 'extracted-prose'], ['records', 'records']];
const MAX_OUTPUT_BYTES = 768 * 1024;
const MAX_RETAINED_HITS = 500;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const safeText = value => String(value ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '\uFFFD');
const safeLabel = value => safeText(value).replace(/[\r\n\t]/g, ' ');
const hitKey = (mode, hit) => createHash('sha256').update(JSON.stringify([
  mode, hit.chunkUid ?? hit.globalId ?? hit.id ?? null, hit.file, hit.start ?? null, hit.end ?? null
])).digest('hex');

/** One live native query owns its scope, continuation, child and source identities. */
export const createTuiSearchSession = ({ toolRoot, env = process.env, spawn = spawnSubprocess } = {}) => {
  const scopes = createTuiSettingsSession({ toolRoot, env });
  const pendingWork = new Set();
  const controllers = new Set();
  const retirements = createOwnedCleanupRetirements();
  let epoch = 0, current = null, pending = null, disposed = false;
  const describe = request => {
    assertTuiSearchRequest('describe', request);
    const schema = getSearchRequestSchema();
    for (const key of ['repo', 'repoPath', 'cursor', 'output']) delete schema.properties[key];
    return { schema, resultModes: MODES.map(([, mode]) => mode),
      defaults: { mode: 'all', backend: 'auto', top: 10 },
      limits: { maxHits: MAX_RETAINED_HITS, maxCaptureBytes: MAX_OUTPUT_BYTES,
        maxSourceBytes: 64 * 1024 * 1024, maxExcerptBytes: 16 * 1024 } };
  };
  const requireCurrent = resultId => {
    if (disposed || !current || current.resultId !== resultId) {
      fail('ERR_TUI_SEARCH_STALE', 'The search has changed. Run it again.');
    }
    scopes.captureScope(current.scope.id);
    return current;
  };
  const execute = async (state, cursor, signal, onSpawn) => {
    const built = buildSearchRequestArgs({ ...state.search, ...(cursor ? { cursor } : {}) },
      { includeRepo: true, repoPath: state.scope.configRoot, defaultOutput: 'compact', allowedOutputs: ['compact'] });
    if (!built.ok) fail('ERR_TUI_SEARCH_REQUEST', built.message);
    let child;
    try { child = await spawn(process.execPath, [path.join(toolRoot, 'bin/pairofcleats.js'),
      'search', ...built.args, ...(built.query ? ['--', built.query] : [])], {
      cwd: state.scope.configRoot, env, signal, onSpawn, timeoutMs: 15000,
      stdio: ['ignore', 'pipe', 'pipe'], maxOutputBytes: MAX_OUTPUT_BYTES, rejectOnNonZeroExit: true
    }); } catch (error) {
      captureOwnedCleanup(error);
      const failure = readTuiSearchChildFailure(error), fallback = tuiFailureCode(error);
      const inspections = [...failure.inspections, ...getTuiFailureInspections(fallback)];
      const original = inspections.length ? combineOwnedErrors(error, inspections) : error;
      const observation = captureOwnedCleanup(original);
      throw Object.assign(new Error('Search child did not complete.', { cause: original }), {
        code: failure.code || fallback.code, tuiField: failure.field, tuiNativeSearchFailure: failure.nativeFailure,
        ...(observation.present ? { cacheOwnershipPending: true,
          cacheOwnershipReleased: () => observation.released() } : {})
      });
    }
    throwIfAborted(signal);
    scopes.captureScope(state.scope.id);
    if (state.epoch !== epoch || disposed) fail('ERR_TUI_SEARCH_STALE', 'The search has changed.');
    if (child.outputCapture?.stdout?.truncated || child.outputCapture?.stdout?.encodingLoss
      || child.outputCapture?.stderr?.truncated) fail('ERR_TUI_SEARCH_OUTPUT', 'Search capture was incomplete.');
    let payload;
    try { payload = JSON.parse(child.stdout); }
    catch { fail('ERR_TUI_SEARCH_OUTPUT', 'Search returned invalid JSON.'); }
    if (!payload || typeof payload !== 'object' || MODES.some(([key]) => !Array.isArray(payload[key]))) {
      fail('ERR_TUI_SEARCH_OUTPUT', 'Search returned an unsupported result shape.');
    }
    const hits = [], additions = new Map();
    for (const [key, mode] of MODES) {
      for (const hit of payload[key]) {
        if (!hit || typeof hit.file !== 'string') fail('ERR_TUI_SEARCH_OUTPUT', 'Search returned a hit without source identity.');
        const hitId = hitKey(mode, hit);
        if (state.hits.has(hitId) || additions.has(hitId)) fail('ERR_TUI_SEARCH_CURSOR', 'Continuation repeated a hit.');
        const rank = (state.counts[mode] || 0) + hits.filter(row => row.mode === mode).length + 1;
        additions.set(hitId, { ...hit, mode });
        hits.push({ hitId, mode, rank, file: safeLabel(hit.file), name: safeLabel(hit.name ?? hit.headline),
          score: Number.isFinite(hit.score) ? hit.score : null, startLine: hit.startLine ?? null,
          endLine: hit.endLine ?? null, generationKey: hit.generationKey ?? null });
      }
    }
    if (state.hits.size + hits.length > MAX_RETAINED_HITS) fail('ERR_TUI_SEARCH_LIMIT', 'Start a narrower search to inspect more results.');
    if (Buffer.byteLength(JSON.stringify([...state.hits, ...additions])) > MAX_OUTPUT_BYTES) {
      fail('ERR_TUI_SEARCH_LIMIT', 'Search result retention reached its byte bound.');
    }
    for (const [key, hit] of additions) {
      state.hits.set(key, hit);
      state.counts[hit.mode] = (state.counts[hit.mode] || 0) + 1;
    }
    state.cursor = payload.pagination?.nextCursor || null;
    return { resultId: state.resultId, scopeId: state.scope.id, queryGeneration: state.epoch,
      repoPath: state.scope.configRoot, hits,
      pagination: payload.pagination ?? null, freshness: payload.retrieval?.freshness ?? null,
      searchDiagnostics: assertTuiSearchDiagnostics(buildSearchDiagnostics(payload.retrieval)),
      outputBudget: payload.outputBudget ?? null, diagnostics: safeText(child.stderr).slice(0, 8192) };
  };
  const withOwnedOperation = async (executeOperation, signal, { query = false } = {}) => {
    retirements.assertSettled();
    const controller = new AbortController();
    if (query) pending = controller;
    controllers.add(controller);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const operation = Promise.resolve().then(() => executeOperation(controller.signal)).catch(error => { throw retirements.capture(error); });
    pendingWork.add(operation);
    try { return await operation; }
    finally {
      pendingWork.delete(operation);
      controllers.delete(controller);
      signal?.removeEventListener('abort', abort);
      if (pending === controller) pending = null;
    }
  };
  const run = (state, cursor, signal, onSpawn) => withOwnedOperation(
    ownedSignal => execute(state, cursor, ownedSignal, onSpawn), signal, { query: true });
  const query = async (request, { signal, onSpawn } = {}) => {
    assertTuiSearchRequest('query', request);
    if (disposed) fail('ERR_TUI_SEARCH_STALE', 'The search session has closed.');
    pending?.abort();
    const selectedEpoch = ++epoch;
    current = null;
    return withOwnedOperation(async ownedSignal => {
      const scope = await scopes.selectScope({ kind: 'repo', target: request.repoPath }, { signal: ownedSignal });
      throwIfAborted(ownedSignal);
      if (selectedEpoch !== epoch) fail('ERR_TUI_SEARCH_STALE', 'A newer query replaced this request.');
      const state = { resultId: randomUUID(), epoch, scope, search: structuredClone(request.search),
        hits: new Map(), counts: {}, cursor: null };
      const result = await execute(state, null, ownedSignal, onSpawn);
      if (state.epoch !== epoch || disposed) fail('ERR_TUI_SEARCH_STALE', 'A newer query replaced this request.');
      current = state;
      return result;
    }, signal, { query: true });
  };
  const continueSearch = async (request, { signal, onSpawn } = {}) => {
    assertTuiSearchRequest('continue', request);
    const state = requireCurrent(request.resultId);
    if (pending) fail('ERR_TUI_SEARCH_BUSY', 'A search page is already running.');
    if (!state.cursor) fail('ERR_TUI_SEARCH_CURSOR', 'This search has no continuation.');
    return run(state, state.cursor, signal, onSpawn);
  };
  const source = async (request, { signal } = {}) => {
    assertTuiSearchRequest('source', request);
    return withOwnedOperation(async signal => {
      const state = requireCurrent(request.resultId), hit = state.hits.get(request.hitId);
      if (!hit) fail('ERR_TUI_SEARCH_HIT', 'Choose a hit from the current search.');
      throwIfAborted(signal);
      const context = createExcerptSourceContext();
      try {
        const target = path.resolve(state.scope.configRoot, hit.file);
        const indexedHash = /^(?:sha1:)?[a-f0-9]{40}$/i.test(hit.sourceHash || '') ? hit.sourceHash : null;
        const excerpt = resolveExcerpt({ filePath: target, repoRoot: state.scope.configRoot,
          start: hit.start, end: hit.end, indexedHash, sourceContext: context,
          maxBytes: 16 * 1024, maxTokens: 4096 });
        throwIfAborted(signal);
        requireCurrent(request.resultId);
        return { available: true, resultId: state.resultId, hitId: request.hitId,
          file: safeLabel(hit.file), startLine: hit.startLine ?? null, endLine: hit.endLine ?? null,
          excerpt: safeText(excerpt.excerpt), truncated: excerpt.truncated,
          sourceIdentity: excerpt.sourceIdentity, fileUri: pathToFileURL(target).href };
      } catch (error) {
        retirements.capture(error);
        if (ownedCleanupIsPending(error)) throw error;
        if (['ENOENT', 'ERR_FILE_TOO_LARGE'].includes(error.code)) {
          return { available: false, resultId: state.resultId, hitId: request.hitId, reason: error.code };
        }
        throw error;
      } finally { context.clear(); }
    }, signal);
  };
  const open = async (request, { signal, onSpawn } = {}) => {
    assertTuiSearchRequest('open', request);
    return withOwnedOperation(async signal => {
      const state = requireCurrent(request.resultId), hit = state.hits.get(request.hitId);
      if (!hit) fail('ERR_TUI_SEARCH_HIT', 'Choose a hit from the current search.');
      const target = path.resolve(state.scope.configRoot, hit.file);
      await readVerifiedContainedFile(state.scope.configRoot, target, { signal, hashAlgorithm: 'sha1',
        expectedHash: request.sourceHash, maxBytes: 64 * 1024 * 1024 });
      const selected = await resolveTrustedTuiCommand({ names: ['code'], repoRoot: state.scope.configRoot,
        toolRoot, env, prefix: 'ERR_TUI_EDITOR' });
      const line = Number.isSafeInteger(hit.startLine) && hit.startLine > 0 ? hit.startLine : 1;
      const args = ['--reuse-window', '--goto', `${target}:${line}:1`];
      const child = await runTrustedTuiCommand({ selected, args, repoRoot: state.scope.configRoot,
        env, signal, onSpawn, prefix: 'ERR_TUI_EDITOR', beforeSpawn: () => {
          requireCurrent(request.resultId);
          assertNoSymlinkPath(state.scope.configRoot, target);
        }
      });
      return { opened: true, editor: 'code', resultId: state.resultId, hitId: request.hitId,
        file: safeLabel(hit.file), line, diagnostics: safeText(child.stderr).slice(0, 8192) };
    }, signal);
  };
  const status = (request, { hasPendingResources = () => false } = {}) => {
    assertTuiSearchRequest('status', request);
    let retained = false;
    try { retirements.assertSettled(); } catch { retained = true; }
    return { resourcePending: retained || pendingWork.size > 0 || hasPendingResources(), closed: disposed };
  };
  return { describe, query, continueSearch, source, open, status,
    dispose() {
      disposed = true; epoch++; for (const controller of controllers) controller.abort();
      pending = null; current = null; scopes.dispose();
      return Promise.allSettled([...pendingWork]).then(() => retirements.assertSettled());
    } };
};

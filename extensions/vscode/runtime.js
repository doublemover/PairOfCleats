const fs = require('node:fs');
const path = require('node:path');
const { createDocumentAuthority, assertQualifiedEditor } = require('./document-authority.js');
const { captureEditorFailure } = require('./editor-failure-evidence.js');

const DEFAULT_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const DEFAULT_API_TIMEOUT_MS = 5000;
const MINIMUM_NODE_VERSION = require('./editor-config-contract.json').cli.minimumNodeVersion;
const MAXIMUM_NODE_MAJOR = Number(MINIMUM_NODE_VERSION.split('.')[0]) + 1;

function resolveExternalNodeRuntime({ configuredPath = '', probe = require('node:child_process').spawnSync,
  env = process.env } = {}) {
  const fail = (reason) => ({ ok: false, message: `PairOfCleats requires external Node.js >=${MINIMUM_NODE_VERSION} <${MAXIMUM_NODE_MAJOR}. ${reason}`,
    detail: 'Install the supported Node runtime or set an absolute pairofcleats.nodePath in VS Code User Settings.' });
  const selected = String(configuredPath || '').trim() || 'node';
  if (!path.isAbsolute(selected) && isPathLike(selected)) return fail('The Node path must be absolute.');
  let command = path.isAbsolute(selected) ? selected : null;
  if (!command) {
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path');
    const suffixes = process.platform === 'win32' && !path.extname(selected) ? ['.exe'] : [''];
    for (const raw of String(env[pathKey] || '').split(path.delimiter)) {
      const directory = raw.trim().replace(/^"(.*)"$/, '$1');
      // Never resolve an implicit workspace/current-directory executable.
      if (!directory || !path.isAbsolute(directory)) continue;
      command = suffixes.map(suffix => path.join(directory, selected + suffix)).find(candidate => {
        try { return fs.statSync(candidate).isFile(); } catch { return false; }
      }) || null;
      if (command) break;
    }
  }
  if (!command) return fail('No Node executable was found on the editor process PATH.');
  let result;
  try {
    result = probe(command, ['-p', 'JSON.stringify({version:process.versions.node,execPath:process.execPath})'], {
      cwd: path.dirname(command), env, encoding: 'utf8', shell: false,
      windowsHide: true, timeout: 3000, maxBuffer: 8192
    });
  } catch (error) { return fail(`Runtime probe failed (${error.code || 'spawn failure'}).`); }
  if (result.error || result.status !== 0 || String(result.stderr || '').trim()) {
    return fail(`Runtime probe failed (${result.error?.code || (result.status === 0 ? 'unexpected diagnostics' : `exit ${result.status}`)}).`);
  }
  let evidence;
  try { evidence = JSON.parse(String(result.stdout || '')); }
  catch { return fail('Runtime probe did not return valid Node identity.'); }
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(evidence?.version || ''));
  const minimum = String(MINIMUM_NODE_VERSION).split('.').map(Number);
  if (!version || Number(version[1]) !== minimum[0]
    || Number(version[2]) < minimum[1]
    || (Number(version[2]) === minimum[1] && Number(version[3]) < minimum[2])) {
    return fail(`Selected runtime reports ${evidence?.version || 'an unknown version'}.`);
  }
  if (typeof evidence.execPath !== 'string' || !path.isAbsolute(evidence.execPath)) {
    return fail('Runtime probe did not identify an absolute executable.');
  }
  try {
    if (!fs.statSync(evidence.execPath).isFile()) return fail('The selected executable is not a file.');
    return { ok: true, command: fs.realpathSync(evidence.execPath), version: evidence.version };
  } catch { return fail('The selected executable is unavailable.'); }
}

function createChunkAccumulator(maxBytes = DEFAULT_MAX_BUFFER_BYTES) {
  const limit = Number.isFinite(Number(maxBytes)) ? Math.max(1, Number(maxBytes)) : DEFAULT_MAX_BUFFER_BYTES;
  const chunks = [];
  let size = 0;
  let truncated = false;
  return {
    push(chunk) {
      if (!chunk || truncated) return;
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const nextSize = size + value.length;
      if (nextSize > limit) {
        const remaining = limit - size;
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        size = limit;
        truncated = true;
        return;
      }
      chunks.push(value);
      size = nextSize;
    },
    text() {
      return Buffer.concat(chunks).toString('utf8');
    },
    truncated() {
      return truncated;
    },
    size() {
      return size;
    }
  };
}

function resolveConfiguredCli(repoRoot, configuredPath, extraArgs = [], defaults = {}) {
  const rawPath = String(configuredPath || '').trim();
  if (!rawPath) return { ok: true, command: defaults.command, argsPrefix: extraArgs };
  if (!isPathLike(rawPath)) {
    return {
      ok: true,
      command: rawPath,
      argsPrefix: extraArgs
    };
  }
  const resolvedPath = resolveConfigPath(repoRoot, rawPath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return {
      ok: false,
      message: `PairOfCleats CLI path does not exist: ${rawPath}`,
      detail: `Configured path resolved to ${resolvedPath || rawPath}. Update pairofcleats.cliPath or clear it to use auto-detection.`
    };
  }
  let stats = null;
  try {
    stats = fs.statSync(resolvedPath);
  } catch {}
  if (!stats || !stats.isFile()) {
    return {
      ok: false,
      message: `PairOfCleats CLI path is not a file: ${rawPath}`,
      detail: `Configured path resolved to ${resolvedPath}. Point pairofcleats.cliPath at an executable file or JS entrypoint, or clear it to use auto-detection.`
    };
  }
  if (resolvedPath.toLowerCase().endsWith(String(defaults.jsExtension || '.js').toLowerCase())) {
    const node = typeof defaults.resolveNode === 'function'
      ? defaults.resolveNode() : resolveExternalNodeRuntime({ configuredPath: defaults.nodePath });
    if (!node.ok) return node;
    return {
      ok: true,
      command: node.command,
      argsPrefix: [resolvedPath, ...extraArgs]
    };
  }
  return { ok: true, command: resolvedPath, argsPrefix: extraArgs };
}

function resolveConfigPath(repoRoot, rawPath) {
  if (!rawPath) return '';
  if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) return rawPath;
  if (repoRoot) return path.join(repoRoot, rawPath);
  return rawPath;
}

function isPathLike(rawPath) {
  return path.isAbsolute(rawPath)
    || rawPath.startsWith('.')
    || rawPath.includes('/')
    || rawPath.includes('\\');
}

function parseJsonPayload(stdout, options = {}) {
  const label = String(options.label || 'PairOfCleats command');
  const text = String(stdout || '');
  if (options.stdoutTruncated) {
    return {
      ok: false,
      kind: 'stdout-truncated',
      message: `${label} output exceeded the VS Code capture limit.`,
      detail: 'The CLI produced more JSON than the extension can safely buffer. Narrow the scope or reduce result volume.'
    };
  }
  if (!text.trim()) {
    return {
      ok: false,
      kind: 'empty-output',
      message: `${label} returned no JSON output.`,
      detail: null
    };
  }
  try {
    return {
      ok: true,
      payload: JSON.parse(text)
    };
  } catch (error) {
    return {
      ok: false,
      kind: 'invalid-json',
      message: `${label} returned invalid JSON: ${error.message}`,
      detail: text || null
    };
  }
}

function parseSearchPayload(stdout, options = {}) {
  return parseJsonPayload(stdout, {
    ...options,
    label: 'PairOfCleats search'
  });
}

function normalizeApiBaseUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    return url.toString().replace(/\/$/, '');
  } catch { return ''; }
}

function normalizeApiTimeoutMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.max(1, Math.trunc(numeric)) : DEFAULT_API_TIMEOUT_MS;
}

function summarizeApiHttpFailure(label, status, payload, fallbackText) {
  const bodyMessage = payload && typeof payload === 'object'
    ? String(payload.message || payload.error || payload.code || '').trim().slice(0, 4096)
    : '';
  if (status === 401) {
    return {
      kind: 'api-unauthorized',
      message: `${label} failed: the PairOfCleats API rejected the request as unauthorized.`,
      detail: bodyMessage || fallbackText?.slice(0, 4096) || null
    };
  }
  if (status === 403) {
    return {
      kind: 'api-forbidden',
      message: `${label} failed: the PairOfCleats API rejected the request as forbidden.`,
      detail: bodyMessage || fallbackText?.slice(0, 4096) || null
    };
  }
  return {
    kind: 'api-http-error',
    message: `${label} failed via the PairOfCleats API (HTTP ${status}).`,
    detail: bodyMessage || fallbackText?.slice(0, 4096) || null
  };
}

// Fetch exposes decoded bytes, so Content-Length is only an early admission
// hint for identity encoding. The stream remains authoritative for every body.
async function readApiResponseText(response, { signal, maxBytes = DEFAULT_MAX_BUFFER_BYTES } = {}) {
  const limit = Number.isSafeInteger(maxBytes) && maxBytes > 0
    ? Math.min(maxBytes, DEFAULT_MAX_BUFFER_BYTES) : DEFAULT_MAX_BUFFER_BYTES;
  const blocks = [];
  let block = null, used = 0, total = 0, reader = null, cancelled = false;
  const tooLarge = (incoming = null) => {
    const error = new Error(`API response exceeded the ${limit}-byte editor limit. Narrow the request or reduce result volume.`);
    error.code = 'ERR_API_RESPONSE_TOO_LARGE';
    const prefix = blocks[0] || block?.subarray(0, used) || incoming;
    error.preview = prefix ? Buffer.from(prefix.subarray(0, 4096)).toString('utf8') : '';
    return error;
  };
  const cancel = async (reason) => {
    if (cancelled) return;
    cancelled = true;
    try { await (reader ? reader.cancel(reason) : response.body?.cancel?.(reason)); } catch {}
  };
  const abort = () => { void cancel(signal.reason); };
  try {
    const length = response.headers?.get?.('content-length');
    const encoding = response.headers?.get?.('content-encoding');
    if ((!encoding || encoding.toLowerCase() === 'identity') && /^\d+$/.test(length || '') && Number(length) > limit) {
      throw tooLarge();
    }
    if (signal?.aborted) throw signal.reason;
    if (!response.body) return '';
    reader = response.body.getReader();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) throw signal.reason;
    for (;;) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw signal.reason;
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('API response stream did not supply bytes.');
      if (value.byteLength > limit - total) throw tooLarge(value);
      total += value.byteLength;
      for (let offset = 0; offset < value.byteLength;) {
        if (!block) block = Buffer.allocUnsafe(Math.min(64 * 1024, limit - (total - value.byteLength + offset)));
        const count = Math.min(block.length - used, value.byteLength - offset);
        block.set(value.subarray(offset, offset + count), used);
        used += count; offset += count;
        if (used === block.length) { blocks.push(block); block = null; used = 0; }
      }
    }
    if (used) blocks.push(block.subarray(0, used));
    const text = Buffer.concat(blocks, total).toString('utf8');
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch (error) {
    await cancel(error);
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    reader?.releaseLock();
  }
}

async function requestApiJson(baseUrl, requestPath, {
  method = 'GET',
  payload = null,
  headers = null,
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
  label = 'PairOfCleats API request',
  signal = null,
  maxResponseBytes = DEFAULT_MAX_BUFFER_BYTES
} = {}) {
  if (signal?.aborted) return { ok: false, kind: 'cancelled', message: `${label} was cancelled.` };
  const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return {
      ok: false,
      kind: 'api-misconfigured',
      message: `${label} failed: pairofcleats.apiServerUrl is not configured.`,
      detail: 'Set pairofcleats.apiServerUrl to an http:// or https:// PairOfCleats API server.'
    };
  }
  const fetchImpl = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
  if (!fetchImpl) {
    return {
      ok: false,
      kind: 'api-unavailable',
      message: `${label} failed: this VS Code runtime does not expose fetch().`,
      detail: 'Use CLI mode or upgrade the VS Code extension host runtime.'
    };
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const abort = () => controller?.abort?.(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener?.('abort', abort, { once: true });
  const timeout = setTimeout(() => controller?.abort?.(), normalizeApiTimeoutMs(timeoutMs));
  timeout.unref?.();
  try {
    const response = await fetchImpl(`${normalizedBaseUrl}${requestPath}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(payload == null ? {} : { 'Content-Type': 'application/json' }),
        ...(headers && typeof headers === 'object' ? headers : {})
      },
      body: payload == null ? undefined : JSON.stringify(payload),
      redirect: 'error',
      signal: controller?.signal
    });
    const text = await readApiResponseText(response, { signal: controller?.signal, maxBytes: maxResponseBytes });
    let body = null;
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch (error) {
        if (!response.ok) {
          return {
            ok: false,
            ...summarizeApiHttpFailure(label, response.status, null, text.trim().slice(0, 4096) || error.message)
          };
        }
        return {
          ok: false,
          kind: 'api-invalid-json',
          message: `${label} failed: PairOfCleats API returned invalid JSON.`,
          detail: text.trim().slice(0, 4096) || error.message
        };
      }
    }
    if (!response.ok) {
      return {
        ok: false,
        ...summarizeApiHttpFailure(label, response.status, body, text.trim())
      };
    }
    if (body?.ok === false) return { ok: false, kind: 'api-operation-failed',
      message: `${label} failed: the service reported an unsuccessful operation.`,
      detail: typeof body.message === 'string' ? body.message.slice(0, 4096)
        : typeof body.code === 'string' ? body.code.slice(0, 4096) : null };
    return { ok: true, payload: body || {} };
  } catch (error) {
    if (error?.code === 'ERR_API_RESPONSE_TOO_LARGE') return {
      ok: false, kind: 'api-response-too-large', message: `${label} failed: ${error.message}`,
      detail: error.preview || null
    };
    const isAbort = controller?.signal.aborted || error?.name === 'AbortError';
    return {
      ok: false,
      kind: signal?.aborted ? 'cancelled' : isAbort ? 'api-timeout' : 'api-request-error',
      message: signal?.aborted ? `${label} was cancelled.` : isAbort
        ? `${label} timed out after ${normalizeApiTimeoutMs(timeoutMs)}ms.`
        : `${label} failed: ${error?.message || error}`,
      detail: String(error?.stack || error?.message || error).slice(0, 4096)
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.('abort', abort);
  }
}

async function probeApiHealth(baseUrl, timeoutMs = DEFAULT_API_TIMEOUT_MS, headers = null) {
  return requestApiJson(baseUrl, '/health', {
    method: 'GET',
    headers,
    timeoutMs,
    label: 'PairOfCleats API health probe'
  });
}

async function probeApiCapabilities(baseUrl, timeoutMs = DEFAULT_API_TIMEOUT_MS, headers = null, signal = null) {
  const response = await requestApiJson(baseUrl, '/capabilities', {
    method: 'GET',
    headers,
    signal,
    timeoutMs,
    label: 'PairOfCleats API capability probe'
  });
  if (!response.ok) {
    return response;
  }
  const payload = response.payload && typeof response.payload === 'object'
    ? response.payload
    : {};
  const manifest = payload.runtimeManifest && typeof payload.runtimeManifest === 'object'
    ? payload.runtimeManifest
    : null;
  const capabilities = manifest?.surfaces?.api?.workflowCapabilities && typeof manifest.surfaces.api.workflowCapabilities === 'object'
    ? manifest.surfaces.api.workflowCapabilities
    : (payload.capabilities && typeof payload.capabilities === 'object' ? payload.capabilities : {});
  return {
    ok: true,
    payload,
    capabilities,
    manifest
  };
}

function summarizeProcessFailure({ code, timedOut, cancelled, stderr, stdout, stdoutTruncated, stderrTruncated, timeoutMs }) {
  if (cancelled) {
    return {
      kind: 'cancelled',
      message: 'PairOfCleats search was cancelled.',
      detail: null
    };
  }
  if (timedOut) {
    return {
      kind: 'timeout',
      message: `PairOfCleats search timed out after ${timeoutMs}ms.`,
      detail: null
    };
  }
  if (code !== 0) {
    const detail = String(stderr || stdout || '').trim();
    const truncationNote = stdoutTruncated || stderrTruncated ? '\n[output truncated]' : '';
    return {
      kind: 'nonzero-exit',
      message: `PairOfCleats search failed${Number.isFinite(code) ? ` (exit ${code})` : ''}.`,
      detail: `${detail}${truncationNote}`.trim() || null
    };
  }
  if (stdoutTruncated) {
    return {
      kind: 'truncated-output',
      message: 'PairOfCleats search output was truncated.',
      detail: 'stdout'
    };
  }
  return null;
}

function summarizeSpawnFailure(label, error) {
  return {
    kind: 'spawn-error',
    message: `${label} failed to start: ${error?.message || error}`,
    detail: String(error?.stack || error?.message || error)
  };
}

function spawnBufferedProcess(childProcessModule, command, args, options) {
  try {
    return {
      ok: true,
      child: childProcessModule.spawn(command, args, options)
    };
  } catch (error) {
    return {
      ok: false,
      error
    };
  }
}

function captureOpeningHit(original, isCurrent) {
  if (!original || typeof original !== 'object' || Array.isArray(original)) throw new Error('Search opening requires an original hit object.');
  const hit = {};
  for (const name of ['file', 'sourceHash', 'coordinateUnit', 'startLine', 'startCol', 'endLine', 'endCol']) {
    if (!isCurrent()) return null;
    const descriptor = Object.getOwnPropertyDescriptor(original, name);
    if (!isCurrent()) return null;
    if (!descriptor) {
      if (name in original) throw new Error('Search opening cannot use inherited navigation fields.');
      continue;
    }
    if (!Object.hasOwn(descriptor, 'value')) throw new Error('Search opening requires passive navigation fields.');
    hit[name] = descriptor.value;
  }
  if (typeof hit.file !== 'string' || !hit.file) throw new Error('Search opening requires an original file path.');
  if (hit.sourceHash != null && (typeof hit.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(hit.sourceHash))) throw new Error('Search source hash is invalid.');
  for (const name of ['startLine', 'startCol', 'endLine', 'endCol']) {
    if (hit[name] != null && !Number.isSafeInteger(hit[name])) throw new Error('Search opening requires integer navigation coordinates.');
  }
  return Object.freeze(hit);
}

function captureOpeningRepo(original, isCurrent) {
  if (original == null || typeof original === 'string') return Object.freeze({ repoRoot: original || null, repoUri: null });
  if (typeof original !== 'object' || Array.isArray(original)) throw new Error('Search opening requires its original repository context.');
  const captured = {};
  for (const name of ['repoRoot', 'repoUri']) {
    if (!isCurrent()) return null;
    const descriptor = Object.getOwnPropertyDescriptor(original, name);
    if (!isCurrent()) return null;
    if (!descriptor) {
      if (name in original) throw new Error('Search opening cannot use inherited repository context.');
      captured[name] = null;
    } else {
      if (!Object.hasOwn(descriptor, 'value')) throw new Error('Search opening requires passive repository context.');
      captured[name] = descriptor.value ?? null;
    }
  }
  if (captured.repoRoot !== null && typeof captured.repoRoot !== 'string'
    || captured.repoUri !== null && typeof captured.repoUri !== 'object') throw new Error('Search opening repository identity is invalid.');
  return Object.freeze(captured);
}

function openingUriIdentity(uri, isCurrent) {
  if (!uri || typeof uri !== 'object') throw new Error('Opened search document has no original URI.');
  const parts = [];
  for (const name of ['scheme', 'authority', 'path', 'fsPath']) {
    if (!isCurrent()) return null;
    const value = uri[name];
    if (!isCurrent()) return null;
    parts.push(value ?? null);
  }
  if (typeof parts[0] !== 'string' || !parts[0] || !parts.slice(1).every(value => value === null || typeof value === 'string')
    || !parts[2] && !parts[3]) throw new Error('Opened search document has no original URI identity.');
  return Object.freeze({ key: JSON.stringify(parts), scheme: parts[0] });
}

async function openSearchHit(vscodeApi, repoRoot, originalHit, { isCurrent = () => true } = {}) {
  let revoked = false, filePath = '', phase = 'open';
  const current = () => {
    if (revoked) return false;
    try { if (typeof isCurrent !== 'function' || isCurrent() !== true) revoked = true; }
    catch (error) { revoked = true; throw error; }
    return !revoked;
  };
  const cancelled = () => Object.freeze({ ok: false, kind: 'cancelled', filePath, message: 'PairOfCleats opening was superseded.' });
  try {
    if (!current()) return cancelled();
    const hit = captureOpeningHit(originalHit, current);
    if (!hit || !current()) return cancelled();
    const repoContext = captureOpeningRepo(repoRoot, current);
    if (!repoContext || !current()) return cancelled();
    if (!current()) return cancelled();
    const target = resolveValidatedHitTarget(vscodeApi, repoContext, hit);
    if (!target.ok) return target;
    filePath = target.filePath;
    const root = repoContext.repoRoot, targetIdentity = openingUriIdentity(target.targetUri, current);
    if (!current()) return cancelled();
    const workspace = vscodeApi.workspace;
    if (!current()) return cancelled();
    const window = vscodeApi.window;
    if (!current()) return cancelled();
    const open = workspace.openTextDocument;
    if (!current()) return cancelled();
    const show = window.showTextDocument;
    if (!current()) return cancelled();
    if (typeof open !== 'function' || typeof show !== 'function') throw new Error('Search opening requires original document/display callbacks.');
    const precise = hit.sourceHash && hit.coordinateUnit === 'utf16'
      && [hit.startLine, hit.startCol, hit.endLine, hit.endCol].every(value => Number.isSafeInteger(value) && value > 0);
    let document, qualified = null, authority = null, range = null;
    if (hit.sourceHash) {
      if (targetIdentity.scheme !== 'file') throw new Error('Hash-qualified source opening requires a contained local file.');
      authority = createDocumentAuthority({ workspace: { openTextDocument: uri => Reflect.apply(open, workspace, [uri]) }, isCurrent: current, maxDocuments: 1 });
      qualified = await authority.qualify({ repoRoot: root, file: filePath, uri: target.targetUri, sourceHash: hit.sourceHash,
        ...(precise ? { range: hit } : { fileOnly: true }) });
      if (!qualified || !current()) return cancelled();
      document = qualified.document;
      await authority.assertCurrent();
    } else {
      // Legacy unqualified positions are display hints. Capture them before the
      // first await; they never acquire an original-source or exact-range claim.
      range = buildHitRange(vscodeApi, hit, current);
      if (!current()) return cancelled();
      document = await Reflect.apply(open, workspace, [target.targetUri]);
    }
    if (!current()) return cancelled();
    if (!document || document.isClosed === true) throw new Error('Opened search document is unavailable.');
    const openedIdentity = openingUriIdentity(document.uri, current);
    if (!current()) return cancelled();
    if (openedIdentity.key !== targetIdentity.key) throw new Error('Opened search document URI differs from its original target.');
    const version = document.version;
    if (!current()) return cancelled();
    phase = 'navigate';
    const editor = await Reflect.apply(show, window, [document, { preview: true }]);
    if (!current()) return cancelled();
    if (authority) await authority.assertCurrent();
    if (!current()) return cancelled();
    if (!editor || editor.document !== document || document.isClosed === true || document.version !== version) throw new Error('Displayed search editor does not identify the original opened document/version.');
    const displayedIdentity = openingUriIdentity(document.uri, current);
    if (!current()) return cancelled();
    if (displayedIdentity.key !== targetIdentity.key) throw new Error('Displayed search document URI differs from its original target.');
    if (qualified) {
      assertQualifiedEditor(editor, qualified);
      if (precise) {
        const positionAt = document.positionAt;
        if (!current()) return cancelled();
        if (typeof positionAt !== 'function') throw new Error('Qualified document has no original position callback.');
        const start = Reflect.apply(positionAt, document, [qualified.offsets.start]);
        if (!current()) return cancelled();
        const end = Reflect.apply(positionAt, document, [qualified.offsets.end]);
        if (!current()) return cancelled();
        assertQualifiedEditor(editor, qualified);
        const Range = vscodeApi.Range;
        if (!current()) return cancelled();
        range = new Range(start, end);
      }
    }
    if (!current()) return cancelled();
    if (range) {
      const Selection = vscodeApi.Selection;
      if (!current()) return cancelled();
      const selection = new Selection(range.start, range.end);
      if (!current()) return cancelled();
      editor.selection = selection;
      if (!current()) return cancelled();
      if (editor.document !== document || document.isClosed === true || document.version !== version) throw new Error('Selected search editor no longer identifies the original opened document/version.');
      if (qualified) assertQualifiedEditor(editor, qualified);
      if (!current()) return cancelled();
      editor.revealRange(range, vscodeApi.TextEditorRevealType.InCenter);
    }
    return { ok: true, filePath, sourceVerified: qualified !== null, rangeApplied: range !== null,
      rangeEvidence: qualified ? precise ? 'qualified-original-utf16' : 'file-only-no-qualified-range' : 'unqualified-display-hint' };
  } catch (error) {
    const captured = captureEditorFailure(error);
    return Object.freeze({ ok: false, filePath,
      message: `PairOfCleats could not ${phase === 'open' ? 'open' : 'navigate to'} ${filePath || 'the selected source'}: ${captured.message}`,
      detail: captured.message, primaryError: error, inspectionErrors: captured.inspectionErrors });
  }
}

function resolveValidatedHitTarget(vscodeApi, repoRoot, hit) {
  const repoContext = normalizeRepoContext(repoRoot);
  const pathError = validateHitPath(repoContext, hit?.file);
  if (pathError) {
    return {
      ok: false,
      filePath: String(hit?.file || ''),
      message: pathError.message,
      detail: pathError.detail
    };
  }
  const targetUri = resolveHitUri(vscodeApi, repoContext, hit?.file);
  return {
    ok: true,
    targetUri,
    filePath: targetUri?.fsPath || targetUri?.path || String(hit?.file || '')
  };
}

function normalizeRepoContext(value) {
  if (value && typeof value === 'object' && (value.repoRoot || value.repoUri)) {
    return value;
  }
  return { repoRoot: value || null, repoUri: null };
}

function resolveHitUri(vscodeApi, repoContext, hitFile) {
  if (path.isAbsolute(hitFile)) {
    if (repoContext.repoUri && repoContext.repoUri.scheme && repoContext.repoUri.scheme !== 'file') {
      const remotePath = String(hitFile || '').replace(/\\/g, '/');
      if (typeof repoContext.repoUri.with === 'function') {
        return repoContext.repoUri.with({ path: remotePath });
      }
      if (typeof vscodeApi.Uri?.from === 'function') {
        return vscodeApi.Uri.from({
          ...repoContext.repoUri,
          path: remotePath
        });
      }
      if (typeof vscodeApi.Uri?.parse === 'function') {
        const authority = repoContext.repoUri.authority
          ? `//${repoContext.repoUri.authority}`
          : '';
        const query = repoContext.repoUri.query ? `?${repoContext.repoUri.query}` : '';
        const fragment = repoContext.repoUri.fragment ? `#${repoContext.repoUri.fragment}` : '';
        return vscodeApi.Uri.parse(`${repoContext.repoUri.scheme}:${authority}${remotePath}${query}${fragment}`);
      }
      return repoContext.repoUri;
    }
    return vscodeApi.Uri.file(hitFile);
  }
  if (repoContext.repoUri && typeof vscodeApi.Uri?.joinPath === 'function') {
    const segments = String(hitFile || '').split(/[\\/]+/).filter(Boolean);
    return vscodeApi.Uri.joinPath(repoContext.repoUri, ...segments);
  }
  return vscodeApi.Uri.file(path.join(repoContext.repoRoot || '', String(hitFile || '')));
}

function buildHitRange(vscodeApi, hit, isCurrent = () => true) {
  if (!Number.isFinite(hit?.startLine) || hit.startLine <= 0) return null;
  const startLine = Math.max(0, Number(hit.startLine) - 1);
  const startCol = Number.isFinite(hit?.startCol) && hit.startCol > 0 ? Number(hit.startCol) - 1 : 0;
  const endLine = Number.isFinite(hit?.endLine) && hit.endLine > 0
    ? Math.max(startLine, Number(hit.endLine) - 1)
    : startLine;
  const endCol = Number.isFinite(hit?.endCol) && hit.endCol > 0
    ? Math.max(endLine === startLine ? startCol : 0, Number(hit.endCol) - 1)
    : (endLine === startLine ? startCol : 0);
  const Position = vscodeApi.Position;
  if (!isCurrent()) return null;
  const Range = vscodeApi.Range;
  if (!isCurrent()) return null;
  const start = new Position(startLine, startCol);
  if (!isCurrent()) return null;
  const end = new Position(endLine, endCol);
  if (!isCurrent()) return null;
  return new Range(start, end);
}

function validateHitPath(repoContext, hitFile) {
  const rawPath = String(hitFile || '');
  if (!rawPath) {
    return {
      message: 'PairOfCleats returned an invalid result path.',
      detail: 'The selected search hit did not include a file path.'
    };
  }
  if (!path.isAbsolute(rawPath)) {
    if (!isContainedRelativePath(rawPath)) {
      return {
        message: `PairOfCleats refused to open a path outside the repo: ${rawPath}`,
        detail: 'The selected search hit escaped the repo root via relative traversal.'
      };
    }
    return null;
  }
  if (repoContext.repoUri?.scheme && repoContext.repoUri.scheme !== 'file' && repoContext.repoUri.path) {
    const normalizedRepoPath = path.posix.normalize(String(repoContext.repoUri.path || ''));
    const normalizedTargetPath = path.posix.normalize(rawPath.replace(/\\/g, '/'));
    const relative = path.posix.relative(normalizedRepoPath, normalizedTargetPath);
    if (relative !== '' && (relative.startsWith('..') || path.posix.isAbsolute(relative))) {
      return {
        message: `PairOfCleats refused to open a path outside the repo: ${rawPath}`,
        detail: `Resolved remote path is outside repo root ${normalizedRepoPath}.`
      };
    }
    return null;
  }
  if (repoContext.repoRoot && !isAbsolutePathContained(repoContext.repoRoot, rawPath)) {
    return {
      message: `PairOfCleats refused to open a path outside the repo: ${rawPath}`,
      detail: `Resolved absolute path is outside repo root ${repoContext.repoRoot}.`
    };
  }
  return null;
}

function isContainedRelativePath(rawPath) {
  const segments = String(rawPath).split(/[\\/]+/).filter(Boolean);
  let depth = 0;
  for (const segment of segments) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (depth === 0) return false;
      depth -= 1;
      continue;
    }
    depth += 1;
  }
  return true;
}

function isAbsolutePathContained(rootPath, targetPath) {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedTarget = path.resolve(targetPath);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

module.exports = {
  DEFAULT_MAX_BUFFER_BYTES,
  DEFAULT_API_TIMEOUT_MS,
  createChunkAccumulator,
  resolveConfiguredCli,
  resolveExternalNodeRuntime,
  parseJsonPayload,
  parseSearchPayload,
  normalizeApiBaseUrl,
  normalizeApiTimeoutMs,
  requestApiJson,
  probeApiHealth,
  probeApiCapabilities,
  summarizeProcessFailure,
  summarizeSpawnFailure,
  spawnBufferedProcess,
  resolveValidatedHitTarget,
  openSearchHit
};

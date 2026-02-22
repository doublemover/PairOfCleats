import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { listDiffs, showDiff } from '../../../src/index/diffs/compute.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { redactAbsolutePaths } from '../redact.js';
import { sendError, sendJson } from '../response.js';

const parseStringList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
};

const parseStringListFromSearchParams = (searchParams, keys) => {
  const values = [];
  for (const key of keys) {
    const raw = searchParams.getAll(key);
    for (const entry of raw) {
      values.push(...parseStringList(entry));
    }
  }
  return values;
};

const parsePositiveInt = (raw, label) => {
  if (raw == null || raw === '') return null;
  const normalized = String(raw).trim();
  if (!/^\d+$/.test(normalized)) {
    const err = new Error(`${label} must be a positive integer.`);
    err.code = ERROR_CODES.INVALID_REQUEST;
    throw err;
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    const err = new Error(`${label} must be a positive integer.`);
    err.code = ERROR_CODES.INVALID_REQUEST;
    throw err;
  }
  return parsed;
};

const parseDiffFormat = (raw) => {
  const normalized = String(raw || 'summary').trim().toLowerCase() || 'summary';
  if (normalized === 'summary' || normalized === 'jsonl') return normalized;
  const err = new Error('format must be "summary" or "jsonl".');
  err.code = ERROR_CODES.INVALID_REQUEST;
  throw err;
};

const parseDiffShapingOptions = (searchParams) => ({
  modes: parseStringListFromSearchParams(searchParams, ['mode', 'modes']),
  kinds: parseStringListFromSearchParams(searchParams, ['kind', 'kinds']),
  maxEvents: (
    parsePositiveInt(searchParams.get('max-events'), 'max-events')
    ?? parsePositiveInt(searchParams.get('maxEvents'), 'maxEvents')
    ?? parsePositiveInt(searchParams.get('limit'), 'limit')
  ),
  maxBytes: (
    parsePositiveInt(searchParams.get('max-bytes'), 'max-bytes')
    ?? parsePositiveInt(searchParams.get('maxBytes'), 'maxBytes')
  )
});

const shapeDiffEvents = (events, options) => {
  const list = Array.isArray(events) ? events : [];
  const modeFilter = Array.isArray(options?.modes) && options.modes.length
    ? new Set(options.modes.map((entry) => String(entry).trim()).filter(Boolean))
    : null;
  const kindFilter = Array.isArray(options?.kinds) && options.kinds.length
    ? new Set(options.kinds.map((entry) => String(entry).trim()).filter(Boolean))
    : null;
  const filtered = list.filter((entry) => {
    if (modeFilter && !modeFilter.has(String(entry?.mode || ''))) return false;
    if (kindFilter && !kindFilter.has(String(entry?.kind || ''))) return false;
    return true;
  });
  const maxEvents = Number.isFinite(Number(options?.maxEvents)) ? Number(options.maxEvents) : null;
  const maxBytes = Number.isFinite(Number(options?.maxBytes)) ? Number(options.maxBytes) : null;
  const limitedByEvents = maxEvents != null ? filtered.slice(0, maxEvents) : filtered;
  if (maxBytes == null) return limitedByEvents;
  const bounded = [];
  let bytes = 0;
  for (const event of limitedByEvents) {
    const lineBytes = Buffer.byteLength(`${JSON.stringify(event)}\n`);
    if (bytes + lineBytes > maxBytes) break;
    bounded.push(event);
    bytes += lineBytes;
  }
  return bounded;
};

const handleRepoResolveError = (res, err, corsHeaders) => {
  const code = err?.code === ERROR_CODES.FORBIDDEN ? ERROR_CODES.FORBIDDEN : ERROR_CODES.INVALID_REQUEST;
  const status = err?.code === ERROR_CODES.FORBIDDEN ? 403 : 400;
  sendError(res, status, code, err?.message || 'Invalid repo path.', {}, corsHeaders || {});
};

const decodeDiffId = (rawValue) => {
  try {
    return decodeURIComponent(rawValue || '');
  } catch {
    const err = new Error('Invalid diff id: malformed URI encoding.');
    err.code = ERROR_CODES.INVALID_REQUEST;
    throw err;
  }
};

export const handleIndexDiffsRoute = async ({
  req,
  res,
  requestUrl,
  pathname,
  corsHeaders,
  resolveRepo
}) => {
  if (pathname === '/index/diffs' && req.method === 'GET') {
    let repoPath = '';
    try {
      repoPath = await resolveRepo(requestUrl.searchParams.get('repo'));
    } catch (err) {
      handleRepoResolveError(res, err, corsHeaders);
      return true;
    }

    try {
      const userConfig = loadUserConfig(repoPath);
      const diffs = listDiffs({
        repoRoot: repoPath,
        userConfig,
        modes: parseStringListFromSearchParams(requestUrl.searchParams, ['mode', 'modes'])
      });
      sendJson(res, 200, {
        ok: true,
        diffs: redactAbsolutePaths(diffs)
      }, corsHeaders || {});
    } catch (err) {
      sendError(res, 500, ERROR_CODES.INTERNAL, 'Failed to list diffs.', {
        error: err?.message || String(err)
      }, corsHeaders || {});
    }
    return true;
  }

  const diffPrefix = '/index/diffs/';
  if (!pathname.startsWith(diffPrefix) || req.method !== 'GET') {
    return false;
  }

  let repoPath = '';
  try {
    repoPath = await resolveRepo(requestUrl.searchParams.get('repo'));
  } catch (err) {
    handleRepoResolveError(res, err, corsHeaders);
    return true;
  }

  const suffix = pathname.slice(diffPrefix.length);
  if (!suffix) return false;
  const parts = suffix.split('/').filter(Boolean);
  let diffId = '';
  try {
    diffId = decodeDiffId(parts[0] || '');
  } catch (err) {
    sendError(res, 400, ERROR_CODES.INVALID_REQUEST, err?.message || 'Invalid diff id.', {}, corsHeaders || {});
    return true;
  }
  const tail = parts.slice(1);

  if (tail.length === 1 && tail[0] === 'events') {
    try {
      const userConfig = loadUserConfig(repoPath);
      const shapeOptions = parseDiffShapingOptions(requestUrl.searchParams);
      const detail = showDiff({
        repoRoot: repoPath,
        userConfig,
        diffId,
        format: 'jsonl'
      });
      if (!detail) {
        sendError(res, 404, ERROR_CODES.NOT_FOUND, `Diff not found: ${diffId}`, {}, corsHeaders || {});
        return true;
      }
      const events = shapeDiffEvents(detail.events, shapeOptions);
      const lines = events.map((entry) => JSON.stringify(redactAbsolutePaths(entry))).join('\n');
      const body = lines ? `${lines}\n` : '';
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        ...(corsHeaders || {})
      });
      res.end(body);
    } catch (err) {
      const code = err?.code || ERROR_CODES.INTERNAL;
      const status = code === ERROR_CODES.NOT_FOUND
        ? 404
        : code === ERROR_CODES.INVALID_REQUEST
          ? 400
          : 500;
      sendError(res, status, code, err?.message || 'Failed to stream diff events.', {
        error: err?.message || String(err)
      }, corsHeaders || {});
    }
    return true;
  }

  if (tail.length === 0) {
    try {
      const userConfig = loadUserConfig(repoPath);
      const format = parseDiffFormat(requestUrl.searchParams.get('format'));
      const shapeOptions = format === 'jsonl' ? parseDiffShapingOptions(requestUrl.searchParams) : null;
      const detail = showDiff({
        repoRoot: repoPath,
        userConfig,
        diffId,
        format
      });
      if (!detail) {
        sendError(res, 404, ERROR_CODES.NOT_FOUND, `Diff not found: ${diffId}`, {}, corsHeaders || {});
        return true;
      }
      const payload = format === 'jsonl'
        ? {
          ...detail,
          events: shapeDiffEvents(detail.events, shapeOptions)
        }
        : detail;
      sendJson(res, 200, {
        ok: true,
        diff: redactAbsolutePaths(payload)
      }, corsHeaders || {});
    } catch (err) {
      const code = err?.code || ERROR_CODES.INTERNAL;
      const status = code === ERROR_CODES.NOT_FOUND
        ? 404
        : code === ERROR_CODES.INVALID_REQUEST
          ? 400
          : 500;
      sendError(res, status, code, err?.message || 'Failed to load diff.', {
        error: err?.message || String(err)
      }, corsHeaders || {});
    }
    return true;
  }

  return false;
};

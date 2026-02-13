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

const handleRepoResolveError = (res, err, corsHeaders) => {
  const code = err?.code === ERROR_CODES.FORBIDDEN ? ERROR_CODES.FORBIDDEN : ERROR_CODES.INVALID_REQUEST;
  const status = err?.code === ERROR_CODES.FORBIDDEN ? 403 : 400;
  sendError(res, status, code, err?.message || 'Invalid repo path.', {}, corsHeaders || {});
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
        modes: parseStringList(requestUrl.searchParams.get('modes'))
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
  const diffId = decodeURIComponent(parts[0] || '');
  const tail = parts.slice(1);

  if (tail.length === 1 && tail[0] === 'events') {
    try {
      const userConfig = loadUserConfig(repoPath);
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
      const events = Array.isArray(detail.events) ? detail.events : [];
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
      const detail = showDiff({
        repoRoot: repoPath,
        userConfig,
        diffId,
        format: 'summary'
      });
      if (!detail) {
        sendError(res, 404, ERROR_CODES.NOT_FOUND, `Diff not found: ${diffId}`, {}, corsHeaders || {});
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        diff: redactAbsolutePaths(detail)
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

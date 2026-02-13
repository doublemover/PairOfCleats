import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { createPointerSnapshot, listSnapshots, showSnapshot } from '../../../src/index/snapshots/create.js';
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

/**
 * Parse JSON body and emit a consistent error response on parse failure.
 *
 * Returns an explicit status object so callers can distinguish:
 * - parse failure already handled (`ok:false`)
 * - successfully parsed `null` payload (`ok:true`, `payload:null`)
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {(req: import('node:http').IncomingMessage) => Promise<any>} parseJsonBody
 * @param {object} corsHeaders
 * @returns {Promise<{ok:boolean,payload:any}>}
 */
const parseBodyOrError = async (req, res, parseJsonBody, corsHeaders) => {
  try {
    return { ok: true, payload: await parseJsonBody(req) };
  } catch (err) {
    const status = err?.code === 'ERR_BODY_TOO_LARGE'
      ? 413
      : err?.code === 'ERR_UNSUPPORTED_MEDIA_TYPE'
        ? 415
        : 400;
    sendError(
      res,
      status,
      ERROR_CODES.INVALID_REQUEST,
      err?.message || 'Invalid request body.',
      {},
      corsHeaders || {}
    );
    return { ok: false, payload: null };
  }
};

export const handleIndexSnapshotsRoute = async ({
  req,
  res,
  requestUrl,
  pathname,
  corsHeaders,
  resolveRepo,
  parseJsonBody
}) => {
  if (pathname === '/index/snapshots' && req.method === 'GET') {
    let repoPath = '';
    try {
      repoPath = await resolveRepo(requestUrl.searchParams.get('repo'));
    } catch (err) {
      handleRepoResolveError(res, err, corsHeaders);
      return true;
    }

    try {
      const userConfig = loadUserConfig(repoPath);
      const snapshots = listSnapshots({
        repoRoot: repoPath,
        userConfig
      });
      sendJson(res, 200, {
        ok: true,
        snapshots: redactAbsolutePaths(snapshots)
      }, corsHeaders || {});
    } catch (err) {
      sendError(res, 500, ERROR_CODES.INTERNAL, 'Failed to list snapshots.', {
        error: err?.message || String(err)
      }, corsHeaders || {});
    }
    return true;
  }

  if (pathname === '/index/snapshots' && req.method === 'POST') {
    const parsedBody = await parseBodyOrError(req, res, parseJsonBody, corsHeaders);
    if (!parsedBody.ok) return true;
    const payload = parsedBody.payload;
    if (payload == null) {
      sendError(
        res,
        400,
        ERROR_CODES.INVALID_REQUEST,
        'Request body cannot be empty or null.',
        {},
        corsHeaders || {}
      );
      return true;
    }

    let repoPath = '';
    try {
      repoPath = await resolveRepo(payload?.repoPath || payload?.repo || requestUrl.searchParams.get('repo'));
    } catch (err) {
      handleRepoResolveError(res, err, corsHeaders);
      return true;
    }

    try {
      const userConfig = loadUserConfig(repoPath);
      const created = await createPointerSnapshot({
        repoRoot: repoPath,
        userConfig,
        label: typeof payload?.label === 'string' ? payload.label : null,
        tags: parseStringList(payload?.tags),
        modes: parseStringList(payload?.modes),
        snapshotId: typeof payload?.snapshotId === 'string' ? payload.snapshotId : null,
        waitMs: Number.isFinite(Number(payload?.waitMs)) ? Math.max(0, Math.floor(Number(payload.waitMs))) : 0
      });
      sendJson(res, 200, {
        ok: true,
        snapshot: redactAbsolutePaths(created)
      }, corsHeaders || {});
    } catch (err) {
      const code = err?.code || ERROR_CODES.INTERNAL;
      const status = code === ERROR_CODES.NOT_FOUND
        ? 404
        : code === ERROR_CODES.INVALID_REQUEST
          ? 400
          : code === ERROR_CODES.QUEUE_OVERLOADED
            ? 429
            : 500;
      sendError(res, status, code, err?.message || 'Failed to create snapshot.', {
        error: err?.message || String(err)
      }, corsHeaders || {});
    }
    return true;
  }

  const snapshotPrefix = '/index/snapshots/';
  if (pathname.startsWith(snapshotPrefix) && req.method === 'GET') {
    const snapshotId = decodeURIComponent(pathname.slice(snapshotPrefix.length));
    if (!snapshotId) return false;

    let repoPath = '';
    try {
      repoPath = await resolveRepo(requestUrl.searchParams.get('repo'));
    } catch (err) {
      handleRepoResolveError(res, err, corsHeaders);
      return true;
    }

    try {
      const userConfig = loadUserConfig(repoPath);
      const snapshot = showSnapshot({
        repoRoot: repoPath,
        userConfig,
        snapshotId
      });
      if (!snapshot) {
        sendError(res, 404, ERROR_CODES.NOT_FOUND, `Snapshot not found: ${snapshotId}`, {}, corsHeaders || {});
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        snapshot: redactAbsolutePaths(snapshot)
      }, corsHeaders || {});
    } catch (err) {
      const code = err?.code || ERROR_CODES.INTERNAL;
      const status = code === ERROR_CODES.NOT_FOUND
        ? 404
        : code === ERROR_CODES.INVALID_REQUEST
          ? 400
          : 500;
      sendError(res, status, code, err?.message || 'Failed to load snapshot.', {
        error: err?.message || String(err)
      }, corsHeaders || {});
    }
    return true;
  }

  return false;
};

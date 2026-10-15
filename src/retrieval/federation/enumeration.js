import { createHash } from 'node:crypto';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { stableStringify } from '../../shared/stable-json.js';

const invalid = (message) => createError(ERROR_CODES.INVALID_REQUEST, message);
const keys = { code: 'code', prose: 'prose', 'extracted-prose': 'extractedProse', records: 'records' };
export const withoutCursor = (args) => {
  const result = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--cursor') { i += 1; continue; }
    if (args[i].startsWith('--cursor=')) continue;
    result.push(args[i]);
  }
  return result;
};

/** One repository/mode page per request keeps work and cursor state bounded. */
export const enumerateWorkspace = async ({ tasks, args, cursor, manifestHash, search, signal, verifyGeneration }) => {
  const identity = createHash('sha256').update(stableStringify({
    tasks: tasks.map(({ repo, mode }) => [repo.repoId, mode]), args
  })).digest('hex');
  let position = 0;
  let localCursor = null;
  let timeAnchor = Date.now();
  if (cursor) {
    let decoded;
    try {
      if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,16384}$/.test(cursor)) throw new Error();
      decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    } catch { throw invalid('Invalid workspace cursor. Restart without --cursor.'); }
    if (decoded.version !== 1 || decoded.identity !== identity || decoded.generation !== manifestHash) {
      throw invalid('Workspace filters, selection or indexed generation changed. Restart without --cursor.');
    }
    if (!Number.isSafeInteger(decoded.position) || decoded.position < 0 || decoded.position >= tasks.length
      || !Number.isSafeInteger(decoded.timeAnchor) || decoded.timeAnchor < 0
      || (decoded.localCursor !== null && typeof decoded.localCursor !== 'string')) throw invalid('Invalid workspace cursor position.');
    position = decoded.position;
    localCursor = decoded.localCursor;
    timeAnchor = decoded.timeAnchor;
  }
  signal?.throwIfAborted();
  const output = { ok: true, backend: 'federated', code: [], prose: [], extractedProse: [], records: [], repos: [] };
  const task = tasks[position];
  if (task) {
    // Override the CLI mode once, preserving the ordinary search owner and its cursor checks.
    const modeArgs = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '--mode') { i += 1; continue; }
      if (args[i] === '--modified-since' || args[i].startsWith('--modified-since=')) {
        const days = Number(args[i].includes('=') ? args[i].split('=')[1] : args[++i]);
        const after = timeAnchor - days * 86400000;
        if (!Number.isFinite(after) || days < 0 || Math.abs(after) > 8.64e15) throw invalid('Invalid modified-since interval.');
        modeArgs.push('--modified-after', new Date(after).toISOString());
        continue;
      }
      if (!args[i].startsWith('--mode=')) modeArgs.push(args[i]);
    }
    const result = await search(task.repo.repoRootCanonical, {
      args: [...modeArgs, '--mode', task.mode, ...(localCursor ? ['--cursor', localCursor] : [])],
      emitOutput: false, exitOnError: false, signal
    });
    if (!result?.pagination) throw invalid('Repository did not return structured enumeration metadata.');
    const key = keys[task.mode];
    output[key] = (result[key] || []).map((hit) => ({ ...hit,
      repoId: task.repo.repoId, repoAlias: task.repo.alias || null,
      globalId: `${task.repo.repoId}:${hit.chunkUid || hit.id}`
    }));
    output.repos.push({ repoId: task.repo.repoId, mode: task.mode, pagination: result.pagination });
    localCursor = result.pagination.nextCursor || null;
    if (!localCursor) position += 1;
  }
  await verifyGeneration();
  const hasMore = position < tasks.length;
  output.pagination = {
    order: 'repository-mode-indexed-order',
    returned: Object.values(keys).reduce((sum, key) => sum + output[key].length, 0),
    hasMore,
    nextCursor: hasMore ? Buffer.from(JSON.stringify({ version: 1, identity, generation: manifestHash, position, localCursor, timeAnchor })).toString('base64url') : null
  };
  return output;
};

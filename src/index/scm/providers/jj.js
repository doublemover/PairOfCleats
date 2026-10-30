import fsSync from 'node:fs';
import path from 'node:path';
import PQueue from 'p-queue';
import { runScmCommand } from '../runner.js';
import { acquireScmReadOperation, createScmReadSession, getScmReadSessionConfig } from '../read-session.js';
import { inspectScmFileInventory, unavailableScmFileInventory, scmFileInventoryReceipt } from '../file-inventory.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { getScmRuntimeConfig } from '../runtime.js';
import { toUniqueRepoPosixFiles } from '../paths.js';
import { toPosix } from '../../../shared/file-paths.js';
import { findUpwards } from '../../../shared/fs/find-upwards.js';
import { createWarnOnce } from '../../../shared/logging/warn-once.js';
import { log } from '../../../shared/progress-runtime.js';
import {
  normalizeJjPathList,
  parseJjFileListOutput,
  parseJjHeadOutput,
  parseJjJsonLines
} from './jj-parse.js';

const warnOnce = createWarnOnce();

const logState = {
  provider: false,
  version: false,
  mode: false,
  roots: new Set()
};
let logVersionPromise = null;

let jjQueue = null;
let jjQueueConcurrency = null;
const jjFileMetaCache = new Map();
const DEFAULT_CHANGED_FILES_MAX = 10000;
const JJ_FILE_META_CACHE_MAX_ENTRIES = 50000;
const JJ_METADATA_CAPABILITIES = Object.freeze({
  author: true,
  time: true,
  branch: false,
  churn: true,
  commitId: true,
  changeId: true,
  operationId: true,
  bookmarks: true,
  annotateCommitId: false
});

const resolveJjConfig = (session = null) => {
  const config = (session ? getScmReadSessionConfig(session) : getScmRuntimeConfig()) || {};
  const annotateConfig = config.annotate || {};
  const jjConfig = config.jj || {};
  const maxConcurrentProcesses = Number.isFinite(Number(config.maxConcurrentProcesses))
    ? Math.max(1, Math.floor(Number(config.maxConcurrentProcesses)))
    : 8;
  const timeoutMs = Number.isFinite(Number(config.timeoutMs)) && Number(config.timeoutMs) > 0
    ? Math.floor(Number(config.timeoutMs))
    : 4000;
  const annotateTimeoutMs = Number.isFinite(Number(annotateConfig.timeoutMs))
    ? Math.max(1, Math.floor(Number(annotateConfig.timeoutMs)))
    : 10000;
  const maxAnnotateBytes = Number.isFinite(Number(annotateConfig.maxFileSizeBytes))
    ? Math.max(0, Math.floor(Number(annotateConfig.maxFileSizeBytes)))
    : null;
  const churnWindowCommits = Number.isFinite(Number(config.churnWindowCommits))
    ? Math.max(1, Math.floor(Number(config.churnWindowCommits)))
    : 10;
  const snapshotWorkingCopy = jjConfig.snapshotWorkingCopy === true;
  return {
    maxConcurrentProcesses,
    timeoutMs,
    annotateTimeoutMs,
    maxAnnotateBytes,
    churnWindowCommits,
    snapshotWorkingCopy,
    maxChangedFiles: DEFAULT_CHANGED_FILES_MAX
  };
};

const getQueue = (concurrency) => {
  if (!Number.isFinite(concurrency) || concurrency <= 0) return null;
  if (jjQueue && jjQueueConcurrency === concurrency) return jjQueue;
  jjQueueConcurrency = concurrency;
  jjQueue = new PQueue({ concurrency });
  return jjQueue;
};

const normalizeRepoCacheRoot = (repoRoot) => {
  if (!repoRoot || typeof repoRoot !== 'string') return null;
  const resolved = path.resolve(repoRoot);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const buildJjFileMetaCacheKey = ({ repoRoot, filePosix, includeChurn, headId }) => {
  const normalizedRoot = normalizeRepoCacheRoot(repoRoot);
  const normalizedPath = toPosix(String(filePosix || ''));
  const normalizedHeadId = typeof headId === 'string' && headId.trim()
    ? headId.trim()
    : null;
  if (!normalizedRoot || !normalizedPath || !normalizedHeadId) return null;
  return `${normalizedRoot}|${normalizedPath}|${includeChurn === true ? '1' : '0'}|${normalizedHeadId}`;
};

const pruneJjFileMetaCache = () => {
  while (jjFileMetaCache.size > JJ_FILE_META_CACHE_MAX_ENTRIES) {
    const oldest = jjFileMetaCache.keys().next()?.value;
    if (!oldest) break;
    jjFileMetaCache.delete(oldest);
  }
};

const readJjFileMetaCache = ({ repoRoot, filePosix, includeChurn, headId }) => {
  const key = buildJjFileMetaCacheKey({
    repoRoot,
    filePosix,
    includeChurn,
    headId
  });
  if (!key) return null;
  const cached = jjFileMetaCache.get(key);
  if (!cached || typeof cached !== 'object') return null;
  jjFileMetaCache.delete(key);
  jjFileMetaCache.set(key, cached);
  return { ...cached };
};

const writeJjFileMetaCache = ({ repoRoot, filePosix, includeChurn, headId, meta }) => {
  const key = buildJjFileMetaCacheKey({
    repoRoot,
    filePosix,
    includeChurn,
    headId
  });
  if (!key || !meta || typeof meta !== 'object') return;
  jjFileMetaCache.set(key, { ...meta });
  pruneJjFileMetaCache();
};

const toBatchFileMeta = (meta) => ({
  lastCommitId: meta?.lastCommitId || null,
  lastModifiedAt: meta?.lastModifiedAt || null,
  lastAuthor: meta?.lastAuthor || null,
  churn: Number.isFinite(meta?.churn) ? meta.churn : null,
  churnAdded: Number.isFinite(meta?.churnAdded) ? meta.churnAdded : null,
  churnDeleted: Number.isFinite(meta?.churnDeleted) ? meta.churnDeleted : null,
  churnCommits: Number.isFinite(meta?.churnCommits) ? meta.churnCommits : null
});

const buildBaseArgs = ({ operation, ignoreWorkingCopy }) => {
  const args = ['--no-pager', '--color=never', '--quiet'];
  if (operation) args.push(`--at-operation=${operation}`);
  if (ignoreWorkingCopy) args.push('--ignore-working-copy');
  return args;
};

const runJjRaw = async ({ repoRoot, args, timeoutMs, useQueue = true, signal, config = resolveJjConfig() }) => {
  const queue = useQueue ? getQueue(config.maxConcurrentProcesses) : null;
  const run = () => runScmCommand('jj', args, {
    cwd: repoRoot,
    outputMode: 'string',
    captureStdout: true,
    captureStderr: true,
    rejectOnNonZeroExit: false,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : config.timeoutMs,
    signal
  });
  return queue ? queue.add(run) : run();
};

const logJjInfo = async (repoRoot, config) => {
  if (!logState.provider) {
    logState.provider = true;
    log('[scm] provider=jj');
  }
  if (repoRoot && !logState.roots.has(repoRoot)) {
    logState.roots.add(repoRoot);
    if (logState.roots.size > 128) logState.roots.delete(logState.roots.values().next().value);
    log(`[scm] jj root: ${repoRoot}`);
  }
  if (!logState.mode) {
    logState.mode = true;
    const mode = config.snapshotWorkingCopy ? 'snapshot' : 'read-only';
    log(`[scm] jj pinning mode: ${mode}`);
  }
  if (!logState.version) {
    if (!logVersionPromise) {
      logVersionPromise = (async () => {
        const result = await runJjRaw({
          repoRoot,
          args: ['--no-pager', '--color=never', '--quiet', '--version'],
          timeoutMs: 2000,
          useQueue: false
        });
        if (result.exitCode === 0) {
          const version = String(result.stdout || '').trim();
          if (version) log(`[scm] jj version: ${version}`);
        }
        logState.version = true;
      })().finally(() => {
        logVersionPromise = null;
      });
    }
    await logVersionPromise;
  }
};

const ensurePinnedOperation = async (repoRoot, config, session) => {
  return acquireScmReadOperation(session, repoRoot, async signal => {
    if (config.snapshotWorkingCopy) {
      const snapshotArgs = [
        ...buildBaseArgs({ operation: null, ignoreWorkingCopy: false }),
        'status',
        '--config',
        'snapshot.auto-track=none()'
      ];
      const snapshotResult = await runJjRaw({
        repoRoot,
        args: snapshotArgs,
        timeoutMs: config.timeoutMs,
        useQueue: true, signal, config
      });
      if (!inspectScmFileInventory(snapshotResult, { provider: 'jj', operation: 'snapshot', framing: 'raw' }).complete) {
        throw Object.assign(new Error('JJ working-copy snapshot acquisition failed.'), { code: 'ERR_SCM_OPERATION_UNAVAILABLE', result: snapshotResult });
      }
    }
    const opLogArgs = [
      ...buildBaseArgs({ operation: null, ignoreWorkingCopy: true }),
      'op',
      'log',
      '--no-graph',
      '-n',
      '1',
      '-T',
      'id'
    ];
    const opResult = await runJjRaw({
      repoRoot,
      args: opLogArgs,
      timeoutMs: config.timeoutMs,
      useQueue: true, signal, config
    });
    const opId = String(opResult.stdout || '').trim();
    if (!inspectScmFileInventory(opResult, { provider: 'jj', operation: 'operation-pin', framing: 'raw' }).complete
      || !/^[a-f0-9]{16,128}$/i.test(opId)) throw Object.assign(
      new Error('JJ immutable operation acquisition failed.'), { code: 'ERR_SCM_OPERATION_UNAVAILABLE', result: opResult });
    return opId;
  });
};

const runJjCommand = async ({ repoRoot, args, timeoutMs, signal, scmReadSession }) => {
  const config = resolveJjConfig(scmReadSession);
  await logJjInfo(repoRoot, config);
  const operation = await ensurePinnedOperation(repoRoot, config, scmReadSession);
  const baseArgs = buildBaseArgs({
    operation,
    ignoreWorkingCopy: !config.snapshotWorkingCopy
  });
  return runJjRaw({
    repoRoot,
    args: [...baseArgs, ...args],
    timeoutMs,
    signal,
    useQueue: true, config
  });
};

const toJjFileset = (relPath) => {
  const raw = toPosix(String(relPath || ''));
  if (!raw) return null;
  if (raw.includes('\0')) {
    throw new Error('JJ fileset paths may not contain NUL.');
  }
  const escaped = raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `root-file:"${escaped}"`;
};

// Serialize each value rather than relying on object literals introduced after
// JJ 0.38. JSON escaping belongs to JJ; each revision emits one complete row.
const jsonRowTemplate = fields => fields.map(([key, expression], index) => (
  `${JSON.stringify(`${index ? ',' : '{'}${JSON.stringify(key)}:`)} ++ json(${expression})`
)).join(' ++ ') + ' ++ "}\\n"';

const toUniquePosixFiles = (filesPosix = [], repoRoot = null) => toUniqueRepoPosixFiles(filesPosix, {
  repoRoot,
  rejectEscape: Boolean(repoRoot)
});

export const jjProvider = {
  name: 'jj',
  adapter: 'experimental',
  metadataCapabilities: JJ_METADATA_CAPABILITIES,
  detect({ startPath }) {
    const repoRoot = findJjRoot(startPath || process.cwd());
    return repoRoot ? { ok: true, provider: 'jj', repoRoot, detectedBy: 'jj-root' } : { ok: false };
  },
  async listTrackedFiles({ repoRoot, subdir = null, signal = null, scmReadSession = createScmReadSession({ repoRoot, signal }) }) {
    throwIfAborted(signal);
    const nulResult = await runJjCommand({
      repoRoot, scmReadSession,
      args: ['file', 'list', '--tracked', '-0', '-r', '@'], signal
    });
    throwIfAborted(signal);
    let output = nulResult.stdout;
    let nullDelimited = true;
    let inventory = inspectScmFileInventory(nulResult, { provider: 'jj', operation: 'tracked' });
    if (nulResult.exitCode !== 0) {
      if (nulResult.signal !== null) return unavailableScmFileInventory(inventory);
      warnOnce('jj-file-list-nul', '[scm] jj file list -0 failed; falling back to newline output.');
      const lineResult = await runJjCommand({
        repoRoot, scmReadSession,
        args: ['file', 'list', '-r', '@'], signal
      });
      throwIfAborted(signal);
      inventory = inspectScmFileInventory(lineResult, { provider: 'jj', operation: 'tracked', framing: 'line' });
      output = lineResult.stdout;
      nullDelimited = false;
    }
    if (!inventory.complete) return unavailableScmFileInventory(inventory);
    const entries = parseJjFileListOutput({ output, nullDelimited });
    const { filesPosix } = normalizeJjPathList({ entries, repoRoot, subdir });
    return { complete: true, inventory, filesPosix };
  },
  async getRepoProvenance({ repoRoot, signal = null, scmReadSession = createScmReadSession({ repoRoot, signal }) }) {
    const config = resolveJjConfig(scmReadSession);
    const operationId = await ensurePinnedOperation(repoRoot, config, scmReadSession);
    const template = jsonRowTemplate([
      ['commit_id', 'commit_id'], ['change_id', 'change_id'], ['author', 'author.name()'],
      ['timestamp', 'author.timestamp().utc().format("%Y-%m-%dT%H:%M:%SZ")']
    ]);
    const logResult = await runJjCommand({
      repoRoot, scmReadSession, signal,
      args: ['log', '--no-graph', '-n', '1', '-r', '@', '-T', template]
    });
    const bookmarksResult = await runJjCommand({
      repoRoot, scmReadSession, signal,
      args: ['log', '--no-graph', '-n', '1', '-r', '@', '-T', 'bookmarks']
    });
    const parsedHead = parseJjHeadOutput({
      logOutput: logResult.exitCode === 0 ? logResult.stdout : '',
      bookmarksOutput: bookmarksResult.exitCode === 0 ? bookmarksResult.stdout : ''
    });
    const commitId = parsedHead.commitId;
    const changeId = parsedHead.changeId;
    const author = parsedHead.author;
    const timestamp = parsedHead.timestamp;
    const bookmarks = parsedHead.bookmarks;
    let dirty = null;
    const dirtyResult = await runJjCommand({
      repoRoot, scmReadSession, signal,
      args: ['diff', '-r', '@', '--name-only'],
      timeoutMs: config.timeoutMs
    });
    if (dirtyResult.exitCode === 0) {
      dirty = parseJjFileListOutput({ output: dirtyResult.stdout, nullDelimited: false }).length > 0;
    }
    return {
      provider: 'jj',
      root: repoRoot,
      head: {
        commitId,
        changeId,
        operationId: operationId && operationId !== '@' ? operationId : null,
        author,
        timestamp,
        branch: null,
        bookmarks
      },
      dirty,
      detectedBy: 'jj-root',
      commit: commitId,
      branch: null,
      isRepo: true,
      bookmarks
    };
  },
  async getChangedFiles({ repoRoot, fromRef = null, toRef = null, subdir = null, signal = null, scmReadSession = createScmReadSession({ repoRoot, signal }) }) {
    throwIfAborted(signal);
    if (!fromRef && !toRef) {
      return { ok: false, reason: 'unsupported' };
    }
    const config = resolveJjConfig(scmReadSession);
    const args = ['diff', '--name-only'];
    if (fromRef) args.push('--from', fromRef);
    if (toRef) args.push('--to', toRef);
    const result = await runJjCommand({ repoRoot, args, signal, scmReadSession });
    throwIfAborted(signal);
    const inventory = inspectScmFileInventory(result, { provider: 'jj', operation: 'changed', framing: 'line' });
    if (!inventory.complete) return unavailableScmFileInventory(inventory);
    const entries = parseJjFileListOutput({ output: result.stdout, nullDelimited: false });
    const { filesPosix, truncated } = normalizeJjPathList({
      entries,
      repoRoot,
      subdir,
      maxCount: config.maxChangedFiles
    });
    if (truncated) {
      warnOnce(
        'jj-changed-files-truncated',
        `[scm] jj changed files truncated to ${config.maxChangedFiles} entries.`
      );
      return unavailableScmFileInventory(scmFileInventoryReceipt({ provider: 'jj', operation: 'changed',
        reason: 'record-limit', capture: inventory.capture }));
    }
    return { complete: true, inventory, filesPosix };
  },
  async getFileMeta({ repoRoot, filePosix, timeoutMs, includeChurn = true, headId = null, signal = null, scmReadSession = createScmReadSession({ repoRoot, signal }) }) {
    const cached = readJjFileMetaCache({
      repoRoot,
      filePosix,
      includeChurn,
      headId
    });
    if (cached) return cached;
    const config = resolveJjConfig(scmReadSession);
    const fileset = toJjFileset(filePosix);
    if (!fileset) return { ok: false, reason: 'unavailable' };
    const filesetLiteral = JSON.stringify(fileset);
    const template = jsonRowTemplate([
      ['commit_id', 'commit_id'], ['author', 'author.name()'],
      ['timestamp', 'author.timestamp().utc().format("%Y-%m-%dT%H:%M:%SZ")'],
      ...(includeChurn ? [['added', `self.diff(${filesetLiteral}).stat().total_added()`],
        ['removed', `self.diff(${filesetLiteral}).stat().total_removed()`]] : [])
    ]);
    const result = await runJjCommand({
      repoRoot, scmReadSession, signal,
      args: ['log', '--no-graph', '-n', includeChurn ? String(config.churnWindowCommits) : '1', '-T', template, fileset],
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : config.timeoutMs
    });
    if (result.exitCode !== 0) {
      return { ok: false, reason: 'unavailable' };
    }
    const rows = parseJjJsonLines(result.stdout);
    if (!rows.length) {
      return { ok: false, reason: 'unavailable' };
    }
    const first = rows[0] || {};
    let churnAdded = 0;
    let churnDeleted = 0;
    let churnCommits = 0;
    if (includeChurn) {
      for (const row of rows) {
        churnCommits += 1;
        const added = Number(row?.added) || 0;
        const removed = Number(row?.removed) || 0;
        churnAdded += Number.isFinite(added) ? added : 0;
        churnDeleted += Number.isFinite(removed) ? removed : 0;
      }
    }
    const resolved = {
      lastCommitId: first.commit_id || null,
      lastModifiedAt: first.timestamp || null,
      lastAuthor: first.author || null,
      churn: includeChurn ? churnAdded + churnDeleted : null,
      churnAdded: includeChurn ? churnAdded : null,
      churnDeleted: includeChurn ? churnDeleted : null,
      churnCommits: includeChurn ? churnCommits : null
    };
    writeJjFileMetaCache({
      repoRoot,
      filePosix,
      includeChurn,
      headId,
      meta: resolved
    });
    return resolved;
  },
  async getFileMetaBatch({ repoRoot, filesPosix, timeoutMs, includeChurn = true, headId = null, signal = null, scmReadSession = createScmReadSession({ repoRoot, signal }) }) {
    const config = resolveJjConfig(scmReadSession);
    const normalizedFiles = toUniquePosixFiles(filesPosix, repoRoot);
    const fileMetaByPath = Object.create(null);
    if (!normalizedFiles.length) return { fileMetaByPath };
    const uncached = [];
    for (const filePosix of normalizedFiles) {
      const cached = readJjFileMetaCache({
        repoRoot,
        filePosix,
        includeChurn,
        headId
      });
      if (cached) {
        fileMetaByPath[filePosix] = toBatchFileMeta(cached);
      } else {
        uncached.push(filePosix);
      }
    }
    if (uncached.length) {
      const queue = new PQueue({
        concurrency: Math.max(1, Math.min(config.maxConcurrentProcesses, uncached.length))
      });
      await Promise.all(uncached.map((filePosix) => queue.add(async () => {
        const meta = await this.getFileMeta({
          repoRoot, scmReadSession, signal,
          filePosix,
          timeoutMs,
          includeChurn,
          headId
        });
        if (!meta || meta.ok === false) return;
        fileMetaByPath[filePosix] = toBatchFileMeta(meta);
      })));
    }
    return { fileMetaByPath };
  },
  async annotate({ repoRoot, filePosix, timeoutMs, signal, scmReadSession = createScmReadSession({ repoRoot, signal }) }) {
    const config = resolveJjConfig(scmReadSession);
    const fileset = toJjFileset(filePosix);
    if (!fileset) return { ok: false, reason: 'unavailable' };
    const template = 'commit.author().name()';
    const result = await runJjCommand({
      repoRoot, scmReadSession,
      args: ['file', 'annotate', '-T', template, fileset],
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : config.annotateTimeoutMs,
      signal
    });
    if (result.exitCode !== 0) {
      return { ok: false, reason: 'unavailable' };
    }
    const rawLines = String(result.stdout || '').split(/\r?\n/);
    if (rawLines.length && rawLines[rawLines.length - 1] === '') rawLines.pop();
    const lines = rawLines.map((author, index) => ({
      line: index + 1,
      author: String(author || '').trim() || 'unknown'
    }));
    return { lines };
  }
};

const findJjRoot = (startPath) => {
  return findUpwards(
    startPath || process.cwd(),
    (candidateDir) => fsSync.existsSync(path.join(candidateDir, '.jj'))
  );
};

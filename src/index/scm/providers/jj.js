import fsSync from 'node:fs';
import path from 'node:path';
import PQueue from 'p-queue';
import { runScmCommand } from '../runner.js';
import { getScmRuntimeConfig } from '../runtime.js';
import { toPosix } from '../../../shared/files.js';
import { findUpwards } from '../../../shared/fs/find-upwards.js';
import { createWarnOnce } from '../../../shared/logging/warn-once.js';
import { log } from '../../../shared/progress.js';
import {
  normalizeJjPathList,
  parseJjFileListOutput,
  parseJjJsonLines
} from './jj-parse.js';

const warnOnce = createWarnOnce();

const logState = {
  provider: false,
  version: false,
  mode: false,
  roots: new Set()
};

let jjQueue = null;
let jjQueueConcurrency = null;
const pinnedOperations = new Map();
const snapshotPromises = new Map();
const DEFAULT_CHANGED_FILES_MAX = 10000;

const resolveJjConfig = () => {
  const config = getScmRuntimeConfig() || {};
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

const buildBaseArgs = ({ operation, ignoreWorkingCopy }) => {
  const args = ['--no-pager', '--color=never', '--quiet'];
  if (operation) args.push(`--at-operation=${operation}`);
  if (ignoreWorkingCopy) args.push('--ignore-working-copy');
  return args;
};

const runJjRaw = async ({ repoRoot, args, timeoutMs, useQueue = true, signal }) => {
  const config = resolveJjConfig();
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
    log(`[scm] jj root: ${repoRoot}`);
  }
  if (!logState.mode) {
    logState.mode = true;
    const mode = config.snapshotWorkingCopy ? 'snapshot' : 'read-only';
    log(`[scm] jj pinning mode: ${mode}`);
  }
  if (!logState.version) {
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
  }
};

const ensurePinnedOperation = async (repoRoot, config) => {
  if (!config.snapshotWorkingCopy) return '@';
  const resolvedRoot = path.resolve(repoRoot);
  const existing = pinnedOperations.get(resolvedRoot);
  if (existing) return existing;
  const inFlight = snapshotPromises.get(resolvedRoot);
  if (inFlight) return inFlight;
  const snapshotPromise = (async () => {
    const snapshotArgs = [
      ...buildBaseArgs({ operation: null, ignoreWorkingCopy: false }),
      'op',
      'snapshot',
      '--config',
      'snapshot.auto-track=none()'
    ];
    const snapshotResult = await runJjRaw({
      repoRoot,
      args: snapshotArgs,
      timeoutMs: config.timeoutMs,
      useQueue: true
    });
    if (snapshotResult.exitCode !== 0) {
      warnOnce('jj-snapshot', '[scm] jj snapshot failed; falling back to @');
      pinnedOperations.set(resolvedRoot, '@');
      return '@';
    }
    const opLogArgs = [
      ...buildBaseArgs({ operation: null, ignoreWorkingCopy: false }),
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
      useQueue: true
    });
    const opId = String(opResult.stdout || '').trim();
    const resolved = opResult.exitCode === 0 && opId ? opId : '@';
    pinnedOperations.set(resolvedRoot, resolved);
    return resolved;
  })().finally(() => {
    snapshotPromises.delete(resolvedRoot);
  });
  snapshotPromises.set(resolvedRoot, snapshotPromise);
  return snapshotPromise;
};

const runJjCommand = async ({ repoRoot, args, timeoutMs, signal }) => {
  const config = resolveJjConfig();
  await logJjInfo(repoRoot, config);
  const operation = await ensurePinnedOperation(repoRoot, config);
  const baseArgs = buildBaseArgs({
    operation,
    ignoreWorkingCopy: !config.snapshotWorkingCopy
  });
  return runJjRaw({
    repoRoot,
    args: [...baseArgs, ...args],
    timeoutMs,
    signal,
    useQueue: true
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

const toUniquePosixFiles = (filesPosix = [], repoRoot = null) => {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(filesPosix) ? filesPosix : []) {
    const normalized = toPosix(String(raw || ''));
    if (!normalized) continue;
    const key = repoRoot
      ? toPosix(path.relative(repoRoot, path.join(repoRoot, normalized)))
      : normalized;
    if (!key || key.startsWith('../') || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
};

export const jjProvider = {
  name: 'jj',
  detect({ startPath }) {
    const repoRoot = findJjRoot(startPath || process.cwd());
    return repoRoot ? { ok: true, provider: 'jj', repoRoot, detectedBy: 'jj-root' } : { ok: false };
  },
  async listTrackedFiles({ repoRoot, subdir = null }) {
    const nulResult = await runJjCommand({
      repoRoot,
      args: ['file', 'list', '--tracked', '-0', '-r', '@']
    });
    let output = nulResult.stdout;
    let nullDelimited = true;
    if (nulResult.exitCode !== 0) {
      warnOnce('jj-file-list-nul', '[scm] jj file list -0 failed; falling back to newline output.');
      const lineResult = await runJjCommand({
        repoRoot,
        args: ['file', 'list', '-r', '@']
      });
      if (lineResult.exitCode !== 0) {
        return { ok: false, reason: 'unavailable' };
      }
      output = lineResult.stdout;
      nullDelimited = false;
    }
    const entries = parseJjFileListOutput({ output, nullDelimited });
    const { filesPosix } = normalizeJjPathList({ entries, repoRoot, subdir });
    return { filesPosix };
  },
  async getRepoProvenance({ repoRoot }) {
    const config = resolveJjConfig();
    const operationId = config.snapshotWorkingCopy
      ? await ensurePinnedOperation(repoRoot, config)
      : null;
    const template = [
      'json({',
      '"commit_id": commit_id.short(12),',
      '"change_id": change_id.short(12),',
      '"author": author.name(),',
      '"timestamp": author.timestamp().utc().format("%Y-%m-%dT%H:%M:%SZ")',
      '})'
    ].join(' ');
    const logResult = await runJjCommand({
      repoRoot,
      args: ['log', '--no-graph', '-n', '1', '-r', '@', '-T', template]
    });
    const rows = logResult.exitCode === 0 ? parseJjJsonLines(logResult.stdout) : [];
    const headRow = rows[0] || {};
    const commitId = headRow.commit_id || null;
    const changeId = headRow.change_id || null;
    const author = headRow.author || null;
    const timestamp = headRow.timestamp || null;
    let bookmarks = null;
    const bookmarksResult = await runJjCommand({
      repoRoot,
      args: ['log', '--no-graph', '-n', '1', '-r', '@', '-T', 'bookmarks']
    });
    if (bookmarksResult.exitCode === 0) {
      const raw = String(bookmarksResult.stdout || '').trim();
      if (raw) {
        bookmarks = raw
          .replace(/[\[\]]/g, ' ')
          .split(/[\s,]+/)
          .filter(Boolean);
      }
    }
    let dirty = null;
    const dirtyResult = await runJjCommand({
      repoRoot,
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
  async getChangedFiles({ repoRoot, fromRef = null, toRef = null, subdir = null }) {
    if (!fromRef && !toRef) {
      return { ok: false, reason: 'unsupported' };
    }
    const config = resolveJjConfig();
    const args = ['diff', '--name-only'];
    if (fromRef) args.push('--from', fromRef);
    if (toRef) args.push('--to', toRef);
    const result = await runJjCommand({ repoRoot, args });
    if (result.exitCode !== 0) {
      return { ok: false, reason: 'unavailable' };
    }
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
    }
    return { filesPosix };
  },
  async getFileMeta({ repoRoot, filePosix, timeoutMs, includeChurn = true }) {
    const config = resolveJjConfig();
    const fileset = toJjFileset(filePosix);
    if (!fileset) return { ok: false, reason: 'unavailable' };
    const filesetLiteral = JSON.stringify(fileset);
    const template = includeChurn
      ? [
        'json({',
        '"author": author.name(),',
        '"timestamp": author.timestamp().utc().format("%Y-%m-%dT%H:%M:%SZ"),',
        `"added": self.diff(${filesetLiteral}).stat().total_added(),`,
        `"removed": self.diff(${filesetLiteral}).stat().total_removed()`,
        '})'
      ].join(' ')
      : [
        'json({',
        '"author": author.name(),',
        '"timestamp": author.timestamp().utc().format("%Y-%m-%dT%H:%M:%SZ")',
        '})'
      ].join(' ');
    const result = await runJjCommand({
      repoRoot,
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
    return {
      lastModifiedAt: first.timestamp || null,
      lastAuthor: first.author || null,
      churn: includeChurn ? churnAdded + churnDeleted : null,
      churnAdded: includeChurn ? churnAdded : null,
      churnDeleted: includeChurn ? churnDeleted : null,
      churnCommits: includeChurn ? churnCommits : null
    };
  },
  async getFileMetaBatch({ repoRoot, filesPosix, timeoutMs, includeChurn = true }) {
    const normalizedFiles = toUniquePosixFiles(filesPosix, repoRoot);
    const fileMetaByPath = Object.create(null);
    if (!normalizedFiles.length) return { fileMetaByPath };
    for (const filePosix of normalizedFiles) {
      const meta = await this.getFileMeta({
        repoRoot,
        filePosix,
        timeoutMs,
        includeChurn
      });
      if (!meta || meta.ok === false) continue;
      fileMetaByPath[filePosix] = {
        lastModifiedAt: meta.lastModifiedAt || null,
        lastAuthor: meta.lastAuthor || null,
        churn: Number.isFinite(meta.churn) ? meta.churn : null,
        churnAdded: Number.isFinite(meta.churnAdded) ? meta.churnAdded : null,
        churnDeleted: Number.isFinite(meta.churnDeleted) ? meta.churnDeleted : null,
        churnCommits: Number.isFinite(meta.churnCommits) ? meta.churnCommits : null
      };
    }
    return { fileMetaByPath };
  },
  async annotate({ repoRoot, filePosix, timeoutMs, signal }) {
    const config = resolveJjConfig();
    const fileset = toJjFileset(filePosix);
    if (!fileset) return { ok: false, reason: 'unavailable' };
    const template = 'commit.author().name()';
    const result = await runJjCommand({
      repoRoot,
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

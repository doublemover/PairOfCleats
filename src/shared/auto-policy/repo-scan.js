import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIgnoreMatcher } from '../../index/build/ignore.js';
import { formatBytes } from './profile.js';

const DEFAULT_SCAN_LIMITS = {
  maxFiles: 250000,
  maxBytes: 5 * 1024 * 1024 * 1024
};
const DEFAULT_SCAN_STAT_CONCURRENCY = 32;
const DEFAULT_SCAN_PROGRESS_INTERVAL_MS = 1000;
const REPO_STATS_MEMO_TTL_MS = 5 * 60 * 1000;
const REPO_STATS_MEMO_MAX_ENTRIES = 256;
const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  '.pairofcleats',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage'
]);
const repoStatsMemo = new Map();

const pruneRepoStatsMemo = (nowMs = Date.now()) => {
  for (const [key, entry] of repoStatsMemo.entries()) {
    const at = Number(entry?.at || 0);
    if (!Number.isFinite(at) || (nowMs - at) > REPO_STATS_MEMO_TTL_MS) {
      repoStatsMemo.delete(key);
    }
  }
  while (repoStatsMemo.size > REPO_STATS_MEMO_MAX_ENTRIES) {
    const oldestKey = repoStatsMemo.keys().next().value;
    if (oldestKey == null) break;
    repoStatsMemo.delete(oldestKey);
  }
};

const normalizePositiveInt = (value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
};

const createAsyncLimiter = (maxConcurrency) => {
  const max = Math.max(1, Math.floor(Number(maxConcurrency) || 1));
  let active = 0;
  const waiters = [];
  const release = () => {
    active = Math.max(0, active - 1);
    const next = waiters.shift();
    if (typeof next === 'function') next();
  };
  const acquire = () => {
    if (active < max) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      waiters.push(() => {
        active += 1;
        resolve();
      });
    });
  };
  return async (fn) => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
};

const buildRepoStatsMemoKey = (repoRoot, limits, ignoreFingerprint) => {
  const resolvedRoot = path.resolve(String(repoRoot || ''));
  const maxFiles = Number.isFinite(Number(limits?.maxFiles))
    ? Math.max(1, Math.floor(Number(limits.maxFiles)))
    : DEFAULT_SCAN_LIMITS.maxFiles;
  const maxBytes = Number.isFinite(Number(limits?.maxBytes))
    ? Math.max(1, Math.floor(Number(limits.maxBytes)))
    : DEFAULT_SCAN_LIMITS.maxBytes;
  return `${resolvedRoot}::${maxFiles}::${maxBytes}::ignore:${ignoreFingerprint}`;
};

export const scanRepoStats = async (repoRoot, limits = {}, options = {}) => {
  pruneRepoStatsMemo();
  const ignoreFingerprint = options?.ignoreMatcher ? options.ignoreMatcher.policyFingerprint : 'default-heavy-directory-policy-v1';
  const memoKey = ignoreFingerprint ? buildRepoStatsMemoKey(repoRoot, limits, ignoreFingerprint) : null;
  const cached = memoKey ? repoStatsMemo.get(memoKey) : null;
  const now = Date.now();
  if (cached && (now - Number(cached.at || 0)) <= REPO_STATS_MEMO_TTL_MS && cached.value) {
    return { ...cached.value };
  }
  const maxFiles = Number.isFinite(limits.maxFiles) ? limits.maxFiles : DEFAULT_SCAN_LIMITS.maxFiles;
  const maxBytes = Number.isFinite(limits.maxBytes) ? limits.maxBytes : DEFAULT_SCAN_LIMITS.maxBytes;
  const statConcurrency = normalizePositiveInt(limits.statConcurrency, DEFAULT_SCAN_STAT_CONCURRENCY, 1, 128);
  const dirConcurrency = normalizePositiveInt(
    limits.dirConcurrency,
    Math.max(2, Math.min(16, Math.ceil(statConcurrency / 4))),
    1,
    64
  );
  const progressIntervalMs = normalizePositiveInt(
    options.progressIntervalMs,
    DEFAULT_SCAN_PROGRESS_INTERVAL_MS,
    100,
    60_000
  );
  const logger = typeof options.logger === 'function' ? options.logger : null;
  const ignoreMatcher = options.ignoreMatcher && typeof options.ignoreMatcher.ignores === 'function'
    ? options.ignoreMatcher
    : null;
  let fileCount = 0;
  let totalBytes = 0;
  let truncated = false;
  let dirsScanned = 0;
  const startedAt = Date.now();
  let lastProgressAt = startedAt;

  const logScan = (message) => {
    if (!logger) return;
    logger(`[init] auto policy scan: ${message}`);
  };
  const logProgress = (force = false) => {
    if (!logger) return;
    const nextNow = Date.now();
    if (!force && nextNow - lastProgressAt < progressIntervalMs) return;
    lastProgressAt = nextNow;
    logScan(
      `${fileCount.toLocaleString()} files, ${formatBytes(totalBytes)} ` +
      `across ${dirsScanned.toLocaleString()} directories`
    );
  };

  logScan(
    `starting (maxFiles=${maxFiles.toLocaleString()}, maxBytes=${formatBytes(maxBytes)}, ` +
    `statConcurrency=${statConcurrency}, dirConcurrency=${dirConcurrency})`
  );
  const toRelPosix = (targetPath) => path.relative(repoRoot, targetPath).replaceAll(path.sep, '/');
  const shouldIgnore = (targetPath, isDir) => {
    if (!ignoreMatcher) return false;
    const relPosix = toRelPosix(targetPath);
    if (!relPosix || relPosix === '.' || relPosix.startsWith('..')) return false;
    const lookup = isDir ? `${relPosix}/` : relPosix;
    return ignoreMatcher.ignores(lookup);
  };
  // Internal incidental-scan budgets bound directories and queued work as well
  // as successful file/byte observations. They are reported, not public knobs.
  const maxScanEntries=Math.max(1024,Math.min(1000000,Math.ceil(maxFiles*4)));
  const maxDirectories=50000;
  const maxFrontier=4096;
  const maxPendingStats=Math.max(1,statConcurrency*2);
  const stack=[repoRoot];
  const pendingStats=new Set();
  const statLimiter=createAsyncLimiter(statConcurrency);
  let entriesScanned=0,readErrors=0,peakPendingStats=0,peakFrontier=1;
  let truncatedBy=null;
  const stop=reason=>{truncated=true;truncatedBy ||= reason;};
  const admitStat=async filePath=>{
    while(pendingStats.size>=maxPendingStats)await Promise.race(pendingStats);
    if(truncated)return;
    if(fileCount>=maxFiles){stop('max-files');return;}
    fileCount+=1;
    let task;
    task=statLimiter(async()=>{
      if(truncated)return;
      try {
        const stat=await fs.stat(filePath);
        totalBytes+=stat.size||0;
        if(totalBytes>=maxBytes)stop('max-bytes');
      }catch{readErrors+=1;}
    }).finally(()=>pendingStats.delete(task));
    pendingStats.add(task);
    peakPendingStats=Math.max(peakPendingStats,pendingStats.size);
  };
  while(stack.length&&!truncated){
    const batch=stack.splice(-Math.min(dirConcurrency,stack.length));
    await Promise.all(batch.map(async current=>{
      if(truncated)return;
      if(dirsScanned>=maxDirectories){stop('max-directories');return;}
      dirsScanned+=1;
      try {
        const directory=await fs.opendir(current,{bufferSize:64});
        for await(const entry of directory){
          if(truncated)break;
          if(entriesScanned>=maxScanEntries){stop('max-entries');break;}
          entriesScanned+=1;
          const entryPath=path.join(current,entry.name);
          if(entry.isDirectory()){
            if((!ignoreMatcher&&IGNORE_DIRS.has(entry.name))||shouldIgnore(entryPath,true))continue;
            if(stack.length>=maxFrontier){stop('max-frontier');break;}
            stack.push(entryPath);peakFrontier=Math.max(peakFrontier,stack.length);
          }else if(entry.isFile()&&!shouldIgnore(entryPath,false))await admitStat(entryPath);
          else if(entry.isSymbolicLink())readErrors+=1;
        }
      }catch{readErrors+=1;}
    }));
    logProgress();
  }
  await Promise.all(pendingStats);

  const huge = fileCount >= 200000 || totalBytes >= 5 * 1024 * 1024 * 1024;
  logProgress(true);
  logScan(
    `done in ${Math.max(0, Date.now() - startedAt)}ms ` +
    `(files=${fileCount.toLocaleString()}, bytes=${formatBytes(totalBytes)}, ` +
    `truncated=${truncated ? 'yes' : 'no'}, huge=${huge ? 'yes' : 'no'})`
  );
  const complete=!truncated&&readErrors===0;
  const summary={fileCount,totalBytes,truncated,huge,complete,unknownSize:!complete,
    sizeClassification:complete?(huge?'huge':'observed'):'unknown',truncatedBy,readErrors,
    entriesScanned,dirsScanned,peakPendingStats,peakFrontier,
    scanBudgets:{maxScanEntries,maxDirectories,maxFrontier,maxPendingStats}};
  if(memoKey && complete) repoStatsMemo.set(memoKey, {
    at: Date.now(),
    value: summary
  });
  pruneRepoStatsMemo();
  return summary;
};

export const resolveAutoPolicyIgnoreMatcher = async (repoRoot, config, logger) => {
  if (!repoRoot) return null;
  try {
    const ignore = await buildIgnoreMatcher({ root: repoRoot, userConfig: config });
    if (typeof logger === 'function' && Array.isArray(ignore.ignoreFiles) && ignore.ignoreFiles.length) {
      logger(`[init] auto policy scan: loaded ignore files (${ignore.ignoreFiles.join(', ')})`);
    }
    return ignore.ignoreMatcher || null;
  } catch (err) {
    if (typeof logger === 'function') {
      logger(
        `[warn] auto policy scan ignore setup failed: ${err?.message || err}; ` +
        'using fallback ignore matcher for core heavy directories.'
      );
    }
    return {
      ignores(lookup) {
        const normalized = String(lookup || '').replace(/\\/g, '/').replace(/\/+$/, '');
        if (!normalized) return false;
        const firstSegment = normalized.split('/')[0];
        return IGNORE_DIRS.has(firstSegment);
      }
    };
  }
};

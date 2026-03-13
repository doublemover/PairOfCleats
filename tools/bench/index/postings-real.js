#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { getRepoId } from '../../shared/dict-utils.js';
import { loadChunkMeta, MAX_JSON_BYTES } from '../../../src/shared/artifact-io.js';
import { resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';
import { stableStringifyForSignature } from '../../../src/shared/stable-json.js';
import { sha1 } from '../../../src/shared/hash.js';
import { spawnSubprocessSync } from '../../../src/shared/subprocess.js';

const parseArgs = () => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
};

const readJsonFields = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.fields) {
    return parsed.fields;
  }
  return parsed;
};

const safeRm = async (dir) => {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {}
};

const runNodeScript = ({ scriptPath, args, env, cwd }) => {
  const result = spawnSubprocessSync(process.execPath, [scriptPath, ...args], {
    cwd,
    env,
    outputEncoding: 'utf8',
    captureStdout: true,
    captureStderr: true,
    outputMode: 'string',
    rejectOnNonZeroExit: false,
    killTree: true,
    detached: process.platform !== 'win32'
  });
  if (result.exitCode === 0) return;
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  throw new Error(`Script failed: ${path.basename(scriptPath)} (${result.exitCode ?? 'unknown'})`);
};

const args = parseArgs();
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const fileCount = Number.isFinite(Number(args.count)) ? Math.max(1, Math.floor(Number(args.count))) : 500;
const seed = typeof args.seed === 'string' && args.seed.trim() ? args.seed.trim() : 'postings-real';
const threadsBaseline = Number.isFinite(Number(args['threads-baseline']))
  ? Math.max(1, Math.floor(Number(args['threads-baseline'])))
  : 1;
const threadsCurrent = Number.isFinite(Number(args['threads-current']))
  ? Math.max(1, Math.floor(Number(args['threads-current'])))
  : 8;

const benchRoot = args.root
  ? path.resolve(String(args.root))
  : path.join(process.cwd(), '.benchCache', 'postings-real');
const fixtureRoot = args.repo
  ? path.resolve(String(args.repo))
  : path.join(benchRoot, 'fixture');
const cacheBaselineRoot = path.join(benchRoot, 'baseline');
const cacheCurrentRoot = path.join(benchRoot, 'current');

const ensureFixture = async () => {
  const generator = path.join(process.cwd(), 'tests', 'fixtures', 'medium', 'generate.js');
  if (!fsSync.existsSync(generator)) {
    throw new Error(`Missing fixture generator at ${generator}`);
  }
  await fs.mkdir(benchRoot, { recursive: true });
  await safeRm(fixtureRoot);
  await fs.mkdir(fixtureRoot, { recursive: true });
  runNodeScript({
    scriptPath: generator,
    args: ['--out', fixtureRoot, '--count', String(fileCount), '--seed', seed],
    env: process.env,
    cwd: process.cwd()
  });
};

const resolveBuildRoot = async ({ cacheRoot }) => {
  const versionedCacheRoot = resolveVersionedCacheRoot(cacheRoot);
  const repoId = getRepoId(fixtureRoot);
  const repoCacheRoot = path.join(versionedCacheRoot, 'repos', repoId);
  const currentPath = path.join(repoCacheRoot, 'builds', 'current.json');
  const raw = await fs.readFile(currentPath, 'utf8');
  const data = JSON.parse(raw) || {};
  const buildId = typeof data.buildId === 'string' ? data.buildId : null;
  const buildRootRaw = typeof data.buildRoot === 'string' ? data.buildRoot : null;
  const buildRoot = buildRootRaw
    ? (path.isAbsolute(buildRootRaw) ? buildRootRaw : path.join(repoCacheRoot, buildRootRaw))
    : (buildId ? path.join(repoCacheRoot, 'builds', buildId) : null);
  if (!buildRoot) throw new Error('Missing buildRoot in current.json');
  return {
    repoId,
    repoCacheRoot,
    currentPath,
    buildRoot
  };
};

const readPostingsStepMs = async ({ repoCacheRoot }) => {
  const stageAuditPath = path.join(repoCacheRoot, 'metrics', 'stage-audit-code-multi.json');
  if (!fsSync.existsSync(stageAuditPath)) return null;
  const summary = await readJsonFields(stageAuditPath);
  const checkpoints = Array.isArray(summary?.checkpoints) ? summary.checkpoints : [];
  const findCheckpoint = (stage, step) => {
    for (let i = checkpoints.length - 1; i >= 0; i -= 1) {
      const entry = checkpoints[i];
      if (entry?.stage === stage && entry?.step === step) return entry;
    }
    return null;
  };
  const processing = findCheckpoint('stage1', 'processing');
  const relations = findCheckpoint('stage2', 'relations');
  const postings = findCheckpoint('stage1', 'postings');
  const prevElapsed = Number.isFinite(relations?.elapsedMs)
    ? relations.elapsedMs
    : (Number.isFinite(processing?.elapsedMs) ? processing.elapsedMs : null);
  const postingsElapsed = Number.isFinite(postings?.elapsedMs) ? postings.elapsedMs : null;
  if (prevElapsed == null || postingsElapsed == null) return null;
  return Math.max(0, postingsElapsed - prevElapsed);
};

const readQueueStats = async ({ repoCacheRoot }) => {
  const metricsPath = path.join(repoCacheRoot, 'metrics', 'index-code.json');
  if (!fsSync.existsSync(metricsPath)) return null;
  const metrics = await readJsonFields(metricsPath);
  return metrics?.queues?.postings || null;
};

const runOnce = async ({ label, cacheRoot, threads }) => {
  await safeRm(cacheRoot);
  await fs.mkdir(cacheRoot, { recursive: true });
  const env = {
    ...process.env,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot
  };
  const buildIndexPath = path.join(process.cwd(), 'build_index.js');
  const buildArgs = [
    '--mode',
    'code',
    '--stage',
    'stage1',
    '--threads',
    String(threads),
    '--stub-embeddings',
    '--scm-provider',
    'none',
    '--repo',
    fixtureRoot,
    '--quiet',
    '--progress',
    'off'
  ];

  const start = performance.now();
  runNodeScript({ scriptPath: buildIndexPath, args: buildArgs, env, cwd: fixtureRoot });
  const totalMs = performance.now() - start;

  const { repoCacheRoot, buildRoot } = await resolveBuildRoot({ cacheRoot });
  const indexDir = path.join(buildRoot, 'index-code');
  const chunkMeta = await loadChunkMeta(indexDir, { maxBytes: MAX_JSON_BYTES, strict: false });
  const chunks = Array.isArray(chunkMeta) ? chunkMeta.length : 0;
  const postingsMs = await readPostingsStepMs({ repoCacheRoot });
  const postingsThroughput = postingsMs && postingsMs > 0 ? chunks / (postingsMs / 1000) : null;
  const totalThroughput = totalMs > 0 ? chunks / (totalMs / 1000) : 0;
  const queueStats = await readQueueStats({ repoCacheRoot });
  const queueHash = queueStats ? sha1(stableStringifyForSignature(queueStats)) : null;

  return {
    label,
    threads,
    totalMs,
    postingsMs,
    chunks,
    totalThroughput,
    postingsThroughput,
    queueHash,
    queueStats
  };
};

const formatResult = (result, baseline = null) => {
  const parts = [
    `threads=${result.threads}`,
    `chunks=${result.chunks}`,
    `total=${result.totalMs.toFixed(1)}ms`,
    `totalTp=${result.totalThroughput.toFixed(2)}/s`
  ];
  if (result.postingsMs != null) {
    parts.push(`postings=${result.postingsMs.toFixed(1)}ms`);
    if (result.postingsThroughput != null) {
      parts.push(`postingsTp=${result.postingsThroughput.toFixed(2)}/s`);
    }
  }
  if (result.queueHash) {
    parts.push(`queueHash=${result.queueHash.slice(0, 8)}`);
  }
  if (baseline) {
    const delta = result.totalMs - baseline.totalMs;
    const pct = baseline.totalMs > 0 ? (delta / baseline.totalMs) * 100 : 0;
    parts.push(`delta=${delta.toFixed(1)}ms (${pct.toFixed(1)}%)`);
  }
  return parts.join(' ');
};

await ensureFixture();

let baseline = null;
let current = null;
if (mode !== 'current') {
  baseline = await runOnce({ label: 'baseline', cacheRoot: cacheBaselineRoot, threads: threadsBaseline });
  console.log(`[bench] baseline ${formatResult(baseline)}`);
}
if (mode !== 'baseline') {
  current = await runOnce({ label: 'current', cacheRoot: cacheCurrentRoot, threads: threadsCurrent });
  console.log(`[bench] current ${formatResult(current, baseline)}`);
}
if (baseline && current) {
  const delta = current.totalMs - baseline.totalMs;
  const pct = baseline.totalMs > 0 ? (delta / baseline.totalMs) * 100 : 0;
  console.log(`[bench] delta ms=${delta.toFixed(1)} (${pct.toFixed(1)}%)`);
}

const summary = {
  generatedAt: new Date().toISOString(),
  fixture: {
    seed,
    fileCount,
    root: fixtureRoot
  },
  stage: 'stage1',
  mode: 'code',
  baseline,
  current
};
console.log(JSON.stringify(summary, null, 2));

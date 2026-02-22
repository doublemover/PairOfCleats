import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalizePathForRepo } from '../../../src/shared/path-normalize.js';

const toPosix = (value) => String(value || '').replace(/\\/g, '/');

const normalizeCoveragePath = (urlOrPath, root) => {
  if (!urlOrPath) return null;
  const raw = String(urlOrPath);
  if (raw.startsWith('node:')) return null;
  if (raw.startsWith('internal/')) return null;
  if (raw.startsWith('file://')) {
    try {
      const filePath = fileURLToPath(raw);
      return normalizePathForRepo(filePath, root, { stripDot: true });
    } catch {
      return null;
    }
  }
  return normalizePathForRepo(raw, root, { stripDot: true });
};

const toRounded = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(3));
};

const iterFunctionRanges = (functions) => {
  const out = [];
  const fnList = Array.isArray(functions) ? functions : [];
  for (let fnIndex = 0; fnIndex < fnList.length; fnIndex += 1) {
    const fn = fnList[fnIndex];
    const ranges = Array.isArray(fn?.ranges) ? fn.ranges : [];
    for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
      const range = ranges[rangeIndex];
      const start = Number(range?.startOffset);
      const end = Number(range?.endOffset);
      const stableKey = Number.isFinite(start) && Number.isFinite(end)
        ? `${start}:${end}`
        : `${fnIndex}:${rangeIndex}`;
      out.push({
        key: stableKey,
        covered: Number(range?.count) > 0
      });
    }
  }
  return out;
};

const readCoverageJsonSafe = async (filePath) => {
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`[coverage] skipping malformed coverage file: ${filePath} (${error?.message || error})`);
    return null;
  }
};

export const collectV8CoverageEntries = async ({ root, coverageDir }) => {
  if (!coverageDir || !fs.existsSync(coverageDir)) return [];
  const files = (await fsPromises.readdir(coverageDir))
    .filter((name) => name.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));

  const byPath = new Map();
  for (const fileName of files) {
    const coveragePath = path.join(coverageDir, fileName);
    const payload = await readCoverageJsonSafe(coveragePath);
    if (!payload) continue;
    const rows = Array.isArray(payload?.result) ? payload.result : [];
    for (const row of rows) {
      const normalizedPath = normalizeCoveragePath(row?.url, root);
      if (!normalizedPath) continue;
      const existing = byPath.get(normalizedPath) || new Map();
      for (const range of iterFunctionRanges(row?.functions)) {
        const wasCovered = existing.get(range.key) === true;
        existing.set(range.key, wasCovered || range.covered);
      }
      byPath.set(normalizedPath, existing);
    }
  }

  return Array.from(byPath.entries())
    .map(([entryPath, rangeMap]) => {
      const totalRanges = rangeMap.size;
      let coveredRanges = 0;
      for (const covered of rangeMap.values()) {
        if (covered === true) coveredRanges += 1;
      }
      return {
        path: toPosix(entryPath),
        coveredRanges: toRounded(coveredRanges),
        totalRanges: toRounded(totalRanges)
      };
    })
    .filter((entry) => entry.totalRanges > 0)
    .sort((a, b) => a.path.localeCompare(b.path));
};

export const mergeCoverageEntries = (coverageArtifacts) => {
  const byPath = new Map();
  for (const artifact of Array.isArray(coverageArtifacts) ? coverageArtifacts : []) {
    const entries = Array.isArray(artifact?.entries) ? artifact.entries : [];
    for (const entry of entries) {
      const key = toPosix(entry?.path || '');
      if (!key) continue;
      const existing = byPath.get(key) || { coveredRanges: 0, totalRanges: 0 };
      const totalRanges = Math.max(0, Number(entry?.totalRanges || 0));
      const coveredRangesRaw = Math.max(0, Number(entry?.coveredRanges || 0));
      const coveredRanges = totalRanges > 0
        ? Math.min(coveredRangesRaw, totalRanges)
        : coveredRangesRaw;
      existing.coveredRanges += coveredRanges;
      existing.totalRanges += totalRanges;
      byPath.set(key, existing);
    }
  }
  return Array.from(byPath.entries())
    .map(([entryPath, metrics]) => ({
      path: entryPath,
      coveredRanges: toRounded(metrics.coveredRanges),
      totalRanges: toRounded(metrics.totalRanges)
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
};

export const loadCoverageArtifactsFromPath = async (inputPath) => {
  if (!inputPath) return [];
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) return [];
  const stat = await fsPromises.stat(resolved);
  const jsonFiles = stat.isDirectory()
    ? (await fsPromises.readdir(resolved))
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(resolved, name))
      .sort((a, b) => a.localeCompare(b))
    : [resolved];
  const out = [];
  for (const filePath of jsonFiles) {
    try {
      const payload = JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
      out.push(payload);
    } catch {}
  }
  return out;
};

export const filterCoverageEntriesToChanged = ({ entries, root }) => {
  const diff = spawnSync('git', ['diff', '--name-only', 'HEAD'], {
    cwd: root,
    encoding: 'utf8'
  });
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8'
  });
  if (diff.status !== 0 || untracked.status !== 0) {
    return Array.isArray(entries) ? entries : [];
  }
  const changed = new Set(
    `${String(diff.stdout || '')}\n${String(untracked.stdout || '')}`
      .split(/\r?\n/)
      .map((line) => toPosix(line.trim()))
      .filter(Boolean)
  );
  if (!changed.size) return [];
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => changed.has(toPosix(entry.path)));
};

export const buildCoverageArtifact = ({ runId, entries }) => {
  const sortedEntries = (Array.isArray(entries) ? entries : []).slice().sort((a, b) => a.path.localeCompare(b.path));
  const summary = sortedEntries.reduce((acc, entry) => {
    acc.files += 1;
    acc.coveredRanges += Number(entry.coveredRanges || 0);
    acc.totalRanges += Number(entry.totalRanges || 0);
    return acc;
  }, { files: 0, coveredRanges: 0, totalRanges: 0 });
  summary.coveredRanges = toRounded(summary.coveredRanges);
  summary.totalRanges = toRounded(summary.totalRanges);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runId,
    pathPolicy: 'repo-relative-posix',
    kind: 'v8-range-summary',
    summary,
    entries: sortedEntries
  };
};

export const writeCoverageArtifact = async ({ artifact, outputPath }) => {
  const resolved = path.resolve(outputPath);
  await fsPromises.mkdir(path.dirname(resolved), { recursive: true });
  await fsPromises.writeFile(resolved, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return resolved;
};

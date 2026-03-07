#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const candidates = [];
const seenCandidatePaths = new Set();

const isWithinRoot = (candidatePath) => {
  if (!candidatePath) return false;
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const readPrefix = async (filePath, maxBytes) => {
  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const { size } = await handle.stat();
      const readBytes = Math.min(size, maxBytes);
      const buffer = Buffer.alloc(readBytes);
      await handle.read(buffer, 0, readBytes, 0);
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return '';
  }
};

const readSuffix = async (filePath, maxBytes) => {
  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const { size } = await handle.stat();
      const readBytes = Math.min(size, maxBytes);
      const buffer = Buffer.alloc(readBytes);
      const start = Math.max(0, size - readBytes);
      await handle.read(buffer, 0, readBytes, start);
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return '';
  }
};

const isFailureLog = async (filePath) => {
  const prefix = await readPrefix(filePath, 4096);
  if (/\bexit:\s*[1-9]\d*/i.test(prefix)) return true;
  if (/\bFailed:/i.test(prefix) || /\buncaughtException\b/i.test(prefix)) return true;
  const suffix = await readSuffix(filePath, 8192);
  if (/\bFailed:/i.test(suffix) || /\buncaughtException\b/i.test(suffix)) return true;
  return false;
};

const addCandidate = async (filePath) => {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return;
    const normalized = path.resolve(filePath);
    if (seenCandidatePaths.has(normalized)) return;
    seenCandidatePaths.add(normalized);
    candidates.push({ path: filePath, mtimeMs: stat.mtimeMs });
  } catch {
    // ignore missing or unreadable paths
  }
};

const collectLogs = async (dirPath) => {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await collectLogs(nextPath);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.log')) continue;
    await addCandidate(nextPath);
  }
};

const collectLatestLogs = async () => {
  const latestPointerPath = path.join(root, '.testLogs', 'latest');
  let latestStat = null;
  try {
    latestStat = await fs.stat(latestPointerPath);
  } catch {
    return;
  }

  // Backward compatibility: older runs may still use a directory at `.testLogs/latest`.
  if (latestStat.isDirectory()) {
    await collectLogs(latestPointerPath);
    return;
  }
  if (!latestStat.isFile()) return;

  let pointer = '';
  try {
    pointer = String(await fs.readFile(latestPointerPath, 'utf8')).trim();
  } catch {
    return;
  }
  if (!pointer) return;

  const resolvedTarget = path.resolve(root, pointer);
  if (!isWithinRoot(resolvedTarget)) {
    return;
  }
  let targetStat = null;
  try {
    targetStat = await fs.stat(resolvedTarget);
  } catch {
    return;
  }

  if (targetStat.isDirectory()) {
    await collectLogs(resolvedTarget);
    return;
  }
  if (targetStat.isFile() && resolvedTarget.toLowerCase().endsWith('.log')) {
    await addCandidate(resolvedTarget);
  }
};

await collectLatestLogs();

if (!candidates.length) {
  const searchRoots = [
    path.join(root, '.testLogs'),
    path.join(root, 'tests', '.logs'),
    path.join(root, 'benchmarks', 'results')
  ];
  for (const dirPath of searchRoots) {
    await collectLogs(dirPath);
  }
}

if (!candidates.length) {
  console.error('No log files found.');
  process.exit(1);
}

const failures = [];
for (const entry of candidates) {
  if (await isFailureLog(entry.path)) {
    failures.push(entry);
  }
}

const pick = (list) => list.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
const selected = failures.length ? pick(failures) : pick(candidates);
if (!selected || !fsSync.existsSync(selected.path)) {
  console.error('No log files found.');
  process.exit(1);
}
console.error(selected.path);

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

export const formatBytes = (bytes) => {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0B';
  if (value < KB) return `${Math.round(value)}B`;
  if (value < MB) return `${(value / KB).toFixed(1)}KB`;
  if (value < GB) return `${(value / MB).toFixed(1)}MB`;
  return `${(value / GB).toFixed(1)}GB`;
};

const resolveExistingPath = (targetPath) => {
  if (!targetPath) return null;
  let current = path.resolve(targetPath);
  while (true) {
    if (fs.existsSync(current)) {
      try {
        const stat = fs.statSync(current);
        return stat.isFile() ? path.dirname(current) : current;
      } catch {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

export async function getDiskFreeBytes(targetPath) {
  const existing = resolveExistingPath(targetPath);
  if (!existing) return null;
  try {
    const stats = await fsPromises.statfs(existing);
    if (!stats) return null;
    const free = Number(stats.bavail) * Number(stats.bsize);
    return Number.isFinite(free) ? free : null;
  } catch {
    return null;
  }
}

export async function estimateDirBytes(targetPath, options = {}) {
  const dir = resolveExistingPath(targetPath);
  if (!dir) return { bytes: 0, truncated: false };
  const maxEntries = Number.isFinite(Number(options.maxEntries))
    ? Math.max(1, Math.floor(Number(options.maxEntries)))
    : 200000;
  let total = 0;
  let seen = 0;
  let truncated = false;
  const pending = [dir];
  while (pending.length) {
    const current = pending.pop();
    let entries = [];
    try {
      entries = await fsPromises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = await fsPromises.stat(fullPath);
          total += Number(stat.size) || 0;
        } catch {}
      }
      seen += 1;
      if (seen >= maxEntries) {
        truncated = true;
        pending.length = 0;
        break;
      }
    }
  }
  return { bytes: total, truncated };
}

export async function sizeOfPath(targetPath, { followSymlinks = false } = {}) {
  if (!targetPath) return 0;
  const stack = [targetPath];
  let total = 0;
  while (stack.length) {
    const current = stack.pop();
    try {
      const stat = followSymlinks
        ? await fsPromises.stat(current)
        : await fsPromises.lstat(current);
      if (!followSymlinks && stat.isSymbolicLink()) continue;
      if (stat.isFile()) {
        total += Number(stat.size) || 0;
        continue;
      }
      if (!stat.isDirectory()) continue;
      const entries = await fsPromises.readdir(current);
      for (const entry of entries) {
        stack.push(path.join(current, entry));
      }
    } catch {}
  }
  return total;
}

export function buildDiskSpaceMessage({
  label,
  targetPath,
  requiredBytes,
  freeBytes,
  estimateNote
}) {
  const location = targetPath ? ` at ${targetPath}` : '';
  const kind = label ? ` for ${label}` : '';
  const estimateSuffix = estimateNote ? ` (${estimateNote})` : '';
  return [
    `Insufficient free space${kind}${location}.`,
    `Need ~${formatBytes(requiredBytes)}${estimateSuffix}; free ${formatBytes(freeBytes)}.`,
    'Remediation: change cache dir, enable cleanup, reduce modes, reduce token retention.'
  ].join(' ');
}

export async function ensureDiskSpace({
  targetPath,
  requiredBytes,
  label,
  estimateNote
}) {
  const required = Number(requiredBytes);
  if (!Number.isFinite(required) || required <= 0) return { ok: true, skipped: true };
  const freeBytes = await getDiskFreeBytes(targetPath);
  if (!Number.isFinite(freeBytes)) return { ok: true, skipped: true };
  if (freeBytes <= required) {
    const message = buildDiskSpaceMessage({
      label,
      targetPath,
      requiredBytes: required,
      freeBytes,
      estimateNote
    });
    const err = new Error(message);
    err.code = 'DISK_SPACE';
    err.requiredBytes = required;
    err.freeBytes = freeBytes;
    err.targetPath = targetPath;
    throw err;
  }
  return { ok: true, freeBytes };
}

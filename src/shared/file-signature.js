import fsPromises from 'node:fs/promises';

const safeStat = async (statPath, useBigInt) => {
  try {
    return await fsPromises.stat(statPath, useBigInt ? { bigint: true } : undefined);
  } catch {
    return null;
  }
};

const shouldProbeCompressedSibling = (targetPath, mode) => {
  if (!targetPath || mode === 'never') return false;
  if (mode === 'json') return /\.jsonl?$/i.test(targetPath);
  return !targetPath.endsWith('.gz') && !targetPath.endsWith('.zst');
};

const resolveSignatureProbePaths = (targetPath, mode) => {
  if (!targetPath) return [];
  const paths = [targetPath];
  if (shouldProbeCompressedSibling(targetPath, mode)) {
    paths.push(`${targetPath}.zst`, `${targetPath}.gz`);
  }
  return paths;
};

const probeSignatureStat = async (
  targetPath,
  { compressedSiblings = 'always', useBigInt = true } = {}
) => {
  const probePaths = resolveSignatureProbePaths(targetPath, compressedSiblings);
  for (const candidatePath of probePaths) {
    const stat = await safeStat(candidatePath, useBigInt);
    if (stat) return { statPath: candidatePath, stat };
  }
  return { statPath: targetPath, stat: null };
};

export const probeFileSignature = async (
  filePath,
  { compressedSiblings = 'always', format = 'detailed' } = {}
) => {
  try {
    if (!filePath) return null;
    let { stat } = await probeSignatureStat(filePath, {
      compressedSiblings,
      useBigInt: true
    });
    // Prefer nanosecond mtime precision when available so that successive writes within the
    // same millisecond still invalidate the cache (observed on Windows runners).
    if (!stat) {
      const fallback = await probeSignatureStat(filePath, {
        compressedSiblings,
        useBigInt: false
      });
      stat = fallback.stat;
    }
    if (!stat) return null;
    if (format === 'legacy') {
      const size = typeof stat.size === 'bigint' ? stat.size.toString() : String(stat.size);
      const mtimeMs = typeof stat.mtimeMs === 'bigint'
        ? Number(stat.mtimeMs)
        : Number(stat.mtimeMs);
      return `${size}:${mtimeMs}`;
    }
    const size = typeof stat.size === 'bigint' ? stat.size : BigInt(stat.size);
    const mtimeNs = stat.mtimeNs
      ?? (typeof stat.mtimeMs === 'bigint'
        ? stat.mtimeMs * 1000000n
        : BigInt(Math.trunc(Number(stat.mtimeMs) * 1_000_000)));
    const ctimeNs = stat.ctimeNs
      ?? (typeof stat.ctimeMs === 'bigint'
        ? stat.ctimeMs * 1000000n
        : BigInt(Math.trunc(Number(stat.ctimeMs) * 1_000_000)));
    return `${size.toString()}:${mtimeNs.toString()}:${ctimeNs.toString()}`;
  } catch {
    return null;
  }
};

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

const normalizeLegacyMtimeFromNs = (mtimeNs) => {
  const wholeMs = mtimeNs / 1000000n;
  const fractionalNs = mtimeNs % 1000000n;
  return Number(wholeMs) + Number(fractionalNs) / 1_000_000;
};

const resolveLegacyMtimeMs = async (stat, statPath) => {
  if (typeof stat?.mtimeNs === 'bigint') {
    return normalizeLegacyMtimeFromNs(stat.mtimeNs);
  }
  if (typeof stat?.mtimeMs !== 'bigint') {
    return Number(stat?.mtimeMs);
  }
  if (typeof statPath === 'string' && statPath) {
    const preciseStat = await safeStat(statPath, false);
    if (preciseStat && typeof preciseStat.mtimeMs !== 'bigint') {
      return Number(preciseStat.mtimeMs);
    }
  }
  return Number(stat.mtimeMs);
};

export const probeFileSignature = async (
  filePath,
  { compressedSiblings = 'always', format = 'detailed' } = {}
) => {
  try {
    if (!filePath) return null;
    let { statPath, stat } = await probeSignatureStat(filePath, {
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
      statPath = fallback.statPath;
      stat = fallback.stat;
    }
    if (!stat) return null;
    if (format === 'legacy') {
      const size = typeof stat.size === 'bigint' ? stat.size.toString() : String(stat.size);
      const mtimeMs = await resolveLegacyMtimeMs(stat, statPath);
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

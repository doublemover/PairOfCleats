import fs from 'node:fs/promises';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitForStableFile = async (absPath, { checks, intervalMs }) => {
  const requiredChecks = Number.isFinite(Number(checks)) ? Math.max(1, Math.floor(Number(checks))) : 1;
  const resolvedInterval = Number.isFinite(Number(intervalMs)) ? Math.max(0, Math.floor(Number(intervalMs))) : 0;
  const maxAttempts = Math.max(requiredChecks, requiredChecks * 3);
  let lastSignature = null;
  let stableCount = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let stat = null;
    try {
      stat = await fs.stat(absPath);
    } catch {
      return false;
    }
    const signature = `${stat.size}:${stat.mtimeMs}`;
    if (signature === lastSignature) {
      stableCount += 1;
      if (stableCount >= requiredChecks) return true;
    } else {
      lastSignature = signature;
      stableCount = 1;
    }
    if (attempt < maxAttempts - 1) {
      await sleep(resolvedInterval);
    }
  }
  return false;
};

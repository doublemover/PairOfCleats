import fs from 'node:fs/promises';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitForStableFile = async (absPath, { checks, intervalMs }) => {
  let lastSignature = null;
  for (let index = 0; index < checks; index += 1) {
    let stat = null;
    try {
      stat = await fs.stat(absPath);
    } catch {
      return false;
    }
    const signature = `${stat.size}:${stat.mtimeMs}`;
    if (signature === lastSignature) return true;
    lastSignature = signature;
    if (index < checks - 1) {
      await sleep(intervalMs);
    }
  }
  return false;
};

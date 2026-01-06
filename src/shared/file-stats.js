import fs from 'node:fs';
import { runWithConcurrency } from './concurrency.js';
import { toPosix } from './files.js';

export async function countFileLines(filePath) {
  return new Promise((resolve) => {
    let count = 0;
    let sawData = false;
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => {
      sawData = sawData || chunk.length > 0;
      for (let i = 0; i < chunk.length; i += 1) {
        if (chunk[i] === 10) count += 1;
      }
    });
    stream.on('error', () => resolve(0));
    stream.on('end', () => resolve(sawData ? count + 1 : 0));
  });
}

export async function countLinesForEntries(entries, { concurrency = 8 } = {}) {
  const lineCounts = new Map();
  if (!Array.isArray(entries) || entries.length === 0) return lineCounts;
  await runWithConcurrency(
    entries,
    concurrency,
    async (entry) => {
      const rel = toPosix(entry.rel || entry.abs || '');
      if (!rel) return;
      const lines = await countFileLines(entry.abs);
      lineCounts.set(rel, lines);
    },
    { collectResults: false }
  );
  return lineCounts;
}

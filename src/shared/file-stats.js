import fs from 'node:fs';
import { runWithConcurrency } from './concurrency/run-with-queue.js';
import { toPosix } from './file-paths.js';
import { coerceAbortSignal, isAbortError, throwIfAborted } from './abort.js';

export async function countFileLines(filePath, { signal = null } = {}) {
  const effectiveSignal = coerceAbortSignal(signal);
  throwIfAborted(effectiveSignal);
  const stream = fs.createReadStream(filePath, { signal: effectiveSignal });
  stream.on('error', () => {});
  const closed = new Promise(resolve => stream.once('close', resolve));
  let count = 0;
  let sawData = false;
  try {
    for await (const chunk of stream) {
      throwIfAborted(effectiveSignal);
      sawData ||= chunk.length > 0;
      for (let index = 0; index < chunk.length; index += 1) if (chunk[index] === 10) count += 1;
    }
    throwIfAborted(effectiveSignal);
    return sawData ? count + 1 : 0;
  } catch (error) {
    if (isAbortError(error) || effectiveSignal.aborted) {
      throwIfAborted(effectiveSignal);
      throw error;
    }
    throw Object.assign(new Error(`Cannot count lines for ${filePath}: ${error?.message || error}`, { cause: error }),
      { code: 'ERR_FILE_LINE_COUNT', path: filePath, causeCode: error?.code || null });
  } finally {
    stream.destroy();
    await closed;
  }
}

export async function countLinesForEntries(entries, { concurrency = 8, signal = null } = {}) {
  const effectiveSignal = coerceAbortSignal(signal);
  throwIfAborted(effectiveSignal);
  const lineCounts = new Map();
  if (!Array.isArray(entries) || entries.length === 0) return lineCounts;
  await runWithConcurrency(entries, concurrency, async (entry) => {
    throwIfAborted(effectiveSignal);
    const rel = toPosix(entry.rel || entry.abs || '');
    if (!rel) return;
    const lines = await countFileLines(entry.abs, { signal: effectiveSignal });
    lineCounts.set(rel, lines);
  }, { collectResults: false, signal: effectiveSignal, requireSignal: true,
    signalLabel: 'preprocess.count-lines' });
  return lineCounts;
}

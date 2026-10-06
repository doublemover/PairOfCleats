import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import readline from 'node:readline';
import { finished } from 'node:stream/promises';

import { toPosix } from '../../src/shared/file-paths.js';
import { writeJsonFileResolved } from '../../src/shared/json-file.js';
import { normalizeRepoRelativePath as normalizeSharedRepoRelativePath } from '../../src/shared/path-normalize.js';
import { emitJson } from '../shared/cli-utils.js';
import { createTempPath } from '../../src/shared/io/temp-path.js';

export const normalizeRepoRelativePath = (repoRoot, value, { stripVirtualRepoRoot = false } = {}) => {
  if (!value) return null;
  let raw = String(value);
  if (stripVirtualRepoRoot) {
    const posixRaw = toPosix(raw);
    if (posixRaw === '/repo') return '';
    if (posixRaw.startsWith('/repo/')) {
      raw = posixRaw.slice('/repo/'.length);
    }
    if (posixRaw.startsWith('/') && /^[A-Za-z]:\//.test(posixRaw.slice(1))) {
      raw = posixRaw.slice(1);
    }
  }
  const normalized = normalizeSharedRepoRelativePath(raw, repoRoot, { stripDot: true });
  if (!normalized || normalized === '.') return null;
  return normalized;
};

export const bumpStat = (bucket, key) => {
  if (!key) return;
  const normalized = String(key);
  bucket[normalized] = (bucket[normalized] || 0) + 1;
};

export const ensureParentDir = async (filePath) => {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
};

export const splitCliArgs = (value) => {
  if (!value) return [];
  return String(value)
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const normalizeTimeoutMs = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(1_000, Math.floor(parsed));
};

export const writeLine = async (stream, line) => {
  if (stream.errored) throw stream.errored;
  if (stream.destroyed) throw new Error('Ingest output stream is closed.');
  if (!stream.write(line)) {
    await once(stream, 'drain');
  }
};

/**
 * Stream into an exclusive temporary file and publish only after the producer
 * and output stream both succeed. Input may safely alias the output path.
 * The summary is a separate file, not a crash-atomic two-file transaction.
 */
export const withStagedIngestOutput = async (outputPath, consume) => {
  await ensureParentDir(outputPath);
  let mode;
  try {
    const existing = await fsPromises.stat(outputPath);
    if (!existing.isFile()) {
      const error = new Error(`Ingest output must be a regular file: ${outputPath}`);
      error.code = 'EISDIR';
      throw error;
    }
    await fsPromises.access(outputPath, fs.constants.W_OK);
    mode = existing.mode & 0o777;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const tempPath = createTempPath(outputPath);
  await ensureParentDir(tempPath);
  const handle = await fsPromises.open(tempPath, 'wx', mode);
  const stream = handle.createWriteStream({ encoding: 'utf8' });
  let outputError = null;
  // Observe errors immediately, including ones emitted before consume returns.
  const completed = finished(stream, { cleanup: true }).catch((error) => { outputError = error; });
  const cleanupAtExit = () => {
    try { if (Number.isInteger(stream.fd)) fs.closeSync(stream.fd); } catch {}
    try { fs.rmSync(tempPath, { force: true }); } catch {}
  };
  const onInterrupt = () => { cleanupAtExit(); process.exit(130); };
  const onTerminate = () => { cleanupAtExit(); process.exit(143); };
  process.once('exit', cleanupAtExit);
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    await consume(stream);
    stream.end();
    await completed;
    if (outputError) throw outputError;
    // A sibling rename never opens or truncates the previous destination.
    // Rename failure leaves that destination intact and is reported to the CLI.
    await fsPromises.rename(tempPath, outputPath);
  } finally {
    stream.destroy();
    await completed;
    try { await fsPromises.rm(tempPath, { force: true }); }
    finally {
      process.off('exit', cleanupAtExit);
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
    }
  }
};

export const writeJsonLine = async (stream, payload) => {
  await writeLine(stream, `${JSON.stringify(payload)}\n`);
};

export const writeIngestSummaryReport = async (metaPath, summary) => {
  await writeJsonFileResolved(metaPath, summary, { spaces: 2 });
};

export const emitIngestSummaryJson = (summary, stream = process.stdout) => {
  emitJson(summary, stream, { spaces: 2 });
};

export const finishWriteStream = async (stream) => {
  await new Promise((resolve, reject) => {
    stream.once('finish', resolve);
    stream.once('error', reject);
  });
};

export const ingestTextLineStream = async (stream, onLine) => {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let streamError = null;
  const onStreamError = (error) => {
    streamError = error || new Error('Input stream failed.');
    rl.close();
  };
  stream.once('error', onStreamError);
  try {
    for await (const line of rl) {
      await onLine(line);
    }
  } finally {
    stream.off('error', onStreamError);
    rl.close();
  }
  if (streamError) throw streamError;
};

export const ingestJsonLineStream = async (stream, { onPayload, onParseError = null }) => {
  await ingestTextLineStream(stream, async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      onParseError?.(line);
      return;
    }
    await onPayload(parsed, line);
  });
};

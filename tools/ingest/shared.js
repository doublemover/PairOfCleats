import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

import { toPosix } from '../../src/shared/file-paths.js';
import { writeJsonFileResolved } from '../../src/shared/json-file.js';
import { normalizeRepoRelativePath as normalizeSharedRepoRelativePath } from '../../src/shared/path-normalize.js';
import { emitJson } from '../shared/cli-utils.js';

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
  if (!stream.write(line)) {
    await new Promise((resolve) => stream.once('drain', resolve));
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

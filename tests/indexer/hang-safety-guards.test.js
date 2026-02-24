import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TARGET_ROOTS = [
  path.join(ROOT, 'src', 'index', 'build'),
  path.join(ROOT, 'src', 'integrations', 'core', 'build-index'),
  path.join(ROOT, 'src', 'shared', 'json-stream')
];
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.testLogs',
  '.testCache',
  'dist'
]);

const REQUIRE_SIGNAL_EXEMPT_FILES = new Set([
  'src/index/build/file-processor/embeddings.js'
]);

const normalizeRel = (filePath) => path.relative(ROOT, filePath).split(path.sep).join('/');

const collectFiles = async (dirPath, out = []) => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const abs = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!abs.endsWith('.js')) continue;
    out.push(abs);
  }
  return out;
};

const buildWindow = (lines, startIndex, size = 16) => {
  const safeStart = Math.max(0, startIndex);
  return lines.slice(safeStart, safeStart + size).join('\n');
};

const checkFile = async (filePath) => {
  const rel = normalizeRel(filePath);
  const content = await fs.readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const violations = [];
  let inBlockComment = false;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      return;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      return;
    }
    if (trimmed.startsWith('//')) return;

    if (/await\s+once\s*\(/.test(line)) {
      violations.push(`${rel}:${lineNo} raw await once(...) is forbidden; use shared timeout-safe stream/event waits.`);
    }

    if (line.includes('scheduler.schedule(')) {
      const window = buildWindow(lines, index - 10, 50);
      if (!/\bsignal\s*:/.test(window)) {
        violations.push(`${rel}:${lineNo} scheduler.schedule(...) missing signal propagation.`);
      }
    }

    if (line.includes('abortSignal') && /\.\.\.\s*\(\s*abortSignal/.test(line) && /\?\s*\{\s*signal\s*:\s*abortSignal\s*\}/.test(line)) {
      violations.push(`${rel}:${lineNo} conditional signal spreads are forbidden; use a normalized effective signal.`);
    }

    if (line.includes('runWithQueue(') || line.includes('runWithConcurrency(')) {
      if (!REQUIRE_SIGNAL_EXEMPT_FILES.has(rel)) {
        const window = buildWindow(lines, index - 2, 700);
        if (!/requireSignal\s*:\s*true/.test(window)) {
          violations.push(`${rel}:${lineNo} ${line.includes('runWithQueue(') ? 'runWithQueue' : 'runWithConcurrency'} missing requireSignal: true.`);
        }
        if (!/\bsignal\s*:/.test(window)) {
          violations.push(`${rel}:${lineNo} ${line.includes('runWithQueue(') ? 'runWithQueue' : 'runWithConcurrency'} missing explicit signal propagation.`);
        }
      }
    }

    if (/\b(?:ioQueue|cpuQueue|embeddingQueue|procQueue|runtime\.queues\.[a-zA-Z0-9_]+)\.add\s*\(/.test(line)) {
      const window = buildWindow(lines, index - 2, 120);
      if (!/\bsignal\b/.test(window)) {
        violations.push(`${rel}:${lineNo} queue.add(...) missing signal option.`);
      }
    }
  });

  return violations;
};

const allFiles = [];
for (const root of TARGET_ROOTS) {
  await collectFiles(root, allFiles);
}

const violations = [];
for (const filePath of allFiles) {
  const fileViolations = await checkFile(filePath);
  if (fileViolations.length) violations.push(...fileViolations);
}

assert.equal(
  violations.length,
  0,
  `Hang-safety guard violations:\n${violations.join('\n')}`
);

#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { parseBuildArgs } from './src/index/build/args.js';
import { buildIndex } from './src/integrations/core/index.js';
import { createDisplay } from './src/shared/cli/display.js';
import { setProgressHandlers } from './src/shared/progress.js';
import { getCurrentBuildInfo, getRepoCacheRoot, resolveRepoRoot } from './tools/dict-utils.js';

const { argv, modes } = parseBuildArgs(process.argv.slice(2));
if (argv.verbose) {
  process.env.PAIROFCLEATS_VERBOSE = '1';
}
const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const display = createDisplay({
  stream: process.stderr,
  progressMode: argv.progress,
  verbose: argv.verbose === true,
  quiet: argv.quiet === true,
  json: argv.json === true
});
const restoreHandlers = setProgressHandlers(display);
const supportsColor = process.stderr.isTTY
  && argv.json !== true
  && argv.progress !== 'jsonl'
  && argv.progress !== 'json';
const DONE_LABEL = supportsColor
  ? '\x1b[97m[\x1b[92mDONE\x1b[97m]\x1b[0m'
  : '[DONE]';
const writeLine = (line) => {
  if (line === null || line === undefined) return;
  process.stderr.write(`${line}\n`);
};
const localAppData = process.env.LOCALAPPDATA || '';
const normalizePath = (value) => String(value || '').replace(/\//g, path.sep);
const formatPath = (value, maxLength = 120) => {
  if (!value) return '';
  let normalized = normalizePath(value);
  if (localAppData && normalized.toLowerCase().startsWith(localAppData.toLowerCase())) {
    const suffix = normalized.slice(localAppData.length);
    const trimmed = suffix.startsWith(path.sep) ? suffix.slice(1) : suffix;
    normalized = `%localappdata%${path.sep}${trimmed}`;
  }
  if (normalized.length <= maxLength) return normalized;
  const head = normalized.startsWith('%localappdata%') ? `%localappdata%${path.sep}` : '';
  const remaining = normalized.slice(head.length);
  const tailLength = Math.max(10, maxLength - head.length - 3);
  const tail = remaining.slice(-tailLength);
  return `${head}...${tail}`;
};
let displayClosed = false;
const closeDisplay = () => {
  if (displayClosed) return;
  if (typeof display.flush === 'function') {
    display.flush();
  }
  restoreHandlers();
  display.close();
  displayClosed = true;
};
let result = null;
const startedAt = Date.now();
const resolvedRoot = rootArg || resolveRepoRoot(process.cwd());
const repoCacheRoot = getRepoCacheRoot(resolvedRoot);
const crashLogPath = repoCacheRoot
  ? path.join(repoCacheRoot, 'logs', 'index-crash.log')
  : null;
try {
  result = await buildIndex(resolvedRoot, {
    ...argv,
    modes,
    rawArgv: process.argv
  });
  const buildInfo = getCurrentBuildInfo(resolvedRoot);
  const buildStatePath = buildInfo?.buildRoot
    ? path.join(buildInfo.buildRoot, 'build_state.json')
    : null;
  if (result?.stage3?.embeddings?.cancelled) {
    closeDisplay();
    writeLine('Index build cancelled during embeddings.');
  } else {
    const preprocessPath = repoCacheRoot
      ? path.join(repoCacheRoot, 'preprocess.json')
      : null;
    const seconds = Math.round(Math.max(0, (Date.now() - startedAt) / 1000));
    let summary = `Index built in ${seconds} seconds.`;
    let detailLines = [];
    try {
      if (preprocessPath && fs.existsSync(preprocessPath)) {
        const stats = JSON.parse(fs.readFileSync(preprocessPath, 'utf8'));
        const modes = stats?.modes || {};
        const fmt = (value) => Number.isFinite(value) ? value.toLocaleString() : '0';
        const code = modes.code || {};
        const prose = modes.prose || {};
        const extracted = modes['extracted-prose'] || {};
        const records = modes.records || {};
        const codeFiles = Number.isFinite(code.included) ? code.included : 0;
        const proseFiles = Number.isFinite(prose.included) ? prose.included : 0;
        const recordsFiles = Number.isFinite(records.included) ? records.included : 0;
        const totalFiles = codeFiles + proseFiles + recordsFiles;
        const codeLines = Number.isFinite(code.lines) ? code.lines : 0;
        const proseLines = Number.isFinite(prose.lines) ? prose.lines : 0;
        const recordsLines = Number.isFinite(records.lines) ? records.lines : 0;
        const totalLines = codeLines + proseLines + recordsLines;
        const extractedFiles = Number.isFinite(extracted.included) ? extracted.included : 0;
        const extractedLines = Number.isFinite(extracted.lines) ? extracted.lines : 0;
        summary = `Index built for ${fmt(totalFiles)} files in ${seconds} seconds (${fmt(totalLines)} lines).`;
        const detailEntries = [
          { label: 'Code', value: `${fmt(codeFiles)} files`, lines: fmt(codeLines) },
          { label: 'Prose', value: `${fmt(proseFiles)} files`, lines: fmt(proseLines) },
          { label: 'Extracted Prose', value: `${fmt(extractedFiles)} files`, lines: fmt(extractedLines) },
          { label: 'Records', value: `${fmt(recordsFiles)} records`, lines: fmt(recordsLines) }
        ];
        const maxLabelLength = detailEntries.reduce((max, entry) => Math.max(max, entry.label.length), 0);
        const maxValueLength = detailEntries.reduce((max, entry) => Math.max(max, entry.value.length), 0);
        const colonColumn = Math.max(36, maxLabelLength + 2);
        const baseIndent = Math.max(0, colonColumn - maxLabelLength);
        detailLines = detailEntries.map((entry) => {
          const labelPad = ' '.repeat(maxLabelLength - entry.label.length);
          const valuePad = ' '.repeat(maxValueLength - entry.value.length);
          const indent = ' '.repeat(baseIndent);
          return `${indent}${labelPad}${entry.label}: ${entry.value}${valuePad} (${entry.lines} lines).`;
        });
      }
    } catch {}
    closeDisplay();
    writeLine(`${DONE_LABEL} ${summary}`);
    for (const line of detailLines) {
      writeLine(line);
    }
  }
} catch (err) {
  display.error(`Index build failed: ${err?.message || err}`);
  if (crashLogPath) {
    display.error(`Crash log: ${crashLogPath}`);
  }
  process.exitCode = 1;
} finally {
  closeDisplay();
}

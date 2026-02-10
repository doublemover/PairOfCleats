#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSubprocess } from '../../src/shared/subprocess.js';
import { createCli } from '../../src/shared/cli.js';
import {
  getRuntimeConfig,
  resolveRepoConfig,
  resolveRuntimeEnv,
  resolveToolRoot
} from '../shared/dict-utils.js';
import { parseCommaList } from '../shared/text-utils.js';

const argv = createCli({
  scriptName: 'parity-matrix',
  options: {
    backend: { type: 'string' },
    backends: { type: 'string' },
    'ann-modes': { type: 'string' },
    queries: { type: 'string' },
    'queries-dir': { type: 'string' },
    top: { type: 'number' },
    limit: { type: 'number' },
    results: { type: 'string' },
    'out-dir': { type: 'string' },
    search: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'fail-fast': { type: 'boolean', default: false }
  }
}).parse();

const scriptRoot = resolveToolRoot();
const { repoRoot, userConfig } = resolveRepoConfig(null);
const runtimeEnv = resolveRuntimeEnv(getRuntimeConfig(repoRoot, userConfig), process.env);
const parityScript = path.join(scriptRoot, 'tests', 'retrieval', 'parity', 'parity.test.js');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const resultsRoot = path.resolve(
  argv.results || path.join(scriptRoot, 'benchmarks', 'results')
);
const runRoot = path.resolve(
  argv['out-dir'] || path.join(resultsRoot, 'parity', timestamp)
);
const logRoot = path.join(runRoot, 'logs');
const outRoot = path.join(runRoot, 'runs');

const DEFAULT_BACKENDS = ['sqlite', 'sqlite-fts'];
const DEFAULT_ANN_MODES = ['on', 'off'];
const DEFAULT_TOP = 10;

const normalizeBackend = (raw) => {
  const value = String(raw || '').toLowerCase();
  if (value === 'fts') return 'sqlite-fts';
  return value;
};

const resolveBackends = () => {
  const raw = argv.backends || argv.backend || '';
  const list = parseCommaList(raw).map(normalizeBackend).filter(Boolean);
  if (!list.length || list.includes('all')) return DEFAULT_BACKENDS.slice();
  return Array.from(new Set(list));
};

const normalizeAnnMode = (raw) => {
  const value = String(raw || '').toLowerCase();
  if (value === 'true' || value === '1' || value === 'on' || value === 'yes') {
    return 'on';
  }
  if (value === 'false' || value === '0' || value === 'off' || value === 'no') {
    return 'off';
  }
  return null;
};

const resolveAnnModes = () => {
  const raw = parseCommaList(argv['ann-modes']);
  const modes = raw.map(normalizeAnnMode).filter(Boolean);
  return modes.length ? Array.from(new Set(modes)) : DEFAULT_ANN_MODES.slice();
};

const toSafeName = (value) =>
  String(value || '')
    .replace(/[^a-z0-9-_]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

const appendArgs = (args, flag, value) => {
  if (value === undefined || value === null || value === '') return;
  args.push(flag, String(value));
};

async function loadQueriesFromFile(filePath) {
  const raw = await fsPromises.readFile(filePath, 'utf8');
  if (filePath.endsWith('.json')) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          if (entry && typeof entry.query === 'string') return entry.query;
          return null;
        })
        .filter(Boolean);
    }
    if (Array.isArray(parsed.queries)) {
      return parsed.queries
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          if (entry && typeof entry.query === 'string') return entry.query;
          return null;
        })
        .filter(Boolean);
    }
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

async function resolveQueryFile() {
  if (argv.queries) {
    const resolved = path.resolve(argv.queries);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Query file not found: ${resolved}`);
    }
    const queries = await loadQueriesFromFile(resolved);
    return { path: resolved, source: 'file', count: queries.length };
  }

  const queriesDir = path.resolve(
    argv['queries-dir'] || path.join(scriptRoot, 'benchmarks', 'queries')
  );
  const entries = await fsPromises.readdir(queriesDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.txt'))
    .map((entry) => entry.name)
    .sort();
  if (!files.length) {
    throw new Error(`No query files found in ${queriesDir}`);
  }

  const seen = new Set();
  const combined = [];
  for (const file of files) {
    const filePath = path.join(queriesDir, file);
    const lines = await loadQueriesFromFile(filePath);
    for (const line of lines) {
      if (seen.has(line)) continue;
      seen.add(line);
      combined.push(line);
    }
  }

  if (!combined.length) {
    throw new Error(`No queries resolved from ${queriesDir}`);
  }

  const outPath = path.join(runRoot, 'parity-queries.txt');
  const header = [
    '# Generated from benchmarks/queries/*.txt',
    `# Source: ${queriesDir}`,
    ''
  ];
  await fsPromises.writeFile(outPath, `${header.join('\n')}${combined.join('\n')}\n`);
  return { path: outPath, source: queriesDir, count: combined.length };
}

const configToArgs = (config, queryFile, outFile, top, limit) => {
  const args = [parityScript];
  appendArgs(args, '--sqlite-backend', config.backend);
  appendArgs(args, '--queries', queryFile);
  appendArgs(args, '--top', top);
  appendArgs(args, '--limit', limit);
  appendArgs(args, '--search', argv.search);
  args.push('--write-report');
  appendArgs(args, '--out', outFile);
  if (config.annMode === 'on') args.push('--ann');
  if (config.annMode === 'off') args.push('--no-ann');
  return args;
};

async function main() {
  await fsPromises.mkdir(logRoot, { recursive: true });
  await fsPromises.mkdir(outRoot, { recursive: true });

  const queryInfo = await resolveQueryFile();
  const top = Number.isFinite(Number(argv.top))
    ? Math.max(1, Number(argv.top))
    : DEFAULT_TOP;
  const limit = Number.isFinite(Number(argv.limit))
    ? Math.max(0, Number(argv.limit))
    : 0;

  const backends = resolveBackends();
  const annModes = resolveAnnModes();
  const configs = [];
  for (const backend of backends) {
    for (const annMode of annModes) {
      const id = toSafeName([backend, annMode].join('-'));
      configs.push({ id, backend, annMode });
    }
  }

  if (!configs.length) {
    throw new Error('No parity configurations resolved.');
  }

  const results = [];
  for (const config of configs) {
    const label = `${config.backend}/${config.annMode}`;
    const outFile = path.join(outRoot, `${config.id}.json`);
    const logFile = path.join(logRoot, `${config.id}.log`);
    const args = configToArgs(config, queryInfo.path, outFile, top, limit);

    console.error(`\n[parity-matrix] ${label}`);
    console.error(
      `node ${args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')}`
    );

    if (argv['dry-run']) {
      results.push({ ...config, outFile, logFile, status: 'dry-run' });
      continue;
    }

    try {
      const outputChunks = [];
      const recordChunk = (chunk) => {
        if (chunk) outputChunks.push(chunk);
      };
      const result = await spawnSubprocess(process.execPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        rejectOnNonZeroExit: false,
        captureStdout: true,
        captureStderr: true,
        outputMode: 'string',
        env: runtimeEnv,
        onStdout: recordChunk,
        onStderr: recordChunk
      });
      const combinedOutput = outputChunks.join('')
        || `${result.stdout || ''}${result.stderr || ''}`;
      if (combinedOutput) process.stderr.write(combinedOutput);
      await fsPromises.writeFile(logFile, combinedOutput || '');

      let summary = null;
      try {
        const report = JSON.parse(await fsPromises.readFile(outFile, 'utf8'));
        summary = report.summary || null;
      } catch {
        summary = null;
      }

      if (result.exitCode === 0) {
        results.push({ ...config, outFile, logFile, status: 'ok', summary });
      } else {
        results.push({
          ...config,
          outFile,
          logFile,
          status: 'failed',
          exitCode: result.exitCode ?? null,
          error: `exit ${result.exitCode ?? 'unknown'}`
        });
        if (argv['fail-fast']) break;
      }
    } catch (err) {
      const output = err?.result?.stdout || err?.result?.stderr || err?.message || String(err);
      if (output) process.stderr.write(output);
      await fsPromises.writeFile(logFile, output || '');
      results.push({
        ...config,
        outFile,
        logFile,
        status: 'failed',
        exitCode: err?.result?.exitCode ?? null,
        error: err?.message || String(err)
      });
      if (argv['fail-fast']) break;
    }
  }

  const matrix = {
    generatedAt: new Date().toISOString(),
    runRoot,
    outRoot,
    logRoot,
    queryFile: queryInfo.path,
    querySource: queryInfo.source,
    queryCount: queryInfo.count,
    top,
    limit,
    results
  };
  const matrixPath = path.join(runRoot, 'matrix.json');
  await fsPromises.writeFile(matrixPath, JSON.stringify(matrix, null, 2));
  console.error(`\n[parity-matrix] summary written to ${matrixPath}`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});

#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const parseArgs = () => {
  const out = {
    suite: null,
    scripts: [],
    json: null,
    timeoutMs: 0,
    quiet: false
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--suite') {
      out.suite = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === '--scripts') {
      const value = argv[i + 1] || '';
      const next = value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      out.scripts.push(...next);
      i += 1;
      continue;
    }
    if (arg === '--json') {
      out.json = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      out.timeoutMs = Math.max(0, Math.floor(Number(argv[i + 1] || 0)));
      i += 1;
      continue;
    }
    if (arg === '--quiet') {
      out.quiet = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
  }
  return out;
};

const DEFAULT_SWEET16_SCRIPTS = [
  'tools/bench/index/ordering-ledger.js',
  'tools/bench/index/postings-real.js',
  'tools/bench/index/chargram-postings.js',
  'tools/bench/index/tree-sitter-load.js',
  'tools/bench/index/relations-build.js',
  'tools/bench/index/filter-index-build.js',
  'tools/bench/index/repo-map-compress.js',
  'tools/bench/embeddings/embedding-batch-throughput.js',
  'tools/bench/index/file-meta-streaming-load.js',
  'tools/bench/index/scheduler-build.js'
];

const resolveSuiteScripts = (suite) => {
  const key = String(suite || '').toLowerCase();
  if (!key || key === 'sweet16') return DEFAULT_SWEET16_SCRIPTS;
  return null;
};

const parseKeyValueMetrics = (line) => {
  const metrics = {};
  if (typeof line !== 'string') return metrics;
  const re = /([A-Za-z][A-Za-z0-9_]*)=([^\s]+)/g;
  let match = re.exec(line);
  while (match) {
    const key = match[1];
    const raw = match[2];
    const numeric = Number(raw.replace(/[^0-9.+-]/g, ''));
    metrics[key] = Number.isFinite(numeric) ? numeric : raw;
    match = re.exec(line);
  }
  return metrics;
};

const parseBenchOutput = (stdout) => {
  const lines = String(stdout || '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const baselineLine = lines.find((line) => line.startsWith('[bench] baseline')) || null;
  const currentLine = lines.find((line) => line.startsWith('[bench] current')) || null;
  return {
    baseline: baselineLine
      ? { line: baselineLine, metrics: parseKeyValueMetrics(baselineLine) }
      : null,
    current: currentLine
      ? { line: currentLine, metrics: parseKeyValueMetrics(currentLine) }
      : null
  };
};

const runOne = ({ script, timeoutMs }) => {
  const absScript = path.isAbsolute(script) ? script : path.join(process.cwd(), script);
  const start = Date.now();
  const result = spawnSync(
    process.execPath,
    [absScript, '--mode', 'compare'],
    { encoding: 'utf8', timeout: timeoutMs > 0 ? timeoutMs : undefined }
  );
  const durationMs = Date.now() - start;
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  const exitCode = typeof result.status === 'number' ? result.status : null;
  const parsed = parseBenchOutput(stdout);
  return {
    script,
    absScript,
    durationMs,
    exitCode,
    timedOut,
    ok: exitCode === 0 && !timedOut,
    stdout,
    stderr,
    parsed
  };
};

const main = async () => {
  const argv = parseArgs();
  if (argv.help) {
    const lines = [
      'bench-runner',
      '',
      'Usage:',
      '  node tools/bench/bench-runner.js --scripts <path[,path...]> [--json <out.json>] [--timeout-ms N]',
      '  node tools/bench/bench-runner.js --suite sweet16 [--json <out.json>] [--timeout-ms N]',
      '',
      'Notes:',
      '- Scripts are executed with `--mode compare` (bench scripts should handle unknown flags).',
      '- Output is captured and summarized into a single JSON report.'
    ];
    console.log(lines.join('\n'));
    return;
  }

  const suiteScripts = argv.suite ? resolveSuiteScripts(argv.suite) : null;
  const scripts = argv.scripts.length
    ? argv.scripts
    : (suiteScripts || []);
  if (!scripts.length) {
    console.error('bench-runner: no scripts selected (use --scripts or --suite).');
    process.exit(2);
  }

  const results = [];
  for (const script of scripts) {
    if (!argv.quiet) {
      process.stderr.write(`[bench-runner] ${script}\n`);
    }
    results.push(runOne({ script, timeoutMs: argv.timeoutMs }));
  }

  const summary = results.reduce((acc, entry) => {
    const status = entry.timedOut ? 'timeout' : (entry.ok ? 'ok' : 'error');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runner: {
      cwd: process.cwd(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      node: process.version,
      args: process.argv.slice(2)
    },
    summary,
    results: results.map((entry) => ({
      script: entry.script,
      absScript: entry.absScript,
      ok: entry.ok,
      timedOut: entry.timedOut,
      exitCode: entry.exitCode,
      durationMs: entry.durationMs,
      parsed: entry.parsed,
      stdout: entry.stdout,
      stderr: entry.stderr
    }))
  };

  if (argv.json) {
    const outPath = path.isAbsolute(argv.json) ? argv.json : path.join(process.cwd(), argv.json);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (!argv.quiet) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }

  const hasFailures = (summary.error || 0) > 0 || (summary.timeout || 0) > 0;
  process.exit(hasFailures ? 1 : 0);
};

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});


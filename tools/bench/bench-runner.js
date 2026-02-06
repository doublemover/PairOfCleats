#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import { resolveBenchSuite } from './suites/sweet16.js';

const parseArgs = () => {
  const out = {
    suite: null,
    scripts: [],
    json: null,
    timeoutMs: 0,
    quiet: false,
    repoRoot: null,
    indexDir: null,
    help: false
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
    if (arg === '--repo-root') {
      out.repoRoot = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === '--index-dir') {
      out.indexDir = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
  }
  return out;
};

const substituteTokens = (value, tokens) => {
  if (!tokens || typeof tokens !== 'object') return value;
  let out = String(value);
  for (const [key, replacement] of Object.entries(tokens)) {
    out = out.split(`\${${key}}`).join(String(replacement ?? ''));
  }
  return out;
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

const parseBenchOutput = (output) => {
  const lines = String(output || '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const benchLines = lines.filter((line) => line.startsWith('[bench]'));
  const classify = (label) => (
    benchLines.find((line) => (
      /^\[bench\]\s+(?:[^\s]+\s+)*?(baseline|current|delta)\b/i.test(line)
      && line.toLowerCase().includes(` ${label}`)
    )) || null
  );
  const baselineLine = benchLines.find((line) => /^\[bench\]\s+baseline\b/i.test(line))
    || classify('baseline');
  const currentLine = benchLines.find((line) => /^\[bench\]\s+current\b/i.test(line))
    || classify('current');
  const deltaLine = benchLines.find((line) => /^\[bench\]\s+delta\b/i.test(line))
    || classify('delta');
  return {
    baseline: baselineLine
      ? { line: baselineLine, metrics: parseKeyValueMetrics(baselineLine) }
      : null,
    current: currentLine
      ? { line: currentLine, metrics: parseKeyValueMetrics(currentLine) }
      : null,
    delta: deltaLine
      ? { line: deltaLine, metrics: parseKeyValueMetrics(deltaLine) }
      : null
  };
};

const parseTrailingJson = (text) => {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch {}
  }
  const match = raw.match(/\{[\s\S]*\}\s*$/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
};

const runOne = ({ script, args, timeoutMs, tokens }) => {
  const absScript = path.isAbsolute(script) ? script : path.join(process.cwd(), script);
  const start = Date.now();
  const result = spawnSync(
    process.execPath,
    [absScript, ...(args || []).map((value) => substituteTokens(value, tokens))],
    { encoding: 'utf8', timeout: timeoutMs > 0 ? timeoutMs : undefined }
  );
  const durationMs = Date.now() - start;
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const combined = `${stdout}\n${stderr}`;
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  const exitCode = typeof result.status === 'number' ? result.status : null;
  const parsed = parseBenchOutput(combined);
  const json = parseTrailingJson(stdout);
  return {
    script,
    absScript,
    durationMs,
    exitCode,
    timedOut,
    ok: exitCode === 0 && !timedOut,
    stdout,
    stderr,
    parsed,
    json
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
      '  node tools/bench/bench-runner.js --suite sweet16 [--json <out.json>] [--timeout-ms N] [--repo-root <path>] [--index-dir <path>]',
      '',
      'Notes:',
      '- Suite entries include their own args; --scripts runs with no implicit args.',
      '- Use --repo-root/--index-dir to populate suite placeholders.'
    ];
    console.log(lines.join('\n'));
    return;
  }

  const suiteEntries = argv.suite ? resolveBenchSuite(argv.suite) : null;
  const tokens = {
    repoRoot: argv.repoRoot ? path.resolve(argv.repoRoot) : '',
    indexDir: argv.indexDir ? path.resolve(argv.indexDir) : ''
  };
  const entries = argv.scripts.length
    ? argv.scripts.map((script) => ({ id: path.basename(script), script, args: [] }))
    : (suiteEntries || []);
  if (!entries.length) {
    console.error('bench-runner: no scripts selected (use --scripts or --suite).');
    process.exit(2);
  }

  const results = [];
  const suiteMode = Boolean(suiteEntries);
  for (const entry of entries) {
    if (!argv.quiet) {
      process.stderr.write(`[bench-runner] ${entry.script}\n`);
    }
    const result = runOne({
      script: entry.script,
      args: entry.args,
      timeoutMs: argv.timeoutMs,
      tokens
    });

    const errors = [];
    const expect = entry.expect && typeof entry.expect === 'object' ? entry.expect : null;
    if (expect) {
      if (expect.json === true && !result.json) {
        errors.push('missing json output');
      }
      if (expect.baseline === true && !result.parsed?.baseline) {
        errors.push('missing baseline bench line');
      }
      if (expect.current === true && !result.parsed?.current) {
        errors.push('missing current bench line');
      }
      if (expect.delta === true && !result.parsed?.delta) {
        errors.push('missing delta bench line');
      }
    }

    const parsedOk = errors.length === 0;
    if (suiteMode && expect && !parsedOk) {
      const allowSkip = entry.allowSkip === true;
      const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
      const looksSkipped = combined.includes('skipping') || combined.includes('skipped');
      if (allowSkip && looksSkipped) {
        result.skipped = true;
      } else {
        result.ok = false;
      }
    }
    result.parsedOk = parsedOk;
    if (errors.length) result.errors = errors;
    results.push(result);
  }

  const summary = results.reduce((acc, entry) => {
    const status = entry.timedOut ? 'timeout' : (entry.ok ? 'ok' : 'error');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, { ok: 0, error: 0, timeout: 0 });

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
      json: entry.json,
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

#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import fs from 'node:fs';
import path from 'node:path';
const { default: yargs } = await import('yargs/yargs');
const { hideBin } = await import('yargs/helpers');
const { formatStats } = await import('./utils.js');
const { runRegexBenchmark } = await import('./regex-runner.js');

const argv = yargs(hideBin(process.argv))
  .option('pattern', {
    type: 'string',
    describe: 'Regex pattern to benchmark',
    default: '(error|warn|info)\\s+\\w+'
  })
  .option('flags', {
    type: 'string',
    describe: 'Regex flags',
    default: 'g'
  })
  .option('input', {
    type: 'string',
    describe: 'Input string to match against'
  })
  .option('input-file', {
    type: 'string',
    describe: 'Load input text from a file'
  })
  .option('iterations', {
    type: 'number',
    describe: 'Total iterations per engine',
    default: 50000
  })
  .option('samples', {
    type: 'number',
    describe: 'Sample buckets for timing stats',
    default: 10
  })
  .option('warmup', {
    type: 'number',
    describe: 'Warmup iterations per engine',
    default: 2000
  })
  .option('json', {
    type: 'boolean',
    describe: 'Emit JSON output only',
    default: false
  })
  .option('out', {
    type: 'string',
    describe: 'Write JSON results to a file'
  })
  .help()
  .argv;

const pattern = String(argv.pattern || '');
const flags = String(argv.flags || '');
const iterations = Math.max(1, Math.floor(argv.iterations));
const samples = Math.max(1, Math.floor(argv.samples));
const warmup = Math.max(0, Math.floor(argv.warmup));

const input = resolveInput(argv);
if (!input) {
  console.error('[regex] Missing input (use --input or --input-file).');
  process.exit(1);
}

const results = await runRegexBenchmark({ pattern, flags, input, iterations, samples, warmup });

if (argv.out) {
  const outPath = path.resolve(argv.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.error(`[regex] iterations=${results.iterations} samples=${results.samples} warmup=${results.warmup}`);
  console.error(`[regex] ${results.comparison}; ${results.operation}`);
  printEngine('re2js', results.engines.re2js);
  if (results.engines.re2.available === false) {
    console.error('- re2: unavailable (install optional "re2" dependency to compare)');
  } else {
    printEngine('re2', results.engines.re2);
  }
}

function resolveInput(args) {
  if (args['input-file']) {
    const filePath = path.resolve(args['input-file']);
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error(`[regex] Failed to read ${filePath}: ${err?.message || err}`);
      process.exit(1);
    }
  }
  if (typeof args.input === 'string' && args.input.length) return args.input;
  return 'error alpha\nwarn beta\ninfo gamma\n'.repeat(200);
}

function printEngine(name, payload) {
  const stats = payload.stats || null;
  const ops = Number.isFinite(payload.opsPerSec) ? payload.opsPerSec.toFixed(0) : 'n/a';
  const summary = stats ? formatStats(stats) : 'n/a';
  console.error(`- ${name} (effective ${payload.effectiveEngine}; package ${payload.package?.version || 'unknown'}): ${summary} | ops/sec ${ops}`);
}

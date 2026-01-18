#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { createSafeRegex } from '../../../src/shared/safe-regex.js';
import { tryRequire } from '../../../src/shared/optional-deps.js';
import { formatStats, summarizeDurations } from './utils.js';

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

const results = {
  generatedAt: new Date().toISOString(),
  pattern,
  flags,
  inputBytes: Buffer.byteLength(input, 'utf8'),
  iterations,
  warmup,
  engines: {}
};

const re2js = createSafeRegex(pattern, flags, {
  maxPatternLength: 0,
  maxInputLength: 0,
  maxProgramSize: 0,
  timeoutMs: 0
});
if (!re2js) {
  console.error('[regex] Failed to compile re2js pattern.');
  process.exit(1);
}

results.engines.re2js = await runBench('re2js', () => re2js.test(input), {
  iterations,
  samples,
  warmup
});

const re2Engine = loadRe2();
if (re2Engine) {
  const re2 = new re2Engine(pattern, flags);
  results.engines.re2 = await runBench('re2', () => re2.test(input), {
    iterations,
    samples,
    warmup
  });
} else {
  results.engines.re2 = { available: false };
}

if (argv.out) {
  const outPath = path.resolve(argv.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`[regex] iterations=${iterations} samples=${samples} warmup=${warmup}`);
  printEngine('re2js', results.engines.re2js);
  if (results.engines.re2.available === false) {
    console.log('- re2: unavailable (install optional "re2" dependency to compare)');
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

function loadRe2() {
  const result = tryRequire('re2');
  if (!result.ok || !result.mod) return null;
  const engine = result.mod.default || result.mod;
  return typeof engine === 'function' ? engine : null;
}

async function runBench(label, fn, { iterations, samples, warmup }) {
  for (let i = 0; i < warmup; i += 1) {
    fn();
  }
  const timings = [];
  const perSample = Math.max(1, Math.floor(iterations / samples));
  const remainder = iterations - (perSample * samples);
  let total = 0;
  for (let i = 0; i < samples; i += 1) {
    const loops = perSample + (i < remainder ? 1 : 0);
    const start = process.hrtime.bigint();
    for (let j = 0; j < loops; j += 1) {
      fn();
    }
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsed);
    total += elapsed;
  }
  const stats = summarizeDurations(timings);
  const opsPerSec = total > 0 ? (iterations / (total / 1000)) : 0;
  return {
    available: true,
    totalMs: total,
    opsPerSec,
    stats
  };
}

function printEngine(name, payload) {
  const stats = payload.stats || null;
  const ops = Number.isFinite(payload.opsPerSec) ? payload.opsPerSec.toFixed(0) : 'n/a';
  const summary = stats ? formatStats(stats) : 'n/a';
  console.log(`- ${name}: ${summary} | ops/sec ${ops}`);
}

#!/usr/bin/env node
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { isAbsolutePathNative } from '../src/shared/files.js';
import { splitWordsWithDict } from '../src/shared/tokenize.js';

const argv = createCli({
  scriptName: 'bench-dict-seg',
  options: {
    json: { type: 'boolean', default: false },
    dict: { type: 'string' },
    tokens: { type: 'string' },
    fixture: { type: 'string' },
    out: { type: 'string' },
    sample: { type: 'number' },
    'dp-max': { type: 'number' }
  }
}).parse();

const root = process.cwd();
const fixtureArg = typeof argv.fixture === 'string' ? argv.fixture.trim() : '';
const fixtureDir = fixtureArg
  ? (isAbsolutePathNative(fixtureArg)
    ? path.resolve(fixtureArg)
    : path.join(root, 'tests', 'fixtures', fixtureArg))
  : null;
const dictPath = fixtureDir
  ? path.join(fixtureDir, 'words.txt')
  : path.resolve(argv.dict || path.join(root, 'tests', 'fixtures', 'dicts', 'words.txt'));
const tokensPath = fixtureDir
  ? path.join(fixtureDir, 'tokens.txt')
  : (argv.tokens ? path.resolve(argv.tokens) : null);
const fixtureLabel = fixtureDir ? path.basename(fixtureDir) : 'default';
const sampleLimit = Number.isFinite(Number(argv.sample))
  ? Math.max(10, Number(argv.sample))
  : 300;
const dpMaxTokenLength = Number.isFinite(Number(argv['dp-max']))
  ? Math.max(4, Math.floor(Number(argv['dp-max'])))
  : 32;

function camelize(a, b) {
  if (!a) return b || '';
  if (!b) return a;
  return `${a}${b[0].toUpperCase()}${b.slice(1)}`;
}

function buildTokenSamples(words, limit) {
  const base = words.slice(0, Math.min(words.length, 120));
  const tokens = new Set();
  for (const word of base) tokens.add(word);
  for (let i = 0; i < base.length; i += 1) {
    const a = base[i];
    const b = base[(i + 1) % base.length];
    const c = base[(i + 2) % base.length];
    tokens.add(`${a}${b}`);
    tokens.add(camelize(a, b));
    tokens.add(`${a}_${b}`);
    tokens.add(`${a}-${c}`);
  }
  const extras = [
    'HTTPRequest',
    'getUserProfile',
    'userIDLookup',
    'kubernetesClusterConfig',
    'postgresConnectionString',
    'lruCacheStats',
    'xkcdToken',
    'xyzzynotaword',
    'foo2bar',
    'ZalgoMode'
  ];
  extras.forEach((token) => tokens.add(token));
  return Array.from(tokens).slice(0, limit);
}

async function loadTokens(words) {
  if (tokensPath) {
    try {
      const raw = await fs.readFile(tokensPath, 'utf8');
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, sampleLimit);
    } catch {
      // Fall back to generated samples when fixture tokens are missing.
    }
  }
  return buildTokenSamples(words, sampleLimit);
}

function measure(tokens, dict, segmentation) {
  const start = Date.now();
  let totalSegments = 0;
  let totalChars = 0;
  let dictChars = 0;
  let unknownChars = 0;
  let dictSegments = 0;
  let unknownSegments = 0;
  for (const token of tokens) {
    if (!token) continue;
    totalChars += token.length;
    const segments = splitWordsWithDict(token.toLowerCase(), dict, {
      segmentation,
      dpMaxTokenLength
    });
    totalSegments += segments.length;
    for (const seg of segments) {
      if (dict.has(seg)) {
        dictChars += seg.length;
        dictSegments += 1;
      } else {
        unknownChars += seg.length;
        unknownSegments += 1;
      }
    }
  }
  const durationMs = Date.now() - start;
  const coverage = totalChars > 0 ? dictChars / totalChars : 0;
  return {
    segments: totalSegments,
    avgSegmentsPerToken: tokens.length ? totalSegments / tokens.length : 0,
    dictSegments,
    unknownSegments,
    dictChars,
    unknownChars,
    coverage,
    durationMs
  };
}

let dictRaw = '';
try {
  dictRaw = await fs.readFile(dictPath, 'utf8');
} catch (err) {
  console.error(`Failed to read dictionary at ${dictPath}`);
  if (err?.message) console.error(err.message);
  process.exit(1);
}

const dictWords = new Set(
  dictRaw
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean)
);

const tokens = await loadTokens(Array.from(dictWords));
const greedy = measure(tokens, dictWords, 'greedy');
const dp = measure(tokens, dictWords, 'dp');
const aho = measure(tokens, dictWords, 'aho');

const summary = {
  generatedAt: new Date().toISOString(),
  dictPath,
  tokensPath: tokensPath && fsSync.existsSync(tokensPath) ? tokensPath : null,
  fixture: fixtureLabel,
  dictWords: dictWords.size,
  tokens: tokens.length,
  dpMaxTokenLength,
  strategies: {
    greedy,
    dp,
    aho
  }
};

if (argv.out) {
  const outPath = path.resolve(argv.out);
  await fs.writeFile(outPath, JSON.stringify(summary, null, 2));
}

if (argv.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.error('Dictionary segmentation benchmark');
  console.error(`- Dict: ${dictPath}`);
  console.error(`- Words: ${dictWords.size}`);
  console.error(`- Tokens: ${tokens.length}`);
  console.error(`- dpMaxTokenLength: ${dpMaxTokenLength}`);
  for (const [name, stats] of Object.entries(summary.strategies)) {
    console.error(`- ${name} avg segments: ${stats.avgSegmentsPerToken.toFixed(2)}`);
    console.error(`- ${name} coverage: ${(stats.coverage * 100).toFixed(1)}%`);
    console.error(`- ${name} duration: ${stats.durationMs} ms`);
  }
}

#!/usr/bin/env node
// Usage: node tools/bench/vfs/token-uri-encode.js --docs 20000 --lookups 50000 --json
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { writeJsonWithDir } from '../micro/utils.js';
import { buildLookupIndices, clampInt, createRng, printBench, runSampled } from './shared.js';

const rawArgs = process.argv.slice(2);
const cli = createCli({
  scriptName: 'token-uri-encode',
  argv: ['node', 'token-uri-encode', ...rawArgs],
  options: {
    docs: { type: 'number', default: 20000, describe: 'Total token docs' },
    lookups: { type: 'number', default: 50000, describe: 'Lookup count' },
    tokenSize: { type: 'number', default: 12, describe: 'Token length' },
    samples: { type: 'number', default: 10, describe: 'Sample buckets for timing stats' },
    seed: { type: 'number', default: 1 },
    json: { type: 'boolean', default: false },
    out: { type: 'string', describe: 'Write JSON results to a file' }
  }
});
const argv = cli.parse();

const docs = clampInt(argv.docs, 1, 20000);
const lookups = clampInt(argv.lookups, 1, 50000);
const tokenSize = clampInt(argv.tokenSize, 4, 12);
const samples = clampInt(argv.samples, 1, 10);
const seed = Number.isFinite(argv.seed) ? Number(argv.seed) : 1;

const rng = createRng(seed);
const tokens = new Array(docs);
const virtualPaths = new Array(docs);
const tokenMap = new Map();
for (let i = 0; i < docs; i += 1) {
  const token = randomToken(tokenSize, rng);
  const virtualPath = `.poc-vfs/token/${i}.ts`;
  tokens[i] = token;
  virtualPaths[i] = virtualPath;
  tokenMap.set(token, virtualPath);
}

const prefix = 'poc-vfs:///';
const legacyUris = virtualPaths.map((vp) => `${prefix}${encodePath(vp)}`);
const tokenUris = virtualPaths.map((vp, idx) => `${prefix}${encodePath(vp)}?token=${tokens[idx]}`);
const lookupIndices = buildLookupIndices(lookups, docs, seed + 13);

const legacyEncodeBench = runSampled({
  iterations: lookups,
  samples,
  fn: (i) => `${prefix}${encodePath(virtualPaths[lookupIndices[i]])}`
});

const legacyDecodeBench = runSampled({
  iterations: lookups,
  samples,
  fn: (i) => decodePath(legacyUris[lookupIndices[i]].slice(prefix.length))
});

const tokenEncodeBench = runSampled({
  iterations: lookups,
  samples,
  fn: (i) => `${prefix}${encodePath(virtualPaths[lookupIndices[i]])}?token=${tokens[lookupIndices[i]]}`
});

const tokenDecodeBench = runSampled({
  iterations: lookups,
  samples,
  fn: (i) => {
    const uri = tokenUris[lookupIndices[i]];
    const token = uri.split('token=')[1] || '';
    return tokenMap.get(token);
  }
});

const results = {
  generatedAt: new Date().toISOString(),
  docs,
  lookups,
  tokenSize,
  samples,
  bench: {
    legacyEncode: legacyEncodeBench,
    legacyDecode: legacyDecodeBench,
    tokenEncode: tokenEncodeBench,
    tokenDecode: tokenDecodeBench
  }
};

if (argv.out) {
  const outPath = path.resolve(String(argv.out));
  writeJsonWithDir(outPath, results);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.error(`[token-uri] docs=${docs} lookups=${lookups}`);
  printBench('legacy-encode', legacyEncodeBench);
  printBench('legacy-decode', legacyDecodeBench);
  printBench('token-encode', tokenEncodeBench);
  printBench('token-decode', tokenDecodeBench);
}

function randomToken(length, rng) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const chars = new Array(length);
  for (let i = 0; i < length; i += 1) {
    chars[i] = alphabet[Math.floor(rng() * alphabet.length)];
  }
  return chars.join('');
}

function encodePath(virtualPath) {
  return String(virtualPath || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function decodePath(encodedPath) {
  return String(encodedPath || '')
    .split('/')
    .map((part) => decodeURIComponent(part))
    .join('/');
}

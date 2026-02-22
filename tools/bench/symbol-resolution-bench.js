#!/usr/bin/env node
import { createCli } from '../../src/shared/cli.js';
import { buildSymbolIndex, resolveSymbolRef } from '../../src/index/type-inference-crossfile/resolver.js';

const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

const clampRate = (value) => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const createRng = (seedValue) => {
  let seed = Number.isFinite(seedValue) ? Math.floor(seedValue) : 1;
  if (seed <= 0) seed = 1;
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
};

const argv = createCli({
  options: {
    symbols: {
      type: 'number',
      describe: 'Number of symbol definitions to synthesize',
      default: 100000
    },
    refs: {
      type: 'number',
      describe: 'Number of symbol references to resolve',
      default: 200000
    },
    files: {
      type: 'number',
      describe: 'Number of files to spread symbols across',
      default: 2000
    },
    'import-rate': {
      type: 'number',
      describe: 'Fraction of refs that use import bindings',
      default: 0.25
    },
    'duplicate-rate': {
      type: 'number',
      describe: 'Fraction of symbol names that are duplicates',
      default: 0.1
    },
    'duplicate-bucket': {
      type: 'number',
      describe: 'Distinct duplicate name buckets',
      default: 50
    },
    'missing-rate': {
      type: 'number',
      describe: 'Fraction of refs that target missing names',
      default: 0.05
    },
    warmup: {
      type: 'number',
      describe: 'Warmup passes before measurement',
      default: 1
    },
    seed: {
      type: 'number',
      describe: 'Seed for deterministic random generation',
      default: 7
    },
    json: {
      type: 'boolean',
      describe: 'Emit JSON summary only',
      default: false
    }
  }
}).parse();

const symbolCount = Math.max(1, Math.floor(argv.symbols));
const refCount = Math.max(1, Math.floor(argv.refs));
const fileCount = Math.max(1, Math.floor(argv.files));
const duplicateBucket = Math.max(1, Math.floor(argv['duplicate-bucket']));
const importRate = clampRate(Number(argv['import-rate']));
const duplicateRate = clampRate(Number(argv['duplicate-rate']));
const missingRate = clampRate(Number(argv['missing-rate']));
const warmupPasses = Math.max(0, Math.floor(argv.warmup));
const rng = createRng(argv.seed);

const files = Array.from({ length: fileCount }, (_, index) => `src/mod-${index}.js`);
const fileSet = new Set(files);

const fileRelations = new Map();
for (let i = 0; i < fileCount; i += 1) {
  const fromFile = files[i];
  const targetIndex = (i + 1) % fileCount;
  const alias = `Alias${targetIndex}`;
  fileRelations.set(fromFile, {
    importBindings: {
      [alias]: { imported: `File${targetIndex}`, module: `./mod-${targetIndex}.js` }
    }
  });
}

const buildEntries = () => {
  const entries = [];
  const namePool = [];
  for (let i = 0; i < symbolCount; i += 1) {
    const fileIndex = i % fileCount;
    const file = files[fileIndex];
    let name;
    if (i < fileCount) {
      name = `File${fileIndex}`;
    } else if (rng() < duplicateRate) {
      name = `Dup${i % duplicateBucket}`;
    } else {
      name = `Sym${i}`;
    }
    const chunkUid = `ck:test:${fileIndex}:${i}`;
    const qualifiedName = name;
    const symbol = {
      scheme: 'poc',
      symbolId: `sym:${chunkUid}`,
      symbolKey: `symkey:${qualifiedName}:${fileIndex}`,
      signatureKey: null,
      scopedId: `scope:${chunkUid}`,
      kindGroup: 'function',
      qualifiedName,
      chunkUid
    };
    entries.push({
      name,
      qualifiedName,
      file,
      chunkUid,
      kind: 'function',
      symbol
    });
    namePool.push(name);
  }
  return { entries, namePool };
};

const { entries, namePool } = buildEntries();

const indexStart = nowMs();
const symbolIndex = buildSymbolIndex(entries);
const indexMs = nowMs() - indexStart;

const resolveBatch = () => {
  let resolved = 0;
  let ambiguous = 0;
  let unresolved = 0;
  const start = nowMs();
  for (let i = 0; i < refCount; i += 1) {
    const roll = rng();
    let targetName;
    let fromFile = null;
    if (roll < importRate) {
      const fileIndex = Math.floor(rng() * fileCount);
      fromFile = files[fileIndex];
      const targetIndex = (fileIndex + 1) % fileCount;
      targetName = `Alias${targetIndex}`;
    } else if (rng() < missingRate) {
      targetName = `Missing${i}`;
    } else {
      targetName = namePool[Math.floor(rng() * namePool.length)];
    }

    const ref = resolveSymbolRef({
      targetName,
      kindHint: null,
      fromFile,
      fileRelations,
      symbolIndex,
      fileSet
    });

    if (ref.status === 'resolved') resolved += 1;
    else if (ref.status === 'ambiguous') ambiguous += 1;
    else unresolved += 1;
  }
  const elapsedMs = nowMs() - start;
  return { elapsedMs, resolved, ambiguous, unresolved };
};

for (let i = 0; i < warmupPasses; i += 1) {
  resolveBatch();
}

const result = resolveBatch();
const memory = process.memoryUsage();
const throughput = refCount / Math.max(1, result.elapsedMs / 1000);

const summary = {
  symbols: symbolCount,
  refs: refCount,
  files: fileCount,
  importRate,
  duplicateRate,
  duplicateBucket,
  missingRate,
  warmupPasses,
  indexMs: Number(indexMs.toFixed(2)),
  resolveMs: Number(result.elapsedMs.toFixed(2)),
  refsPerSecond: Math.round(throughput),
  resolved: result.resolved,
  ambiguous: result.ambiguous,
  unresolved: result.unresolved,
  memory: {
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    heapTotal: memory.heapTotal
  }
};

if (argv.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  console.log('Symbol resolution benchmark');
  console.log(`symbols: ${symbolCount} | refs: ${refCount} | files: ${fileCount}`);
  console.log(`index build: ${summary.indexMs}ms`);
  console.log(`resolve: ${summary.resolveMs}ms (${summary.refsPerSecond} refs/sec)`);
  console.log(`resolved: ${summary.resolved} | ambiguous: ${summary.ambiguous} | unresolved: ${summary.unresolved}`);
  console.log(`rss: ${(summary.memory.rss / 1024 / 1024).toFixed(1)}MB`);
}

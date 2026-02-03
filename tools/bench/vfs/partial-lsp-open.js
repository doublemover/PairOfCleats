#!/usr/bin/env node
// Usage: node tools/bench/vfs/partial-lsp-open.js --docs 200 --targets 20 --samples 3 --json
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { formatStats, summarizeDurations, writeJsonWithDir } from '../micro/utils.js';

async function main() {
  const rawArgs = process.argv.slice(2);
  const cli = createCli({
    scriptName: 'partial-lsp-open',
    argv: ['node', 'partial-lsp-open', ...rawArgs],
    options: {
      docs: { type: 'number', default: 200, describe: 'Total documents' },
      targets: { type: 'number', default: 20, describe: 'Documents with targets' },
      samples: { type: 'number', default: 3, describe: 'Repeat count for timing stats' },
      mode: { type: 'string', default: 'clangd', describe: 'stub LSP mode (clangd|pyright|sourcekit)' },
      scheme: { type: 'string', default: 'file', describe: 'URI scheme (file|poc-vfs)' },
      json: { type: 'boolean', default: false },
      out: { type: 'string', describe: 'Write JSON results to a file' },
      keep: { type: 'boolean', default: false }
    }
  });
  const argv = cli.parse();

  const docsCount = clampInt(argv.docs, 1, 200);
  const targetCount = clampInt(argv.targets, 1, Math.min(docsCount, 200));
  const samples = clampInt(argv.samples, 1, 3);
  const mode = String(argv.mode || 'clangd').toLowerCase();
  const scheme = argv.scheme === 'poc-vfs' ? 'poc-vfs' : 'file';

  const tempRoot = path.join(os.tmpdir(), `poc-vfs-partial-lsp-${Date.now()}`);
  await fs.mkdir(tempRoot, { recursive: true });

  const serverPath = path.join(process.cwd(), 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
  const documents = buildDocuments(docsCount);
  const targetsSparse = buildTargets(documents, targetCount);
  const targetsAll = buildTargets(documents, docsCount);

  try {
    const sparse = await runScenario({
      label: 'sparse-targets',
      samples,
      documents,
      targets: targetsSparse,
      mode,
      scheme,
      rootDir: tempRoot,
      serverPath
    });

    const full = await runScenario({
      label: 'all-targets',
      samples,
      documents,
      targets: targetsAll,
      mode,
      scheme,
      rootDir: tempRoot,
      serverPath
    });

    const results = {
      generatedAt: new Date().toISOString(),
      docs: docsCount,
      targets: targetCount,
      samples,
      mode,
      scheme,
      bench: {
        sparse,
        allTargets: full
      }
    };

    if (argv.out) {
      const outPath = path.resolve(String(argv.out));
      writeJsonWithDir(outPath, results);
    }

    if (argv.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.error(`[partial-lsp-open] docs=${docsCount} targets=${targetCount} scheme=${scheme}`);
      printBench('sparse-targets', sparse);
      printBench('all-targets', full);
    }
  } finally {
    if (!argv.keep) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}

function clampInt(value, min, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function buildDocuments(count) {
  const docs = [];
  const text = 'int add(int a, int b) { return a + b; }\n';
  for (let i = 0; i < count; i += 1) {
    docs.push({
      virtualPath: `.poc-vfs/src/doc-${i}.cpp#seg:bench.cpp`,
      text,
      languageId: 'cpp',
      effectiveExt: '.cpp'
    });
  }
  return docs;
}

function buildTargets(documents, count) {
  const targets = [];
  for (let i = 0; i < Math.min(count, documents.length); i += 1) {
    const doc = documents[i];
    const chunkUid = `ck64:v1:bench:doc-${i.toString(16).padStart(6, '0')}`;
    targets.push({
      chunkRef: {
        docId: i,
        chunkUid,
        chunkId: `chunk_${i}`,
        file: `src/doc-${i}.cpp`,
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: doc.text.length }
      },
      virtualPath: doc.virtualPath,
      virtualRange: { start: 0, end: doc.text.length },
      symbolHint: { name: 'add', kind: 'function' }
    });
  }
  return targets;
}

async function runScenario({ label, samples, documents, targets, mode, scheme, rootDir, serverPath }) {
  const timings = [];
  let totalMs = 0;
  for (let i = 0; i < samples; i += 1) {
    const start = process.hrtime.bigint();
    await collectLspTypes({
      rootDir,
      vfsRoot: rootDir,
      documents,
      targets,
      cmd: process.execPath,
      args: [serverPath, '--mode', mode, '--exit-on-shutdown'],
      uriScheme: scheme,
      timeoutMs: 15000,
      parseSignature: (detail) => ({
        signature: detail,
        returnType: 'int',
        paramTypes: { a: 'int', b: 'int' }
      })
    });
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsed);
    totalMs += elapsed;
  }
  const stats = summarizeDurations(timings);
  const docsPerSec = totalMs > 0 ? documents.length / (totalMs / 1000) : 0;
  return {
    label,
    totalMs,
    stats,
    docs: documents.length,
    targets: targets.length,
    docsPerSec
  };
}

function printBench(label, bench) {
  const stats = bench.stats ? formatStats(bench.stats) : 'n/a';
  const rate = Number.isFinite(bench.docsPerSec) ? bench.docsPerSec.toFixed(1) : 'n/a';
  console.error(`- ${label}: ${stats} | docs=${bench.docs} targets=${bench.targets} | docs/sec ${rate}`);
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});

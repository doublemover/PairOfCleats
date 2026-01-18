#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { createDisplay } from '../src/shared/cli/display.js';
import { loadChunkMeta, loadTokenPostings, MAX_JSON_BYTES } from '../src/shared/artifact-io.js';
import { writeJsonObjectFile } from '../src/shared/json-stream.js';
import { tryRequire } from '../src/shared/optional-deps.js';
import { normalizeTantivyConfig, resolveTantivyPaths, TANTIVY_SCHEMA_VERSION } from '../src/shared/tantivy.js';
import {
  getIndexDir,
  loadUserConfig,
  resolveIndexRoot,
  resolveRepoRoot
} from './dict-utils.js';

const argv = createCli({
  scriptName: 'build-tantivy-index',
  options: {
    mode: { type: 'string', default: 'all' },
    repo: { type: 'string' },
    'index-root': { type: 'string' },
    progress: { type: 'string', default: 'auto' },
    verbose: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false }
  }
}).parse();

const display = createDisplay({
  stream: process.stderr,
  progressMode: argv.progress,
  verbose: argv.verbose === true,
  quiet: argv.quiet === true
});
const log = (message) => display.log(message);
const warn = (message) => display.warn(message);
const fail = (message, code = 1) => {
  display.error(message);
  display.close();
  process.exit(code);
};

const tantivyResult = tryRequire('tantivy', { verbose: argv.verbose, logger: warn });
if (!tantivyResult.ok) {
  fail('tantivy is required. Install the optional "tantivy" dependency first.');
}
const tantivy = tantivyResult.mod?.default && Object.keys(tantivyResult.mod).length === 1
  ? tantivyResult.mod.default
  : tantivyResult.mod;
const buildIndex = tantivy?.buildIndex || tantivy?.build;
if (typeof buildIndex !== 'function') {
  fail('tantivy module missing buildIndex/build entrypoint.');
}

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const root = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(root);
const indexRoot = argv['index-root']
  ? path.resolve(argv['index-root'])
  : resolveIndexRoot(root, userConfig);
const tantivyConfig = normalizeTantivyConfig(userConfig.tantivy || {});

const modes = [];
const modeArg = String(argv.mode || '').trim().toLowerCase();
if (modeArg === 'all') {
  modes.push('code', 'prose', 'extracted-prose', 'records');
} else if (['code', 'prose', 'extracted-prose', 'records'].includes(modeArg)) {
  modes.push(modeArg);
} else {
  fail('Invalid mode. Use --mode all|code|prose|extracted-prose|records');
}

for (const mode of modes) {
  const indexDir = getIndexDir(root, mode, userConfig, { indexRoot });
  if (!fsSync.existsSync(indexDir)) {
    fail(`Index directory missing for mode=${mode} (${indexDir}).`);
  }
  const { dir, metaPath } = resolveTantivyPaths(indexDir, mode, tantivyConfig);
  await fs.mkdir(dir, { recursive: true });

  log(`[tantivy] Building index for ${mode}...`);
  const chunkMeta = await loadChunkMeta(indexDir, { maxBytes: MAX_JSON_BYTES });
  const tokenPostings = loadTokenPostings(indexDir, { maxBytes: MAX_JSON_BYTES });
  const totalDocs = Number.isFinite(Number(tokenPostings.totalDocs))
    ? Number(tokenPostings.totalDocs)
    : (Array.isArray(tokenPostings.docLengths) ? tokenPostings.docLengths.length : chunkMeta.length);

  await Promise.resolve(buildIndex({
    indexPath: dir,
    mode,
    vocab: tokenPostings.vocab,
    postings: tokenPostings.postings,
    docLengths: tokenPostings.docLengths,
    avgDocLen: tokenPostings.avgDocLen,
    totalDocs,
    chunkMeta
  }));

  const meta = {
    schemaVersion: TANTIVY_SCHEMA_VERSION,
    mode,
    createdAt: new Date().toISOString(),
    chunkCount: chunkMeta.length,
    docCount: totalDocs,
    vocabCount: Array.isArray(tokenPostings.vocab) ? tokenPostings.vocab.length : 0
  };
  await writeJsonObjectFile(metaPath, { fields: meta, atomic: true });
  log(`[tantivy] Wrote ${metaPath}`);
}

display.close();

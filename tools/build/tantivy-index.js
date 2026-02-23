#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { createToolDisplay } from '../shared/cli-display.js';
import { loadChunkMeta, loadTokenPostings, MAX_JSON_BYTES } from '../../src/shared/artifact-io.js';
import { hasChunkMetaArtifactsSync } from '../../src/shared/index-artifact-helpers.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { tryRequire } from '../../src/shared/optional-deps.js';
import { normalizeTantivyConfig, resolveTantivyPaths, TANTIVY_SCHEMA_VERSION } from '../../src/shared/tantivy.js';
import {
  getIndexDir,
  resolveIndexRoot,
  resolveRepoConfig
} from '../shared/dict-utils.js';

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

const display = createToolDisplay({ argv, stream: process.stderr });
const log = (message) => display.log(message);
const warn = (message) => display.warn(message);
const fail = (message, code = 1) => {
  display.error(message);
  display.close();
  process.exit(code);
};
/**
 * Coarse sparse-artifact readiness probe for Tantivy materialization.
 *
 * @param {string|null|undefined} indexDir
 * @returns {boolean}
 */
const hasChunkMeta = (indexDir) => {
  return hasChunkMetaArtifactsSync(indexDir);
};
const hasTokenPostings = (indexDir) => {
  const jsonPath = path.join(indexDir, 'token_postings.json');
  const metaPath = path.join(indexDir, 'token_postings.meta.json');
  const shardsDir = path.join(indexDir, 'token_postings.shards');
  return fsSync.existsSync(jsonPath)
    || (fsSync.existsSync(metaPath) && fsSync.existsSync(shardsDir));
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

const { repoRoot: root, userConfig } = resolveRepoConfig(argv.repo);
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
  if (!hasChunkMeta(indexDir)) {
    fail(`[tantivy] chunk_meta missing for mode=${mode} (${indexDir}). Run "pairofcleats index build --mode ${mode}" first.`);
  }
  if (!hasTokenPostings(indexDir)) {
    fail(`[tantivy] token_postings missing for mode=${mode} (${indexDir}). Run "pairofcleats index build --mode ${mode}" first.`);
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

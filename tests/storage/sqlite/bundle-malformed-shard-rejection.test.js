#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import Database from 'better-sqlite3';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-malformed-shard-'));
// Simulate a parser worker response that passed its transport envelope while
// exercising the real exported importer, SQLite transaction, and failure result.
const loader = `export const createBundleLoader=()=>({useWorkers:false,close:async()=>{},async *iterateBundleShards(records){for(const {file} of records)yield {ok:true,file,finalShard:true,bundleShards:[{}]};}});`;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/from-bundles.js') && specifier === './bundle-loader.js') {
    return { url: `data:text/javascript,${encodeURIComponent(loader)}`, shortCircuit: true };
  }
  return next(specifier, context);
} });
try {
  const { buildDatabaseFromBundles } = await import('../../../src/storage/sqlite/build/from-bundles.js');
  const result = await buildDatabaseFromBundles({ Database, outPath: path.join(root, 'index.db'), mode: 'code',
    incrementalData: { bundleDir: root, manifest: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      files: { 'a.js': { bundles: ['a.json'], size: 1, mtimeMs: 1 } } } },
    envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 }, emitOutput: false,
    validateMode: 'off', vectorConfig: { enabled: false }, modelConfig: {} });
  assert.match(result.reason, /Bundle missing chunks/);
  assert.equal(result.count, 0);
} finally { hook.deregister(); await fs.rm(root, { recursive: true, force: true }); }
console.log('SQLite bundle importer rejects malformed shard worker payloads');

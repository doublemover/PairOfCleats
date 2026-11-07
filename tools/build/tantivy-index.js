#!/usr/bin/env node
import path from 'node:path';
import { tryRequire } from '../../src/shared/optional-deps.js';
import { normalizeTantivyConfig } from '../../src/shared/tantivy.js';
import { getIndexDir, resolveIndexRoot, resolveRepoConfig } from '../shared/dict-utils.js';
import { createIndexBuildToolCli } from './index-tool-cli.js';
import { buildTantivyGeneration } from './tantivy-generation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { describeStorageFailure, observeStorageResource } from '../../src/shared/storage/failure-observation.js';

const { argv, display, log, warn } = createIndexBuildToolCli({
  scriptName: 'build-tantivy-index',
  options: {
    mode: { type: 'string', default: 'all' }, repo: { type: 'string' },
    'index-root': { type: 'string' }, progress: { type: 'string', default: 'auto' },
    verbose: { type: 'boolean', default: false }, quiet: { type: 'boolean', default: false }
  }
});
const controller = new AbortController();
const cancel = () => controller.abort();
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
let failure, failed = false;
try {
  const result = tryRequire('tantivy', { verbose: argv.verbose, logger: warn });
  if (!result.ok) throw new Error('tantivy is required. Install the optional "tantivy" dependency first.');
  const api = result.mod?.default && Object.keys(result.mod).length === 1 ? result.mod.default : result.mod;
  const build = api?.buildIndex || api?.build;
  if (typeof build !== 'function') throw new Error('tantivy module missing buildIndex/build entrypoint.');
  const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
  const indexRoot = argv['index-root'] ? path.resolve(argv['index-root']) : resolveIndexRoot(repoRoot, userConfig);
  const config = normalizeTantivyConfig(userConfig.tantivy || {});
  const mode = String(argv.mode || '').trim().toLowerCase();
  const modes = mode === 'all' ? ['code', 'prose', 'extracted-prose', 'records'] : [mode];
  if (modes.some(value => !['code', 'prose', 'extracted-prose', 'records'].includes(value))) {
    throw new Error('Invalid mode. Use --mode all|code|prose|extracted-prose|records');
  }
  for (const selected of modes) {
    await buildTantivyGeneration({ repoRoot, userConfig, mode: selected, config,
      indexDir: getIndexDir(repoRoot, selected, userConfig, { indexRoot }),
      buildIndex: build.bind(api), signal: controller.signal, log });
  }
} catch (error) {
  failure = error; failed = true;
  process.exitCode = error?.name === 'AbortError' ? 130 : 1;
} finally {
  process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  try { await display.close(); }
  catch (cleanup) {
    failure = failed ? addStorageFailureContext(failure, {}, cleanup, { secondaryPresent: true }) : cleanup;
    failed = true; process.exitCode = 1;
  }
}
if (failed) {
  const observation = observeStorageResource(failure, { phase: 'tantivy-build-tool' });
  if (!observation.isSettled()) {
    console.error('[tantivy] Build failed; original resource settlement remains unconfirmed. Storage protection is retained.');
  } else {
    const diagnostic = describeStorageFailure(failure, { phase: 'tantivy-build-tool', defaultCode: 'ERR_TANTIVY_BUILD' });
    console.error(`[tantivy] ${diagnostic.code}: ${diagnostic.message || 'Build or finalization failed.'}`);
  }
}

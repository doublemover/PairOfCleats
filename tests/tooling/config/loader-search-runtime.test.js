#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSearchArgs } from '../../../src/retrieval/cli-args.js';
import { normalizeSearchOptions } from '../../../src/retrieval/cli/normalize-options.js';
import { resolveRunConfig } from '../../../src/retrieval/cli/resolve-run-config.js';
import { getEffectiveConfigHash, loadUserConfig } from '../../../tools/dict-utils/config.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testConfig: null });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-loader-search-'));
const configPath = path.join(root, '.pairofcleats.json');
const resolve = (rawArgs = ['fixture'], policy = null) => normalizeSearchOptions({
  argv: parseSearchArgs(rawArgs),
  rawArgs,
  rootDir: root,
  metricsDir: null,
  userConfig: loadUserConfig(root),
  policy
});

try {
  const defaults = resolve();
  assert.equal(defaults.annEnabled, true);
  assert.equal(defaults.denseVectorMode, 'merged');
  assert.equal(defaults.rrfEnabled, true);
  assert.equal(defaults.rrfK, 60);
  assert.equal(defaults.maxCandidates, null);
  assert.equal(defaults.fieldWeightsConfig, null);
  assert.equal(defaults.scoreBlendEnabled, false);
  assert.equal(defaults.scoreBlendSparseWeight, 1);
  assert.equal(defaults.scoreBlendAnnWeight, 1);
  const defaultHash = getEffectiveConfigHash(root);

  const config = {
    search: {
      annDefault: false,
      denseVectorMode: 'code',
      rrf: { enabled: false, k: 23 },
      scoreBlend: { enabled: true, sparseWeight: 0, annWeight: 0.75 },
      fieldWeights: { name: 4, body: 0 },
      sqliteFtsWeights: { name: 4, body: 0 },
      maxCandidates: 500
    },
    retrieval: { contextExpansion: { enabled: true, maxPerHit: 2, maxTotal: 8 } }
  };
  await fs.writeFile(configPath, JSON.stringify(config));
  const options = resolve(['fixture'], { retrieval: { ann: { enabled: true }, rrf: { enabled: true, k: 90 } } });
  assert.equal(options.annEnabled, false);
  assert.equal(options.denseVectorMode, 'code');
  assert.equal(options.rrfEnabled, false);
  assert.equal(options.rrfK, 23);
  assert.equal(options.scoreBlendEnabled, true);
  assert.equal(options.scoreBlendSparseWeight, 0);
  assert.equal(options.scoreBlendAnnWeight, 0.75);
  assert.deepEqual(options.fieldWeightsConfig, { name: 4, body: 0 });
  assert.equal(options.sqliteFtsWeights[2], 4);
  assert.equal(options.sqliteFtsWeights[7], 0);
  assert.equal(options.maxCandidates, 500);
  assert.equal(options.contextExpansionEnabled, true);
  assert.equal(options.contextExpansionOptions.maxPerHit, 2);
  assert.equal(options.contextExpansionOptions.maxTotal, 8);
  const configuredHash = getEffectiveConfigHash(root);
  assert.notEqual(configuredHash, defaultHash, 'effective hash must include persistent search tuning');

  const warnings = [];
  const originalWarn = console.warn;
  let cli;
  try {
    console.warn = (message) => warnings.push(message);
    cli = resolve(['fixture', '--ann', '--dense-vector-mode', 'doc', '--fts-weights', '0,1,2,3,4,5,6,7']);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(cli.annEnabled, true);
  assert.equal(cli.denseVectorMode, 'doc');
  assert.deepEqual(cli.sqliteFtsWeights, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(warnings.some((message) => message.includes('takes precedence')));
  assert.equal(getEffectiveConfigHash(root), configuredHash, 'CLI resolution must not mutate repo config');
  const sparse = resolveRunConfig({ normalized: options, scoreModeOverride: 'sparse' });
  assert.equal(sparse.annEnabled, false);
  assert.equal(sparse.scoreBlendEnabled, false);
  assert.equal(sparse.rrfEnabled, false);

  config.search.annDefault = true;
  config.search.maxCandidates = 0;
  config.search.sqliteFtsWeights = [0, 1, 2, 3, 4, 5, 6, 7];
  await fs.writeFile(configPath, JSON.stringify(config));
  assert.equal(resolve(['fixture', '--no-ann']).annEnabled, false);
  assert.equal(resolve().maxCandidates, 0, 'zero must reach runtime without becoming an absent value');
  assert.deepEqual(resolve().sqliteFtsWeights, config.search.sqliteFtsWeights);

  config.search.rrf.k = 0;
  await fs.writeFile(configPath, JSON.stringify(config));
  assert.throws(() => resolve(), /search.rrf.k must be a positive number/);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log('config loader search runtime test passed');

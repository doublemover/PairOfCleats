#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadUserConfig } from '../../../src/shared/dict-utils.js';
import { validateConfig } from '../../../src/config/validate.js';
import { loadConfigSchema } from '../../helpers/config-schema.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { normalizeSearchOptions } from '../../../src/retrieval/cli/normalize-options.js';
import { createModeExpander } from '../../../src/retrieval/cli/run-search-session/mode-expansion.js';
import { parseSearchArgs } from '../../../src/retrieval/cli-args.js';
import { REMOVED_FLAGS } from '../../../src/retrieval/cli-options.js';

for (const args of [['--human'], ['--human=true'], ['--context', '3'], ['--context=3'], ['--headline'],
  ['--human', '--context=3']]) {
  assert.throws(() => parseSearchArgs(args), error => {
    assert.equal(error.code, 'REMOVED_FLAG');
    assert.match(error.message, /search --help --all --json/);
    if (args.some(value => value.startsWith('--context'))) {
      assert.equal(error.remedies.find(value => value.flag === '--context').configPath, 'retrieval.contextExpansion');
      assert.doesNotMatch(error.message, /search\.contextExpansion/);
    }
    return true;
  });
}
assert.equal(parseSearchArgs([]).json, false, 'removing --human preserves its requested output mode');
assert.equal(parseSearchArgs(['--json']).json, true);
assert.deepEqual(parseSearchArgs(['--', '--human'])._, ['--human'], 'literal query words remain outside removed-option repair');
assert.deepEqual(REMOVED_FLAGS.map(value => value.flag), ['--human', '--headline', '--context']);
console.log('removed option remedies preserve actual current CLI/config intent');

const { dir: remedyRoot } = await prepareIsolatedTestCacheDir('removed-flag-remedy-consumer');
try {
  const configPath = REMOVED_FLAGS.find(entry => entry.flag === '--context').configPath.split('.');
  const repairedConfig = {}; let target = repairedConfig;
  for (const part of configPath.slice(0, -1)) target = target[part] = {};
  target[configPath.at(-1)] = { enabled: true, includeCalls: true, maxPerHit: 1, maxTotal: 1 };
  assert.equal(validateConfig(await loadConfigSchema(), repairedConfig).ok, true, 'advertised path is public schema');
  await fs.writeFile(path.join(remedyRoot, '.pairofcleats.json'), JSON.stringify(repairedConfig));
  const loaded = loadUserConfig(remedyRoot);
  const options = normalizeSearchOptions({ argv: parseSearchArgs(['seed']), rawArgs: ['seed'],
    rootDir: remedyRoot, userConfig: loaded, policy: {} });
  assert.equal(options.contextExpansionEnabled, true);
  assert.equal(options.contextExpansionOptions.maxPerHit, 1); assert.equal(options.contextExpansionOptions.maxTotal, 1);
  const idx = { chunkMeta: [{ id: 0, name: 'seed', file: 'seed.js',
    codeRelations: { calls: [['seed', 'targetA'], ['seed', 'targetB']] } },
  { id: 1, name: 'targetA', file: 'target.js' }, { id: 2, name: 'targetB', file: 'target.js' }] };
  const expanded = await createModeExpander(options).expandModeHits('code', idx, [{ id: 0 }]);
  assert.equal(expanded.contextHits.length, 1, 'actual expansion consumes the emitted config remedy and its bound');
  assert.ok([1, 2].includes(expanded.contextHits[0].id));
} finally {
  assert.ok(path.resolve(remedyRoot).startsWith(path.resolve(process.cwd()) + path.sep));
  await fs.rm(remedyRoot, { recursive: true, force: true });
}

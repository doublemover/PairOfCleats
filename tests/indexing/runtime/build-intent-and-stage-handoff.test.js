import assert from 'node:assert/strict';
import { parseBuildArgs } from '../../../src/index/build/args.js';
import { buildStage2Args } from '../../../src/integrations/core/args.js';
import { validateBuildIntent } from '../../../src/shared/cli-option-validators.js';
import { createCli } from '../../../src/shared/cli.js';
import { TOOLING_INSTALL_OPTIONS } from '../../../src/shared/cli-option-sets.js';
import { selectInstallPlan } from '../../../tools/tooling/utils.js';

for (const raw of [['status'], ['bulid'], ['extra'], ['--stage', 'stage5'], ['--stage='], ['--mode', 'cod'], ['--quality', 'fas']]) {
  assert.throws(() => parseBuildArgs(raw), /validation|must be|unexpected/);
}
for (const stage of ['1', 'sparse', '2', 'enrich', 'full', '3', 'embed', 'embeddings', '4', 'ann', 'sqlite']) {
  assert.doesNotThrow(() => parseBuildArgs(['--stage', stage]));
}
for (const intent of [{ stage: '' }, { stage: 'stage5' }, { mode: 'cod' }, { quality: 'fas' }, { modes: ['code', 'typo'] }]) {
  assert.throws(() => validateBuildIntent(intent));
}
for (const [raw, expected] of [
  [[], false], [['--stub-embeddings'], true], [['--stub-embeddings=true'], true],
  [['--stub-embeddings', 'false'], false], [['--stub-embeddings=false'], false], [['--no-stub-embeddings'], false]
]) {
  const rawArgv = [...raw, '--validate-ordering', '--cache-rebuild', '--scheduler=false', '--scm-provider', 'none'];
  const { argv } = parseBuildArgs(rawArgv);
  const handed = buildStage2Args({ root: process.cwd(), argv, rawArgv });
  const child = parseBuildArgs(handed).argv;
  assert.equal(child['stub-embeddings'], expected);
  assert.equal(child['validate-ordering'], true);
  assert.equal(child.scheduler, false);
  assert.equal(child['scm-provider'], 'none');
  assert.equal(child['cache-rebuild'], false);
  assert.equal(child.stage, 'stage2');
}
const tool = { install: { user: { cmd: 'rustup', args: ['component', 'add', 'rust-analyzer'] } } };
for (const raw of [['--no-fallback'], ['--no-fallback=true'], ['--no-fallback', 'true']]) {
  const argv = createCli({ argv: ['node', 'install.js', ...raw], options: TOOLING_INSTALL_OPTIONS })
    .parserConfiguration({ 'boolean-negation': false }).parse();
  assert.equal(argv['no-fallback'], true);
  assert.equal(selectInstallPlan(tool, 'cache', !argv['no-fallback']).plan, null);
}
console.log('Build intent and Stage2 parsed flags remain authoritative.');

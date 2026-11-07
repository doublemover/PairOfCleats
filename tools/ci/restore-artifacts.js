#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { resolveRepoConfig } from '../shared/dict-utils.js';
import { readRepoGitState } from '../shared/git-state.js';
import { restoreCiArtifactBundle } from './artifact-bundle.js';

const argv = createCli({ scriptName: 'ci-restore', options: {
  force: { type: 'boolean', default: false }, from: { type: 'string' }, repo: { type: 'string' }
} }).parse();
const { repoRoot: root, userConfig } = resolveRepoConfig(argv.repo);
try {
  await restoreCiArtifactBundle({ root, userConfig, fromDir: argv.from ? path.resolve(argv.from) : path.join(root, 'ci-artifacts'),
    gitState: await readRepoGitState(root), force: argv.force });
  console.error('CI artifacts restored and published.');
} catch (error) {
  console.error(error?.message || error);
  if (error.recoveryPath) console.error(`Unselected restore evidence retained at ${error.recoveryPath}`);
  process.exitCode = 1;
}

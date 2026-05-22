#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createStage1CodeBuildEnv, runStage1CodeBuildOrExit } from '../../helpers/build-index-fixture.js';
import { runNode } from '../../helpers/run-node.js';
import { setupToolingInstallWorkspace } from '../../helpers/tooling-install-fixture.js';

const {
  root,
  repoRoot,
  outsideRoot,
  cacheRoot
} = await setupToolingInstallWorkspace('tool-root', {
  root: process.cwd(),
  includeOutsideRoot: true
});
const srcDir = path.join(repoRoot, 'src');

await fsPromises.mkdir(srcDir, { recursive: true });

await fsPromises.writeFile(
  path.join(srcDir, 'index.js'),
  'export function greet(name) {\n  return `hi ${name}`;\n}\n',
  'utf8'
);

const env = createStage1CodeBuildEnv({ cacheRoot });

await runStage1CodeBuildOrExit({
  root,
  repoRoot,
  cwd: outsideRoot,
  env,
  failureLabel: 'build_index from outside repo root'
});

const searchResult = runNode(
  [path.join(root, 'search.js'), 'greet', '--json', '--mode', 'code', '--no-ann', '--repo', repoRoot],
  'search from outside repo root',
  outsideRoot,
  env,
  { stdio: 'pipe' }
);

let payload = null;
try {
  payload = JSON.parse(searchResult.stdout || '{}');
} catch {
  console.error('Failed: search output was not JSON');
  process.exit(1);
}

const hits = payload.code || [];
if (!hits.length) {
  console.error('Failed: search returned no results');
  process.exit(1);
}

console.log('Tool root outside-repo test passed');


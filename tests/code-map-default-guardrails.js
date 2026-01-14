#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_LIMITS } from '../src/map/constants.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'code-map-default-guardrails');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });

const functionCount = DEFAULT_LIMITS.maxMembersPerFile + 15;
let source = '';
for (let i = 0; i < functionCount; i += 1) {
  source += `export function fn${i}(value) { return value + ${i}; }\n`;
}

await fsPromises.writeFile(path.join(repoRoot, 'src', 'many.js'), source);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (buildResult.status !== 0) {
  console.error('Failed: build index for code map default guardrails test');
  process.exit(buildResult.status ?? 1);
}

const mapResult = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'report-code-map.js'), '--format', 'json', '--repo', repoRoot],
  { cwd: repoRoot, env, encoding: 'utf8' }
);

if (mapResult.status !== 0) {
  console.error('Failed: report-code-map for default guardrails test');
  if (mapResult.stderr) console.error(mapResult.stderr.trim());
  process.exit(mapResult.status ?? 1);
}

let model = null;
try {
  model = JSON.parse(mapResult.stdout || '{}');
} catch {
  console.error('Failed: map output invalid JSON (default guardrails test)');
  process.exit(1);
}

const fileNode = (model.nodes || []).find((node) => node?.path === 'src/many.js');
if (!fileNode) {
  console.error('Failed: map missing src/many.js node (default guardrails test)');
  process.exit(1);
}

const members = Array.isArray(fileNode.members) ? fileNode.members : [];
if (members.length > DEFAULT_LIMITS.maxMembersPerFile) {
  console.error(
    `Failed: expected members <= ${DEFAULT_LIMITS.maxMembersPerFile} but saw ${members.length}`
  );
  process.exit(1);
}

const droppedMembers = model?.summary?.dropped?.members ?? 0;
const truncated = model?.summary?.truncated === true;
if (!truncated || droppedMembers <= 0) {
  console.error('Failed: expected map summary to indicate truncation (default guardrails test)');
  process.exit(1);
}

console.log('code map default guardrails tests passed');

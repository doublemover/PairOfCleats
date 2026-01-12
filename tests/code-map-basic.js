#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'code-map-basic');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const config = {
  indexing: {
    astDataflow: true,
    controlFlow: true,
    typeInference: true,
    typeInferenceCrossFile: true
  }
};

await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify(config, null, 2)
);

await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'util.js'),
  'export function add(a, b) { return a + b; }\n' +
    'export function mutate(obj) { obj.count = obj.count + 1; return obj; }\n'
);
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'main.js'),
  'import { add, mutate } from "./util.js";\n' +
    'function run(x) {\n' +
    '  if (x > 0) { return add(x, 1); }\n' +
    '  return add(x, 2);\n' +
    '}\n' +
    'async function go(items) {\n' +
    '  for (const item of items) {\n' +
    '    await Promise.resolve(item);\n' +
    '    mutate(item);\n' +
    '  }\n' +
    '}\n' +
    'export default function main(items) { return go(items); }\n'
);

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
  console.error('Failed: build index for code map basic test');
  process.exit(buildResult.status ?? 1);
}

const mapResult = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'report-code-map.js'), '--format', 'json', '--repo', repoRoot],
  { cwd: repoRoot, env, encoding: 'utf8' }
);

if (mapResult.status !== 0) {
  console.error('Failed: map generator');
  if (mapResult.stderr) console.error(mapResult.stderr.trim());
  process.exit(mapResult.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(mapResult.stdout || '{}');
} catch {
  console.error('Failed: map output invalid JSON');
  process.exit(1);
}

if (!Array.isArray(payload.nodes) || payload.nodes.length === 0) {
  console.error('Failed: map nodes missing');
  process.exit(1);
}

const members = payload.nodes.flatMap((node) => node.members || []);
if (!members.length) {
  console.error('Failed: map members missing');
  process.exit(1);
}

const hasControlFlow = members.some((member) => member.controlFlow);
const hasDataflow = members.some((member) => member.dataflow);
if (!hasControlFlow || !hasDataflow) {
  console.error('Failed: expected dataflow/controlFlow metadata');
  process.exit(1);
}

const edgeTypes = new Set(payload.edges.map((edge) => edge.type));
if (!edgeTypes.has('import') || !edgeTypes.has('call')) {
  console.error('Failed: expected import + call edges');
  process.exit(1);
}

console.log('code map basic tests passed');

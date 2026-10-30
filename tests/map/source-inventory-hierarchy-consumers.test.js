import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { buildIndex } from '../../src/integrations/core/build-index.js';
import { getIndexDir } from '../../src/shared/repo-paths.js';
import { buildCodeMap } from '../../src/map/build-map.js';
import { writeMapJsonStream } from '../../src/map/build-map/io.js';
import { assertMapConsumerComposition } from '../helpers/map-consumer-assertions.js';

const { dir } = await prepareIsolatedTestCacheDir('map-source-inventory-hierarchy');
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
const sources = {
  'src/empty.js': '',
  'src/comment.js': '// No declarations here.\n',
  'src/import-only.js': 'import "./empty.js";\n',
  'src/side-effect.js': 'globalThis.inventoryWitness = 1;\n',
  'src/mixed.js': 'import "./empty.js";\nimport "external-package";\nexport function visible(input) { const first = input; const second = first; const third = second; const fourth = third; const fifth = fourth; return fifth; }\nconsole.log("unnamed");\n'
};
for (const [file, text] of Object.entries(sources)) {
  await fs.mkdir(path.dirname(path.join(repo, file)), { recursive: true });
  await fs.writeFile(path.join(repo, file), text);
}
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', testConfig: {
  threads: 1, indexing: { scm: { provider: 'none' }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
} });
try {
  await buildIndex(repo, { mode: 'code', stage: 'stage2', threads: 1, log: () => {} });
  const indexDir = getIndexDir(repo, 'code');
  const map = await buildCodeMap({ repoRoot: repo, indexDir, options: { include: ['imports', 'exports', 'aliases'] } });
  const output = path.join(dir, 'map.json'), { nodes, edges, ...mapBase } = map;
  await writeMapJsonStream({ filePath: output, mapBase, nodes, edges });
  const exported = JSON.parse(await fs.readFile(output, 'utf8'));
  assert.deepEqual(exported, JSON.parse(JSON.stringify(map)));
  assert.deepEqual(exported.nodes.map(node => node.path).sort(), Object.keys(sources).sort());
  for (const file of Object.keys(sources).filter(file => file !== 'src/mixed.js')) {
    assert.deepEqual(exported.nodes.find(node => node.path === file).members, [], file);
  }
  const mixed = exported.nodes.find(node => node.path === 'src/mixed.js');
  assert.deepEqual(mixed.members.map(member => member.name), ['visible']);
  const labels = ['first=input', 'second=first', 'third=second', 'fourth=third', 'fifth=fourth'];
  assert.deepEqual([...mixed.members[0].dataflow.aliases].sort(), [...labels].sort());
  assert.ok(exported.edges.some(edge => edge.type === 'import'
    && edge.from.file === 'src/import-only.js' && edge.to.file === 'src/empty.js'));
  assert.ok(exported.edges.some(edge => edge.type === 'import'
    && edge.from.file === 'src/mixed.js' && edge.to.file === 'src/empty.js'));
  assert.ok(exported.nodes.every(node => node.path !== 'external-package'));
  await assertMapConsumerComposition(exported, { emptyFiles: Object.keys(sources).filter(file => file !== 'src/mixed.js'),
    aliases: new Map([[mixed.members[0].id, mixed.members[0].dataflow.aliases]]) });
  const scoped = await buildCodeMap({ repoRoot: repo, indexDir,
    options: { include: ['imports'], scope: 'file', focus: 'src/import-only.js' } });
  assert.ok(scoped.nodes.some(node => node.path === 'src/import-only.js'));
  assert.ok(scoped.nodes.every(node => Object.hasOwn(sources, node.path)));
  assert.ok(scoped.edges.every(edge => scoped.nodes.some(node => node.path === edge.from.file)
    && scoped.nodes.some(node => node.path === edge.to.file)));
  // Optional explicit manual-browser input. Ordinary runs leave no durable
  // fixture; a caller chooses the destination rather than relying on a cache.
  const destinationFlag = process.argv.indexOf('--export-map');
  if (destinationFlag !== -1) {
    assert.ok(process.argv[destinationFlag + 1], '--export-map requires an explicit file path');
    const destination = path.resolve(process.argv[destinationFlag + 1]);
    await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(output, destination);
  }
  console.log(JSON.stringify({ exportedMap: output, files: exported.nodes.length,
    namedMembers: exported.summary.counts.members, omitted: exported.summary.omittedEndpoints }));
} finally { await fs.rm(dir, { recursive: true, force: true }); }

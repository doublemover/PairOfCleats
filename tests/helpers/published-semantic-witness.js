import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIndex } from '../../src/integrations/core/index.js';
import { openPublishedSemanticStore } from '../../src/semantic/published-store.js';
import { getIndexDir, loadUserConfig } from '../../tools/shared/dict-utils.js';
import { applyTestEnv } from './test-env.js';

export const SEMANTIC_WITNESS_SOURCES = Object.freeze({
  'snapshot.ts': `export function build(seed:number) {
  const buffer=new Uint8Array([seed]);const alias=buffer;
  const before=alias.slice();alias[0]=seed+1;
  const after=buffer.slice();alias[0]=seed+2;
  const live=buffer.subarray();return [before[0],after[0],live[0]];
}
export function render(payload:number[]) {return \`<output>\${payload}</output>\`;}
`,
  'host.ts': `import {MessageChannel} from 'node:worker_threads';
import {build,render} from './snapshot.js';
export function firstRun(){const one=new MessageChannel();const first=build(10);
  one.port2.on('message',payload=>render(payload));one.port1.postMessage(first);}
export function secondRun(){const two=new MessageChannel();const second=build(20);
  two.port2.on('message',payload=>render(payload));two.port1.postMessage(second);}
firstRun();secondRun();
`
});

/** Real whole-generation publication, shared by semantic/runtime/browser tests.
 * This helper only executes when an authorized acceptance fixture invokes it.
 */
export const createPublishedSemanticWitness = async ({ root, revision = 0, incremental = false,
  abortSignal = null, recordPartitionFilter = null, threads = undefined, extraIgnore = undefined,
  compilerAdmission = { maxResidentBytes: 1024 * 1024 * 1024 }, extraEnv = undefined } = {}) => {
  if (!root) throw new TypeError('Task-owned witness root required.');
  const repoRoot = path.join(root, 'repo'), cacheRoot = path.join(root, 'cache');
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    types: ['node'], typeRoots: [path.resolve('node_modules/@types')], target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext'
  }, include: ['*.ts'] }));
  await fs.writeFile(path.join(repoRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const [file, text] of Object.entries(SEMANTIC_WITNESS_SOURCES)) await fs.writeFile(path.join(repoRoot, file), text + '// source revision ' + revision + '\n');
  applyTestEnv({ cacheRoot, embeddings: 'stub', extraEnv, testConfig: {
    ...(extraIgnore === undefined ? {} : { extraIgnore }),
    indexing: {
      workerPool: { enabled: false }, semantic: { enabled: true, profile: 'rich',
        execution: { compilerAdmission },
        enrichment: { bindings: 'eager', localFlow: 'eager', crossFileFlow: 'eager' } },
      embeddings: { enabled: false }, typeInference: false, typeInferenceCrossFile: false,
      riskAnalysis: false, treeSitter: { enabled: false }
    } } });
  await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', incremental, abortSignal,
    ...(threads === undefined ? {} : { threads }),
    'stub-embeddings': true, 'scm-provider': 'none' });
  const indexDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
  const { store, manifest } = await openPublishedSemanticStore({ repoRoot, indexDir });
  const sources = new Map(), records = [];
  for (const partition of manifest.partitions) {
    if (!sources.has(partition.sourceUnitId)) {
      for await (const source of store.iterateRows(partition.partitionId, 'semantic_sources')) sources.set(source.sourceUnitId, source);
    }
    if (recordPartitionFilter && !recordPartitionFilter(partition)) continue;
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) records.push({ ...row,
      ref: { partitionId: partition.partitionId, localId: row.id }, sourceUnitId: partition.sourceUnitId });
  }
  return { repoRoot, cacheRoot, indexDir, store, manifest, sources, records,
    sourceFor: ref => sources.get(manifest.partitions.find(partition => partition.partitionId === ref.partitionId)?.sourceUnitId),
    semanticContext: { repoRoot, store, manifest } };
};

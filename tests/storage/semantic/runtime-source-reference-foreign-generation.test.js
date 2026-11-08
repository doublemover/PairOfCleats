import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPublishedSemanticWitness } from '../../helpers/published-semantic-witness.js';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { qualifyRuntimeSourceCandidates } from '../../../src/index/semantic/runtime/source-authority.js';
import { DEFAULT_COMPILER_ADMISSION_POLICY } from '../../../src/index/semantic/compiler-admission.js';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-runtime-foreign-reference-')));
let fixture;
try {
  // This contract consumes syntax/source identity; compiler work still runs,
  // while unrelated compiler rows and indexed config metadata need no hydration.
  const selection = { threads: 1, extraIgnore: ['tsconfig.json', 'package.json'],
    semanticProfile: 'targeted', enrichment: { bindings: 'eager', localFlow: 'deferred', crossFileFlow: 'deferred' },
    compilerAdmission: DEFAULT_COMPILER_ADMISSION_POLICY,
    compilerOptions: { types: [], lib: ['ES5'] },
    // Every request below names this actual compiled function. An unrelated
    // caller adds a second project input without contributing any assertion.
    sourceFiles: { 'snapshot.ts': 'export function build(seed:number) { return seed + 1; }\n' },
    recordPartitionFilter: partition => partition.partitionId.startsWith('sy1:') };
  const witness = await createPublishedSemanticWitness({ ...selection, root: path.join(root, 'source') });
  let binding = false;
  for (const partition of witness.manifest.partitions.filter(row => row.partitionId.startsWith('sa1:'))) {
    for await (const row of witness.store.iterateRows(partition.partitionId, 'semantic_records')) {
      if (row.kind === 'binding') { binding = true; break; }
    }
  }
  assert.equal(binding, true, 'the reduced source fixture still publishes actual compiler bindings');
  assert.equal(witness.sources.size, 1, 'the one authored source is still compiled and published');
  const configurationIdentity = async () => Promise.all(['tsconfig.json', 'package.json'].map(async name => {
    const filename = path.join(witness.repoRoot, name), stat = await fs.stat(filename, { bigint: true });
    return { name, bytes: await fs.readFile(filename, 'utf8'), ino: stat.ino, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs };
  }));
  const configuration = await configurationIdentity();
  // Publish the next real generation of this repository. Holding namespace
  // constant makes the negative discriminate generation authority itself;
  // incremental preparation reuses the unchanged compiler/configuration closure.
  const other = await createPublishedSemanticWitness({ ...selection, root: path.join(root, 'source'),
    sourceFiles: { ...selection.sourceFiles, 'snapshot.ts': selection.sourceFiles['snapshot.ts'] + '// next source generation\n' },
    incremental: true });
  assert.deepEqual(await configurationIdentity(), configuration,
    'incremental preparation preserves unchanged compiler configuration and filesystem identity');
  assert.equal(other.sources.size, 1);
  let otherBinding = false;
  for (const partition of other.manifest.partitions.filter(row => row.partitionId.startsWith('sa1:'))) {
    for await (const row of other.store.iterateRows(partition.partitionId, 'semantic_records')) {
      if (row.kind === 'binding') { otherBinding = true; break; }
    }
  }
  assert.equal(otherBinding, true, 'the next generation also publishes actual compiler bindings');
  const source = [...witness.sources.values()].find(row => row.path === 'snapshot.ts');
  const target = witness.records.find(row => row.kind === 'scope' && row.data.scopeKind === 'FunctionDeclaration'
    && row.sourceUnitId === source.sourceUnitId);
  assert.ok(target, 'the published source must supply a real function reference');
  fixture = await createRuntimeImportFixture();
  const options = fixture.options();
  options.capture = { ...options.capture, repositoryNamespace: source.repositoryNamespace,
    generation: witness.manifest.generation,
    sources: [...witness.sources.values()].map(row => ({ sourceUnitId: row.sourceUnitId, byteHash: row.byteHash })) };
  options.sourceCandidates = [{ sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, targets: [target.ref] }];
  const qualified = await qualifyRuntimeSourceCandidates({ capture: options.capture,
    candidates: options.sourceCandidates, semanticContext: witness.semanticContext });
  assert.deepEqual(qualified[0].targetRecords.map(row => row.ref), [target.ref],
    'the real published function is authorized by its own pinned generation');
  assert.equal(qualified[0].targetReason, null);
  assert.notDeepEqual(other.manifest.generation, witness.manifest.generation);
  assert.equal([...other.sources.values()][0].repositoryNamespace, source.repositoryNamespace,
    'repository identity is held constant so only a foreign generation can refuse the reference');
  await assert.rejects(importRuntimeEvidence({ ...options, semanticContext: other.semanticContext }),
    { code: 'ERR_RUNTIME_QUERY_SCOPE' }, 'a second published generation cannot verify the first source');
  console.log('Foreign published semantic generation cannot authorize runtime source references');
} finally {
  await fixture?.cleanup();
  await fs.rm(root, { recursive: true, force: true });
}

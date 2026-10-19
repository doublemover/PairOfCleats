import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPublishedSemanticWitness } from '../../helpers/published-semantic-witness.js';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-runtime-foreign-reference-'));
let fixture;
try {
  const witness = await createPublishedSemanticWitness({ root: path.join(root, 'source') });
  const other = await createPublishedSemanticWitness({ root: path.join(root, 'changed'), revision: 1 });
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
  await assert.rejects(importRuntimeEvidence({ ...options, semanticContext: other.semanticContext }),
    { code: 'ERR_RUNTIME_QUERY_SCOPE' }, 'a second published generation cannot verify the first source');
  console.log('Foreign published semantic generation cannot authorize runtime source references');
} finally {
  await fixture?.cleanup();
  await fs.rm(root, { recursive: true, force: true });
}

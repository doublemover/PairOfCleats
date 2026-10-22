import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { createSemanticLspSession } from '../../../src/index/semantic/lsp-session.js';
import { captureLspTargetSelection } from '../../../src/index/semantic/lsp-target-selection.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

// Authored only. Actual retained occurrence admission, no server/source runs.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lsp-selection-admission-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'input.ts': 'declare function remote(value:number):number; remote(1); remote(2);' });
  const session = await createSemanticLspSession({ state: fixture.state, runtime: { root, buildRoot: root, semanticPolicy: fixture.policy } });
  const doc = session.prepareDocuments([])[0], uri = pathToFileURL(path.join(root, 'input.ts')).href;
  const selected = (await session.targetsForDocument(doc)).filter(target => target.name === 'remote' && target.invocation);
  assert.equal(selected.length, 2);
  const syntaxStore = fixture.storeFor(fixture.syntaxPartitions), syntax = fixture.syntaxPartitions[0];
  let occurrenceCount = 0;
  for await (const row of syntaxStore.iterateRows(syntax.partitionId, 'semantic_records')) {
    if (row.kind === 'occurrence' && row.span && !row.data.roles.includes('definition')) occurrenceCount++;
  }
  const clone = value => JSON.parse(JSON.stringify(value));
  let requests = 0, arrayEnumerations = 0, nestedEnumerations = 0, getters = 0;
  const never = async () => { requests++; throw new Error('invalid selection reached provider'); };
  const oversized = new Proxy(new Array(occurrenceCount + 1), { ownKeys() { arrayEnumerations++; throw new Error('must reject source cardinality first'); } });
  await assert.rejects(session.collectDocument({ doc, uri, targets: oversized, requestDefinition: never }), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  assert.equal(arrayEnumerations, 0);
  const withExtra = clone(selected[0]);
  withExtra.extra = new Proxy({}, { ownKeys() { nestedEnumerations++; throw new Error('unknown metadata must not be traversed'); } });
  await assert.rejects(session.collectDocument({ doc, uri, targets: [withExtra], requestDefinition: never }), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  assert.equal(nestedEnumerations, 0);
  const hugeRoles = clone(selected[0]);
  hugeRoles.roles = new Proxy(new Array(100000), { ownKeys() { arrayEnumerations++; throw new Error('canonical roles bound precedes enumeration'); } });
  await assert.rejects(session.collectDocument({ doc, uri, targets: [hugeRoles], requestDefinition: never }), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  assert.equal(arrayEnumerations, 0);
  const decoratedRoles = clone(selected[0]);
  Object.defineProperty(decoratedRoles.roles, '0', { enumerable: false });
  decoratedRoles.roles.extra = 'ignored';
  await assert.rejects(session.collectDocument({ doc, uri, targets: [decoratedRoles], requestDefinition: never }),
    { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' }, 'a non-enumerable element cannot hide an extra property behind an unchanged enumerable-key count');
  const wrongName = clone(selected[0]); wrongName.name = 'x'.repeat(1000000);
  await assert.rejects(session.collectDocument({ doc, uri, targets: [wrongName], requestDefinition: never }), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  const getter = clone(selected[0]);
  Object.defineProperty(getter.invocation, 'kind', { enumerable: true, get() { getters++; return 'call'; } });
  await assert.rejects(session.collectDocument({ doc, uri, targets: [getter], requestDefinition: never }), TypeError);
  assert.equal(getters, 0);
  assert.equal(requests, 0);
  assert.equal(fixture.state.semanticEvidenceArtifacts.length, 0);
  assert.deepEqual(session.output().partitions, []);

  const controller = new AbortController(); controller.abort();
  assert.throws(() => captureLspTargetSelection({ selection: selected, partitionId: syntax.partitionId,
    occurrenceCount, text: doc.text, signal: controller.signal }), { name: 'AbortError' });
  const provided = clone(selected), expected = clone(provided);
  const pending = session.collectDocument({ doc, uri, targets: provided,
    requestDefinition: async () => { requests++; return { attempted: true, payload: null }; } });
  provided[0].span[0] = 0; provided[0].name = 'changed'; provided[0].roles.push('definition'); provided.reverse();
  await pending;
  assert.equal(requests, 2, 'every admitted target uses the synchronous owned selection');
  const partitions = [...fixture.syntaxPartitions, ...session.output().partitions], store = fixture.storeFor(partitions), bindings = [];
  await validateSemanticPartitions({ store, partitions });
  for (const partition of session.output().partitions) {
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) if (row.kind === 'binding') bindings.push(row);
  }
  assert.deepEqual(bindings.map(row => row.span), expected.map(target => target.span));
  assert.deepEqual(bindings.map(row => row.data.occurrence), expected.map(target => target.ref));
  assert.equal(fixture.state.semanticEvidenceArtifacts.length, 2);
  console.log('LSP target snapshots use retained cardinality, canonical fields and passive source spelling admission');
} finally { await fs.rm(root, { recursive: true, force: true }); }

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { createSemanticLspSession } from '../../../src/index/semantic/lsp-session.js';
import { SEMANTIC_EVIDENCE_MAX_BYTES, encodeSemanticEvidence } from '../../../src/index/semantic/lsp-evidence.js';

// Authored only: actual retained occurrences -> callbacks -> evidence publication.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lsp-evidence-admission-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'input.ts': 'declare function remote(value:number):number; remote(1); remote(2);' });
  const session = await createSemanticLspSession({ state: fixture.state, runtime: { root, buildRoot: root, semanticPolicy: fixture.policy } });
  const doc = session.prepareDocuments([])[0], uri = pathToFileURL(path.join(root, 'input.ts')).href;
  const targets = (await session.targetsForDocument(doc)).filter(target => target.name === 'remote' && target.invocation);
  assert.equal(targets.length, 2);
  const overhead = Buffer.byteLength(encodeSemanticEvidence({ attempted: true, payload: '' }));
  const response = { attempted: true, payload: 'x'.repeat(SEMANTIC_EVIDENCE_MAX_BYTES - overhead) };
  assert.equal(Buffer.byteLength(encodeSemanticEvidence(response)), SEMANTIC_EVIDENCE_MAX_BYTES);
  let calls = 0;
  await assert.rejects(session.collectDocument({ doc, uri, targets, requestDefinition: async () => { calls++; return response; } }),
    { code: 'ERR_SEMANTIC_EVIDENCE_BUDGET' }, 'raw response fit cannot erase the complete sidecar envelope cost');
  assert.equal(calls, 1, 'a rejected sidecar stops before the next target request');
  assert.deepEqual(session.output().partitions, []);
  assert.equal(fixture.state.semanticEvidenceArtifacts.length, 0);
  await session.collectDocument({ doc, uri, targets, requestDefinition: async () => { calls++; return { attempted: true, payload: null }; } });
  assert.equal(calls, 3, 'a rejected batch never marks the document completed');
  assert.equal(session.output().partitions.length, 1);
  assert.equal(fixture.state.semanticEvidenceArtifacts.length, 2);
  for (const artifact of fixture.state.semanticEvidenceArtifacts) assert.ok(artifact.bytes <= SEMANTIC_EVIDENCE_MAX_BYTES);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('retained LSP definition evidence is charged before continuation or publication');

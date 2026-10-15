import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { queryRuntimeEvidence, defaultRuntimeQuerySelectors } from '../../../src/index/semantic/runtime/query.js';
import { listRuntimeFamilies } from '../../../src/index/semantic/runtime/families.js';
import { createPublishedSemanticWitness } from '../../helpers/published-semantic-witness.js';
import { createPublishedRuntimeWitness } from '../../helpers/published-runtime-witness.js';
import { compareRuntimeCaptures } from '../../../src/index/semantic/runtime/compare.js';
import { queryRuntimeDerivedClaims } from '../../../src/index/semantic/runtime/claims.js';
import { projectOutput } from '../../../src/map/workspace/projection.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'poc-viewer-runtime-published-'));
let fixture;
try {
  const witness=await createPublishedSemanticWitness({root});
  fixture=await createPublishedRuntimeWitness(witness);
  const imported=fixture.first,capture=fixture.base.capture,destination=fixture.base.destination;
  const request={schemaVersion:1,repositoryNamespace:capture.repositoryNamespace,generation:capture.generation,
    familyGenerations:[imported.pointer.generationId],selectors:defaultRuntimeQuerySelectors(),limits:{maxRecords:2,maxBytes:65536,maxMs:1000},cursor:null};
  const query=cursor=>queryRuntimeEvidence({destination,request:{...request,cursor}});
  const first=await query(null), view=projectOutput(first);
  assert.equal(view.family,'runtime');assert.equal(view.nodes.length,2);assert.ok(view.cursor);
  assert.strictEqual(view.nodes[0].detail,first.observations[0]);
  assert.equal(view.nodes[0].kind,'observations');assert.equal(first.executionAuthorized,false);
  assert.strictEqual(view.sections.find(row=>row.title==='derivedCoverage').value,first.derivedCoverage);
  assert.strictEqual(view.sections.find(row=>row.title==='explanations').value,first.explanations);
  const second=projectOutput(await query(first.nextCursor));
  assert.ok(second.nodes.every(node=>!view.nodes.some(before=>before.id===node.id)));
  const families=await listRuntimeFamilies({destination,limit:1});
  assert.equal(projectOutput(families).family,'runtime');
  assert.strictEqual(projectOutput(families).nodes[0].detail,families.families[0]);
  const secondImport=fixture.second;
  const comparison=await compareRuntimeCaptures({destination,request:{schemaVersion:1,
    repositoryNamespace:capture.repositoryNamespace,generation:capture.generation,leftFamily:imported.pointer.generationId,
    rightFamily:secondImport.pointer.generationId,sources:capture.sources,limits:{maxRecords:32,maxBytes:65536,maxMs:1000},persist:true}});
  const compared=projectOutput(comparison);assert.equal(compared.family,'runtime');assert.ok(compared.nodes.length);
  assert.equal(compared.nodes[0].kind,'claims');assert.ok(compared.nodes[0].detail.data.supportingEvidenceIds.length);
  assert.ok(compared.nodes[0].detail.unavailable.includes('causal-inference'));
  const saved=await queryRuntimeDerivedClaims({destination,request:{schemaVersion:1,
    repositoryNamespace:capture.repositoryNamespace,generation:capture.generation,claimGeneration:comparison.claimGeneration,
    limits:{maxRecords:32,maxBytes:65536,maxMs:1000},cursor:null}});
  assert.equal(projectOutput(saved).family,'runtime');assert.equal(projectOutput(saved).nodes.length,saved.claims.length);
  console.log('Real saved-fixture runtime import → bounded observations/families; direct evidence, limitations and replacement-page identities preserved.');
} finally {await fixture?.cleanup();await fs.rm(root,{recursive:true,force:true});}

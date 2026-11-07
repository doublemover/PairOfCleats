import assert from 'node:assert/strict';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';
import { isManagedReferenceLanguage, admitManagedReferenceFacts } from '../../../src/contracts/managed-reference-identities.js';

const resolveExpectedUsage = (testCase) => testCase.expectedUsage ?? testCase.expectedCall;

const assertCapabilityProfile = (entry, testCase) => {
  const capability = entry.capabilityProfile;
  if (testCase.expectedCapabilityState) {
    assert.ok(
      capability && capability.state === testCase.expectedCapabilityState,
      `${testCase.id} should keep explicit ${testCase.expectedCapabilityState} capability profile`
    );
    assert.ok(Array.isArray(capability.diagnostics), `${testCase.id} should expose capability diagnostics`);
    return;
  }
  assert.equal(capability, undefined, `${testCase.id} should not be marked as import-collector downgrade`);
};

export const assertHeuristicAdapterCases = async (cases, { usageLabel = 'heuristic call usage' } = {}) => {
  for (const testCase of cases) {
    const entry = LANGUAGE_REGISTRY.find((row) => row.id === testCase.id);
    assert.ok(entry, `missing registry entry for ${testCase.id}`);
    assertCapabilityProfile(entry, testCase);

    const expectedUsage = resolveExpectedUsage(testCase);
    const relations = entry.buildRelations({
      text: testCase.source,
      relPath: testCase.relPath,
      options: {}
    }) || {};
    assert.ok(Array.isArray(relations.imports), `${testCase.id} should emit imports array`);
    assert.ok(relations.imports.includes(testCase.expectedImport), `${testCase.id} should keep expected import`);
    assert.ok(Array.isArray(relations.exports), `${testCase.id} should emit exports array`);
    assert.ok(
      relations.exports.includes(testCase.expectedExport),
      `${testCase.id} should emit heuristic export symbol`
    );
    assert.ok(Array.isArray(relations.usages), `${testCase.id} should emit usages array`);
    assert.ok(relations.usages.includes(expectedUsage), `${testCase.id} should emit ${usageLabel}`);
    assert.ok(Array.isArray(relations.calls), `${testCase.id} should emit calls array`);
    if (isManagedReferenceLanguage(entry.id)) {
      assert.deepEqual(relations.calls, [], `${testCase.id} references cannot occupy ordinary calls`);
      const facts = admitManagedReferenceFacts(relations.managedReferenceFacts, entry.id);
      assert.ok(facts, `${testCase.id} retains typed reference evidence`);
      assert.ok(facts.references.some(reference => reference.value === expectedUsage), `${testCase.id} retains the positive reference`);
    } else if (relations.callCoverage === 'partial-no-syntax-owner') {
      assert.deepEqual(relations.calls, [], `${testCase.id} cannot attribute file-wide usage to a caller`);
    } else {
      assert.ok(relations.calls.some((edge) => edge[1] === expectedUsage),
        `${testCase.id} should retain its managed relation associations`);
    }

    // Native-supported languages also exercise the real preparation owner.
    // Lexical-only DSLs retain usages and explicit incomplete call coverage.
    if (['dart', 'scala', 'groovy', 'julia', 'r'].includes(testCase.id)) {
      const options = { treeSitter: { enabled: true, strict: true, chunkCache: false, adaptive: false } };
      const input = { text: testCase.source, options, mode: 'code', relPath: testCase.relPath };
      const context = await entry.prepare(input);
      const preparedChunks = context[`${testCase.id}Chunks`];
      assert.ok(preparedChunks?.some(row => /Function|Method/.test(row.kind)),
        `${testCase.id} prepares an actual declaration owner`);
      const prepared = entry.buildRelations({ ...input, context });
      assert.ok(prepared.calls.some(([caller, callee]) => callee === expectedUsage
        && preparedChunks.some(row => row.name === caller && /Function|Method/.test(row.kind))),
      `${testCase.id} attributes the expected call to its actual native declaration`);
      assert.ok(prepared.callDetails.some(detail => detail.callee === expectedUsage
        && testCase.source.slice(detail.start, detail.end).includes(expectedUsage)),
      `${testCase.id} retains the original call occurrence and source range`);
    }

    const chunk = {
      name: testCase.expectedExport,
      start: 0,
      end: testCase.source.length
    };
    const docmeta = entry.extractDocMeta({ chunk });
    assert.equal(docmeta?.symbol, testCase.expectedExport, `${testCase.id} should emit heuristic docmeta symbol`);

    const flow = entry.flow({
      text: testCase.source,
      chunk,
      options: { astDataflowEnabled: true, controlFlowEnabled: true }
    });
    assert.ok(flow?.flowEvidence, `${testCase.id} exposes per-field flow qualification`);
    assert.equal(flow.controlFlow, undefined, `${testCase.id} cannot infer control flow from an ownerless raw slice`);
    assert.equal(flow.dataflow, undefined, `${testCase.id} cannot infer semantic dataflow from an ownerless raw slice`);
    assert.ok(Object.values(flow.flowEvidence.fields).every(field => field.state === 'unavailable'),
      `${testCase.id} retains unavailable coverage rather than successful zeroes`);
  }
};

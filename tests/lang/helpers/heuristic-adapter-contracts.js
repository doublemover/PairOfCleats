import assert from 'node:assert/strict';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';

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

export const assertHeuristicAdapterCases = (cases, { usageLabel = 'heuristic call usage' } = {}) => {
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
    assert.ok(
      relations.calls.some((entryCall) => Array.isArray(entryCall) && entryCall[1] === expectedUsage),
      `${testCase.id} should emit call edges`
    );

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
    assert.ok(flow && flow.controlFlow, `${testCase.id} should emit control flow summary`);
    assert.equal(typeof flow.controlFlow.branches, 'number', `${testCase.id} controlFlow.branches must be numeric`);
  }
};

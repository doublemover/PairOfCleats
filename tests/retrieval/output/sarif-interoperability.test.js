import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { renderRiskExplanationSarif } from '../../../src/retrieval/output/risk-sarif.js';
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const schema = JSON.parse(fs.readFileSync(new URL('../../fixtures/contracts/sarif-2.1.0.schema.json', import.meta.url)));
const validate = ajv.compile(schema);
const modelFor = file => ({ flows: [{ flowId: 'authored', evidence: { callSitesByStep: [[
  { callSiteId: 'one', details: { file, startLine: 1, startCol: 1, endLine: 1, endCol: 4 } }
]] } }] });
for (const file of ['src/a.js', 'src/a#b.js', 'src/a?b.js', 'src/a%20b.js', 'src/a b.js', 'src/日本語.js']) {
  const output = renderRiskExplanationSarif(modelFor(file));
  assert.equal(validate(output), true, JSON.stringify(validate.errors));
  const result = output.runs[0].results[0];
  const locations = [result.locations[0], result.codeFlows[0].threadFlows[0].locations[0].location];
  for (const location of locations) {
    const resolved = new URL(location.physicalLocation.artifactLocation.uri, 'file:///repo/');
    assert.equal(decodeURIComponent(resolved.pathname), `/repo/${file}`);
    assert.equal(resolved.search, ''); assert.equal(resolved.hash, '');
  }
  const invalid = structuredClone(output);
  invalid.runs[0].results[0].codeFlows[0].threadFlows[0].locations[0].message = { text: 'wrong level' };
  assert.equal(validate(invalid), false, 'official schema rejects accidental threadFlowLocation.message');
}
for (const flow of [{ flowId: 'empty' }, { flowId: 'id-only', path: { callSiteIdsByStep: [['id']] } },
  { flowId: 'watch-only', path: { watchByStep: [{ startLine: 1, endLine: 2 }] } }]) {
  const output = renderRiskExplanationSarif({ flows: [flow] });
  assert.equal(validate(output), true, JSON.stringify(validate.errors));
  if (flow.flowId === 'empty') assert.equal(output.runs[0].results[0].codeFlows, undefined);
}
assert.equal(validate(renderRiskExplanationSarif({ flows: [] })), true);
for (const file of ['C:\\source\\a#b.js', '\\\\server\\share\\a b.js', '/repo/a%20b.js']) {
  const output = renderRiskExplanationSarif(modelFor(file));
  assert.equal(validate(output), true, JSON.stringify(validate.errors));
  const location = output.runs[0].results[0].locations[0].physicalLocation.artifactLocation;
  assert.ok(location.uri.startsWith('file:'));
  assert.equal(location.uriBaseId, undefined);
}
console.log('SARIF full schema and URI identity passed');

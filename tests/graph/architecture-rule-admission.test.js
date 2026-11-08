import assert from 'node:assert/strict';
import { parse as parseYaml } from 'yaml';
import { ARCHITECTURE_RULES_SCHEMA } from '../../src/contracts/architecture-rules.js';
import { createAjv, compileSchema } from '../../src/shared/validation/ajv-factory.js';
import { parseArchitectureRules, buildArchitectureReport } from '../../src/graph/architecture.js';
import { validateArchitectureReport } from '../../src/contracts/validators/analysis.js';
import { CROSS_FILE_FIDELITY_VERSION, resolveCrossFileFidelity } from '../../src/index/cross-file-fidelity.js';

const schema = compileSchema(createAjv({ strict: true, allowUnionTypes: true }), ARCHITECTURE_RULES_SCHEMA);
const validRule = { id: 'boundary', type: 'forbiddenImport', from: { anyOf: ['src/app/**'] }, to: { anyOf: ['src/core/**'] } };
// This fixture owns the entire explicitly enumerated topology. This receipt is
// not a substitute for production extraction/analysis coverage qualification.
const graphRelations = { upstreamCoverage: { schemaVersion: CROSS_FILE_FIDELITY_VERSION,
  policy: resolveCrossFileFidelity('comprehensive'), fingerprint: 'closed-two-node-fixture',
  admission: { status: 'complete', firstLayer: null, propagation: null }, analysis: { status: 'complete', reasons: [] } },
importGraph: { nodes: [{ id: 'src/app/a.js', out: ['src/core/b.js'] }, { id: 'src/core/b.js', out: [] }] } };
const build = rules => buildArchitectureReport({ rules, graphRelations, indexSignature: 'closed-fixture' });
const invalid = [
  [{ ...validRule, type: 'forbiddenImports' }, 'rules[0].type'],
  [{ id: 'missing-type' }, 'rules[0].type'],
  [null, 'rules[0]'],
  ['rule', 'rules[0]'],
  [{ ...validRule, from: { anyOf: 'src/app/**' } }, 'rules[0].from.anyOf'],
  [{ ...validRule, from: { anyOf: [42] } }, 'rules[0].from.anyOf[0]'],
  [{ ...validRule, from: { anyOf: [''] } }, 'rules[0].from.anyOf[0]'],
  [{ ...validRule, from: { anyof: ['src/app/**'] } }, 'rules[0].from.anyof'],
  [{ ...validRule, from: null }, 'rules[0].from'],
  [{ ...validRule, severity: false }, 'rules[0].severity'],
  [{ id: 'layers', type: 'layering', layers: [] }, 'rules[0].layers'],
  [{ id: 'layers', type: 'layering', layers: [{ name: '' }] }, 'rules[0].layers[0].name'],
  [{ id: 'layers', type: 'layering', layers: [{ name: 'app', match: { noneOf: 'src/**' } }] }, 'rules[0].layers[0].match.noneOf']
];
for (const [rule, location] of invalid) {
  const policy = { version: 1, rules: [rule] };
  assert.equal(schema(policy), false, location);
  for (const run of [() => parseArchitectureRules(policy), () => build(policy), () => build(policy.rules)]) {
    assert.throws(run, error => error.code === 'ERR_ARCHITECTURE_RULE_INPUT' && error.propertyPath === location && error.ruleIndex === 0, location);
  }
}
const mixed = { version: 1, rules: [{ ...validRule, from: { anyOf: ['elsewhere/**'] } }, { ...validRule, id: 'unsupported', type: 'typo' }] };
assert.throws(() => build(mixed), error => error.ruleIndex === 1 && error.ruleId === 'unsupported');
for (const policy of [{ version: 1, rules: [] }, { version: 1, rules: [validRule] },
  parseYaml('version: 1\nrules:\n  - id: boundary\n    type: forbiddenImport\n    from: {}\n    to: {}\n')]) {
  assert.equal(schema(policy), true);
  const parsed = parseArchitectureRules(policy);
  assert.equal(schema(parsed), true);
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.rules));
  const report = build(parsed);
  assert.equal(report.summary.complete, true);
  assert.equal(validateArchitectureReport(report).ok, true);
  assert.equal(report.summary.detectedViolations, policy.rules.length ? 1 : 0);
}
assert.equal(build([{ ...validRule, from: { anyOf: [], noneOf: [] }, to: {} }]).summary.detectedViolations, 1,
  'explicit empty selectors preserve intentional match-all semantics');
assert.equal(build([{ ...validRule, from: { anyOf: ['elsewhere/**'] } }]).summary.detectedViolations, 0);
const mutable = structuredClone(validRule);
assert.equal(build([mutable]).summary.detectedViolations, 1);
mutable.to.anyOf = ['elsewhere/**'];
assert.equal(build([mutable]).summary.detectedViolations, 0, 'cache identity follows normalized admitted content');
assert.throws(() => build(new Array(1)), error => error.propertyPath === 'rules[0]');
assert.throws(() => build([{ ...validRule, from: { anyOf: new Array(1) } }]), error => error.propertyPath === 'rules[0].from.anyOf[0]');
assert.throws(() => build([{ id: 'layers', type: 'layering', layers: [{ name: 'same' }, { name: ' same ' }] }]),
  error => error.propertyPath === 'rules[0].layers[1].name');
console.log('architecture authored rule admission test passed');

import assert from 'node:assert/strict';
import { parseArchitectureRules, buildArchitectureReport } from '../../src/graph/architecture.js';
const rules = { version: 1, rules: [
  { id: 'same', type: 'forbiddenImport', from: 'src/a.js', to: 'src/b.js' },
  { id: 'same', type: 'forbiddenImport', from: 'src/c.js', to: 'src/d.js' }
] };
const duplicate = error => error?.code === 'ERR_ARCHITECTURE_DUPLICATE_RULE_ID';
assert.throws(() => parseArchitectureRules(rules), duplicate);
assert.throws(() => buildArchitectureReport({ rules, graphRelations: {} }), duplicate);
console.log('architecture duplicate rule identities passed');

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createAjv } from '../../../src/shared/validation/ajv-factory.js';
import { USR_REPORT_SCHEMA_DEFS } from '../../../src/contracts/schemas/usr.js';
import { buildUsrDocumentSchemas } from '../../../tools/docs/export-usr-schemas.js';

const docs = buildUsrDocumentSchemas();
const witness = schema => {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'object') return Object.fromEntries((schema.required || []).map(key => [key, witness(schema.properties[key])]));
  if (type === 'array') return [];
  if (type === 'boolean') return false;
  if (type === 'integer' || type === 'number') return schema.minimum || 0;
  if (type === 'null') return null;
  return 'fixture';
};
const ajv = createAjv({ dialect: '2020', allErrors: true, allowUnionTypes: true, strict: true });
for (const [id, schema] of Object.entries(USR_REPORT_SCHEMA_DEFS)) {
  const documented = docs.get(`${id}.schema.json`);
  assert.deepEqual(await fs.readFile(`docs/schemas/usr/${id}.schema.json`, 'utf8').then(JSON.parse), documented,
    `${id}: checked-in schemas must be generated from the runtime contract`);
  const runtime = ajv.compile(schema), published = ajv.compile(documented);
  const base = { schemaVersion: '1', artifactId: id, generatedAt: '2026-10-21T12:00:00Z', producerId: 'fixture',
    runId: 'fixture', lane: 'fixture', buildId: null, scope: { scopeType: 'global', scopeId: 'fixture' }, status: 'pass', summary: {}, rows: [] };
  base.summary = witness(schema.properties.summary);
  for (const status of ['pass', 'warn', 'fail', 'error', 'partial', 'NOT_A_STATUS']) {
    const payload = { ...base, status };
    assert.equal(published(payload), runtime(payload), `${id}: status ${status}`);
    if (status === 'NOT_A_STATUS') assert.equal(published(payload), false);
  }
  for (const field of schema.required) {
    const payload = { ...base }; delete payload[field];
    assert.equal(published(payload), false, `${id}: missing ${field}`);
    assert.equal(runtime(payload), false);
  }
  assert.equal(published({ ...base, unexpected: true }), false);
  assert.equal(runtime({ ...base, unexpected: true }), false);
  assert.equal(published(base), true, `${id}: positive report witness`);
  if (schema.properties.summary.required) {
    assert.equal(runtime({ ...base, summary: {} }), false, `${id}: specialized required summary is retained`);
    assert.equal(published({ ...base, summary: {} }), false);
  }
}
console.log('Runtime and generated USR schemas share envelope and specialized semantics.');

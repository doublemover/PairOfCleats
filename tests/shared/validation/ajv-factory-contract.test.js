#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  cloneJsonSchema,
  compileSchema,
  createAjv
} from '../../../src/shared/validation/ajv-factory.js';

applyTestEnv();

const defaultAjv = createAjv({ allErrors: true, strict: false });
const objectValidator = compileSchema(defaultAjv, {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' }
  }
});
assert.equal(objectValidator({ name: 'ok' }), true, 'default Ajv should validate plain object schema');
assert.equal(objectValidator({ name: 123 }), false, 'default Ajv should reject invalid values');

const ajv2020 = createAjv({ dialect: '2020', strict: false });
const tupleValidator = compileSchema(ajv2020, {
  type: 'array',
  prefixItems: [{ type: 'string' }],
  items: false
});
assert.equal(tupleValidator(['ok']), true, 'Ajv 2020 should allow matching tuple payload');
assert.equal(tupleValidator(['ok', 'extra']), false, 'Ajv 2020 should reject trailing tuple items');

const sourceSchema = {
  type: 'object',
  properties: {
    flag: { type: 'boolean' }
  }
};

let clonedSchemaArg = null;
compileSchema({
  compile(schemaArg) {
    clonedSchemaArg = schemaArg;
    return () => true;
  }
}, sourceSchema);
assert.notEqual(clonedSchemaArg, sourceSchema, 'compileSchema should clone schema by default');
assert.deepEqual(clonedSchemaArg, sourceSchema, 'compileSchema cloned schema should retain structure');

let passthroughSchemaArg = null;
compileSchema({
  compile(schemaArg) {
    passthroughSchemaArg = schemaArg;
    return () => true;
  }
}, sourceSchema, { clone: false });
assert.equal(passthroughSchemaArg, sourceSchema, 'compileSchema clone:false should pass schema by reference');

assert.throws(
  () => compileSchema({}, sourceSchema),
  /compileSchema requires an Ajv instance/,
  'compileSchema should reject missing Ajv interface'
);
assert.throws(
  () => createAjv({ dialect: 'draft4' }),
  /Unsupported Ajv dialect: draft4/,
  'createAjv should reject unknown dialects'
);

const schemaClone = cloneJsonSchema(sourceSchema);
assert.notEqual(schemaClone, sourceSchema, 'cloneJsonSchema should produce a new object');
assert.deepEqual(schemaClone, sourceSchema, 'cloneJsonSchema should preserve schema structure');

console.log('ajv factory contract test passed');

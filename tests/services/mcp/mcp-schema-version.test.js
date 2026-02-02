#!/usr/bin/env node
import assert from 'node:assert/strict';
import { DEFAULT_MODEL_ID } from '../../../tools/dict-utils.js';
import { getToolCatalog, MCP_SCHEMA_VERSION } from '../../../src/integrations/mcp/defs.js';
import { validateMcpToolSchemaSnapshot } from '../../../src/integrations/mcp/validate.js';

const catalog = getToolCatalog(DEFAULT_MODEL_ID);
assert.ok(catalog.schemaVersion, 'schemaVersion should be set');
assert.equal(catalog.schemaVersion, MCP_SCHEMA_VERSION, 'schemaVersion should match constant');
assert.ok(catalog.toolVersion, 'toolVersion should be set');

const validation = validateMcpToolSchemaSnapshot(DEFAULT_MODEL_ID);
if (!validation.ok) {
  console.error(validation.message || 'MCP schema snapshot mismatch.');
  if (validation.expected && validation.actual) {
    console.error('Expected snapshot:');
    console.error(validation.expected);
    console.error('Actual snapshot:');
    console.error(validation.actual);
  }
  throw new Error('MCP tool schema snapshot mismatch (bump schemaVersion + update snapshot).');
}

console.log('MCP schema version tests passed.');

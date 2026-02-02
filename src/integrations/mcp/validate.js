import fs from 'node:fs';
import path from 'node:path';
import { stableStringify } from '../../shared/stable-json.js';
import { resolveToolRoot } from '../../shared/dict-utils.js';
import { getToolDefs, MCP_SCHEMA_VERSION } from './defs.js';

export const MCP_TOOL_SCHEMA_SNAPSHOT_PATH = path.join(
  resolveToolRoot(),
  'docs',
  'contracts',
  'mcp-tools.schema.json'
);

const normalizeTools = (tools = []) => (
  tools
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
);

export function buildMcpToolSchemaSnapshot(defaultModelId) {
  return {
    schemaVersion: MCP_SCHEMA_VERSION,
    tools: normalizeTools(getToolDefs(defaultModelId))
  };
}

export function loadMcpToolSchemaSnapshot() {
  const raw = fs.readFileSync(MCP_TOOL_SCHEMA_SNAPSHOT_PATH, 'utf8');
  return JSON.parse(raw);
}

export function validateMcpToolSchemaSnapshot(defaultModelId) {
  const expected = loadMcpToolSchemaSnapshot();
  const actual = buildMcpToolSchemaSnapshot(defaultModelId);
  const expectedStable = stableStringify(expected);
  const actualStable = stableStringify(actual);
  if (expectedStable === actualStable) {
    return { ok: true };
  }
  return {
    ok: false,
    message: 'MCP tool schema snapshot mismatch.',
    expected: expectedStable,
    actual: actualStable
  };
}

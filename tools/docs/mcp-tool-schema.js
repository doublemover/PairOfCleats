#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { DEFAULT_MODEL_ID } from '../shared/dict-utils.js';
import { buildMcpToolSchemaSnapshot, MCP_TOOL_SCHEMA_SNAPSHOT_PATH } from '../../src/integrations/mcp/validate.js';

const args = createCli({ scriptName: 'mcp-tool-schema', options: { out: { type: 'string' } } })
  .strictOptions().parse();
const output = path.resolve(args.out || MCP_TOOL_SCHEMA_SNAPSHOT_PATH);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(buildMcpToolSchemaSnapshot(DEFAULT_MODEL_ID), null, 2)}\n`);

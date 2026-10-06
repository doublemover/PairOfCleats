#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getCapabilities } from '../../../src/shared/capabilities.js';

const require = createRequire(import.meta.url);
let expected = false;
try {
  const server = require('@modelcontextprotocol/sdk/server/index.js');
  const stdio = require('@modelcontextprotocol/sdk/server/stdio.js');
  const types = require('@modelcontextprotocol/sdk/types.js');
  expected = typeof server.Server === 'function' && typeof stdio.StdioServerTransport === 'function'
    && Boolean(types.CallToolRequestSchema && types.ListToolsRequestSchema);
} catch {}
const original = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-sdk-launch-root-'));
try {
  process.chdir(temp);
  assert.equal(getCapabilities({ refresh: true }).mcp.sdk, expected,
    'MCP capability must probe its consumed application SDK exports from an unrelated launch directory');
  await fs.mkdir(path.join(temp, 'node_modules', '@modelcontextprotocol', 'sdk'), { recursive: true });
  await fs.writeFile(path.join(temp, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'), '{}');
  assert.equal(getCapabilities({ refresh: true }).mcp.sdk, expected,
    'a workspace package marker must not establish application SDK availability');
  console.log('MCP SDK capability is based on consumed application exports, independent of launch cwd.');
} finally {
  process.chdir(original);
  await fs.rm(temp, { recursive: true, force: true });
}

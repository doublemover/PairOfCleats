#!/usr/bin/env node
import { getCapabilities } from '../../../src/shared/capabilities.js';

const caps = getCapabilities({ refresh: true });
if (!caps || typeof caps !== 'object') {
  throw new Error('getCapabilities should return an object');
}
if (typeof caps.mcp?.sdk !== 'boolean') {
  throw new Error('mcp.sdk capability should be boolean');
}

console.log('MCP capabilities probe ok.');

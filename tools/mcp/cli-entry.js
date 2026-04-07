#!/usr/bin/env node
import { getToolVersion } from '../shared/dict-utils.js';
import { createCli } from '../../src/shared/cli.js';

const rawArgs = process.argv.slice(2);

if (rawArgs.includes('--version') || rawArgs.includes('-v')) {
  console.error(getToolVersion() || '0.0.0');
  process.exit(0);
}

if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  createCli({
    scriptName: 'pairofcleats service mcp',
    options: {
      'mcp-mode': { type: 'string' },
      repo: { type: 'string' }
    },
    aliases: {
      'mcp-mode': ['mcpMode']
    }
  }).parse();
  process.exit(0);
}

await import('./server.js');

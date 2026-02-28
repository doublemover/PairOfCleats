#!/usr/bin/env node
import { launchStubServer } from './proxy-runner.js';

const args = process.argv.slice(2);
const first = String(args[0] || '').trim().toLowerCase();
if (first === '--version' || first === 'version' || first === '--help' || first === 'help' || first === '-h') {
  process.stderr.write('probe-fail-lsp: probe args intentionally unsupported\n');
  process.exit(2);
}

launchStubServer({
  metaUrl: import.meta.url,
  mode: null,
  passthroughArgs: args
});

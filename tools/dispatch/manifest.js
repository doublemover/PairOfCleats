#!/usr/bin/env node
import { createCli } from '../../src/shared/cli.js';
import { describeDispatchCommand, listDispatchManifest } from '../../src/shared/dispatch/manifest.js';

const argv = createCli({
  scriptName: 'dispatch-manifest',
  options: {
    json: { type: 'boolean', default: false }
  }
}).parse();

const [op = 'list', ...rest] = argv._.map((value) => String(value));

if (op === 'list') {
  const payload = {
    commands: listDispatchManifest()
  };
  if (argv.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    for (const entry of payload.commands) {
      process.stdout.write(`${entry.commandPath.join(' ')}\t${entry.script}\n`);
    }
  }
  process.exit(0);
}

if (op === 'describe') {
  const selector = rest.join(' ').trim();
  if (!selector) {
    console.error('dispatch describe requires a command id/path argument.');
    process.exit(1);
  }
  const entry = describeDispatchCommand(selector);
  if (!entry) {
    console.error(`Unknown dispatch command: ${selector}`);
    process.exit(1);
  }
  if (argv.json) {
    process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
  } else {
    process.stdout.write(`${entry.commandPath.join(' ')}\n`);
    process.stdout.write(`script: ${entry.script}\n`);
    process.stdout.write(`description: ${entry.description}\n`);
  }
  process.exit(0);
}

console.error(`Unknown dispatch op: ${op}`);
process.exit(1);

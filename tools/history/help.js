#!/usr/bin/env node
import { historyAgentHelp } from '../../src/integrations/inference-history/agent-contract.js';
const args = process.argv.slice(2);
if (args.some(arg => !['--help', '-h', '--all', '--json'].includes(arg))) {
  console.error(JSON.stringify({ ok: false, error: { code: 'INVALID_REQUEST',
    message: 'This command only exposes archive-reader help.', hint: 'Use pairofcleats history help --all --json. Reads require an authenticated host adapter.' } }));
  process.exitCode = 1;
} else {
  const help = historyAgentHelp({ full: args.includes('--all') });
  console.log(args.includes('--json') ? JSON.stringify(help) : [
    'PairOfCleats private history reader (' + help.version + ')',
    help.safety, '', 'Commands: ' + help.commands.join(', '),
    ...Object.entries(help.semantics).map(([name, value]) => name + ': ' + value),
    '', 'Examples:', ...help.examples.map(value => value.intent + ': ' + (value.instruction ?? JSON.stringify({ command: value.command, request: value.request }))),
    '', 'Full schema: pairofcleats history help --all --json'
  ].join('\n'));
}

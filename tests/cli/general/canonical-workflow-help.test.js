import assert from 'node:assert/strict';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
const root = process.cwd(), env = applyTestEnv({ syncProcess: false });
const runCli = args => runNode([path.join(root, 'bin/pairofcleats.js'), ...args],
  'canonical help route', root, env, { stdio: 'pipe', timeoutMs: 5000 });
const expectHelpRoute = (args) => {
  const result = runCli([...args, '--help']);
  assert.equal(result.status, 0, `expected ${args.join(' ')} --help to succeed: ${result.stderr || result.stdout}`);
};

expectHelpRoute(['service', 'mcp']);
expectHelpRoute(['report', 'throughput']);
expectHelpRoute(['report', 'summary']);
expectHelpRoute(['report', 'parity']);
expectHelpRoute(['bench', 'language']);
expectHelpRoute(['bench', 'matrix']);
expectHelpRoute(['bench', 'summarize']);
expectHelpRoute(['bench', 'micro']);
expectHelpRoute(['sqlite', 'compact']);
expectHelpRoute(['tooling', 'uninstall']);


console.log('Canonical workflow help routes passed');

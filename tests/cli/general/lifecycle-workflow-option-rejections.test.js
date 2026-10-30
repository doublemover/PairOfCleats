import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { formatCommandFailure } from '../../helpers/command-failure.js';
const root=process.cwd();
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'poc-lifecycle-workflow-options-'));
const cache=path.join(temp,'cache'), events=path.join(temp,'events');
const env=applyTestEnv({cacheRoot:cache,syncProcess:false,extraEnv:{PAIROFCLEATS_TUI_EVENT_LOG_DIR:events}});
const cli=args=>runNode([path.join(root,'bin/pairofcleats.js'),...args],args.join(' '),temp,env,
  {stdio:'pipe',allowFailure:true,timeoutMs:5000});
const commands = [
  ['setup'], ['bootstrap'], ['dispatch', 'list'], ['dispatch', 'describe'],
  ['index', 'validate'],

  ['bench', 'micro'], ['sqlite', 'compact'], ['tui', 'build'], ['tui', 'install'],
  ['tui', 'supervisor']
];

try {
  for (const command of commands) {
    const result = cli([...command, '--poc-unknown-option']);
    assert.equal(result.status, 1, formatCommandFailure({
      label: `${command.join(' ')} must reject before its workflow starts`,
      result
    }));
    assert.match(result.stderr + result.stdout, /Unknown argument: poc-unknown-option/);
    assert.doesNotMatch(result.stderr + result.stdout, /npm (?:error|install)|missing cargo|event:chunk/);
  }

  await assert.rejects(fs.access(cache));
  await assert.rejects(fs.access(events));
} finally {await fs.rm(temp,{recursive:true,force:true});}
console.log('Lifecycle workflow options fail before side effects');

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ingest-report-options-'));
const cache = path.join(temp, 'cache');
const env = applyTestEnv({ cacheRoot: cache, syncProcess: false });
try {
  for (const command of [['ingest','ctags'],['ingest','gtags'],['ingest','lsif'],['ingest','scip'],['report','parity'],['report','summary']]) {
    const result = runNode([path.resolve('bin/pairofcleats.js'),...command,'--poc-unknown-option'],
      'reject workflow options', temp, env, { stdio:'pipe',allowFailure:true,timeoutMs:5000 });
    assert.equal(result.status,1,result.stderr + result.stdout);
    assert.match(result.stderr + result.stdout,/Unknown argument: poc-unknown-option/);
    assert.doesNotMatch(result.stderr + result.stdout,/npm (?:error|install)|missing cargo|event:chunk/);
  }
  await assert.rejects(fs.access(cache),'invalid options cannot create output');
} finally { await fs.rm(temp,{recursive:true,force:true}); }
console.log('Ingest/report option rejection passed');

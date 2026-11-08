import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeTriageRecordArtifacts } from '../../../tools/triage/record-writer.js';
import { TRIAGE_GENERATION_DIRECTORY } from '../../../src/contracts/triage-record-publication.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = path.resolve(process.argv[2] || ''), cache = path.resolve(resolveTestCachePath());
const relative = path.relative(cache, root).split(path.sep);
if (!process.send || relative.length !== 2 || !relative[0].startsWith('triage-record-publication-')
  || relative[1] !== 'records') throw new Error('Publication child requires its parent-owned disposable fixture root.');
const send = value => new Promise((resolve, reject) => process.send(value, error => error ? reject(error) : resolve()));
let continuePublication;
const continuation = new Promise(resolve => { continuePublication = resolve; });
let started = false;
process.on('message', async message => {
  if (message?.type === 'continue') { continuePublication(); return; }
  if (message?.type !== 'start' || started) return;
  started = true;
  const original = fs.open;
  const record = message.record;
  const key = createHash('sha256').update(process.platform === 'win32' ? record.recordId.toLowerCase() : record.recordId).digest('hex');
  const lockPath = path.join(root, TRIAGE_GENERATION_DIRECTORY, 'locks', key + '.lock');
  let attempted = false;
  fs.open = async function (file, ...args) {
    if (!attempted && file === lockPath && args[0] === 'wx') { attempted = true; await send({ type: 'attempt' }); }
    return original.call(this, file, ...args);
  };
  try {
    const result = await writeTriageRecordArtifacts(root, record, { beforePublish: async () => {
      await send({ type: 'staged' }); await continuation;
    } });
    await send({ type: 'done', result });
  } catch (error) {
    process.exitCode = 1;
    await send({ type: 'failure', code: error?.code || null, message: String(error?.message || error).slice(0, 4096) });
  } finally { fs.open = original; process.disconnect(); }
});
await send({ type: 'ready' });

#!/usr/bin/env node
import { guardBootstrapEntry } from '../../src/shared/bootstrap-readiness.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import path from 'node:path';
await guardBootstrapEntry(import.meta.url);

// One actual writable completion plus drain owns each page. Closing without
// drain is a failure, and all listeners leave with this write (including throws).
const writePage = (output, line) => new Promise((resolve, reject) => {
  if (output.errored) { reject(output.errored); return; }
  if (output.destroyed || output.writableEnded) {
    reject(Object.assign(new Error('Graph evidence output is closed.'), { code: 'ERR_STREAM_DESTROYED' })); return;
  }
  let settled = false, accepted = null, written = false, drained = false;
  let callbackFailure = null;
  const finish = (error, failed = true) => {
    if (settled) return;
    settled = true;
    output.removeListener('error', onError); output.removeListener('close', onClose); output.removeListener('drain', onDrain);
    if (failed) reject(error); else resolve();
  };
  const ready = () => { if (written && accepted !== null && (accepted || drained)) finish(null, false); };
  const onError = error => finish(error);
  const onClose = () => finish(callbackFailure || Object.assign(new Error('Graph evidence output closed before its page settled.'), { code: 'ERR_STREAM_DESTROYED' }));
  const onDrain = () => { drained = true; ready(); };
  output.once('error', onError); output.once('close', onClose); output.once('drain', onDrain);
  try {
    accepted = output.write(line, error => {
      // A real Writable reports this same failed write through error/close.
      // Keep their listeners installed until that original event settles.
      if (error) { callbackFailure = error; return; }
      written = true; ready();
    });
    ready();
  } catch (error) { onError(error); }
});

export const runGraphEvidenceCli = async (argv = process.argv, { output = process.stdout } = {}) => {
  const [{ createCli }, { GRAPH_EVIDENCE_OPTIONS }, { assertGraphEvidence },
    { runGraphEvidence, iterateGraphEvidence }, { readVerifiedContainedFileSync },
    { consumeJsonRows }, { observeStorageResource }] = await Promise.all([
    import('../../src/shared/cli.js'), import('../shared/operator-cli-options.js'),
    import('../../src/contracts/validators/graph-evidence.js'), import('../../src/integrations/tooling/graph-evidence.js'),
    import('../../src/shared/contained-file.js'), import('../../src/shared/json-stream/consume-rows.js'),
    import('../../src/shared/storage/failure-observation.js')
  ]);
  const args = createCli({ argv, scriptName: 'pairofcleats graph-evidence', options: GRAPH_EVIDENCE_OPTIONS }).strictOptions().parse();
  const file = path.resolve(args.request);
  const bytes = readVerifiedContainedFileSync(path.dirname(file), file, { maxBytes: 65536 }).buffer;
  const request = assertGraphEvidence('request', JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)));
  const write = async result => {
    try {
      await writePage(output, JSON.stringify(result) + '\n');
    } catch (error) { throw observeStorageResource(error, { phase: 'graph-evidence-output' }).retain(); }
  };
  if (args.all) await consumeJsonRows(iterateGraphEvidence(request), write);
  else await write(await runGraphEvidence(request));
};
if (isDirectExecution(import.meta.url)) {
  runGraphEvidenceCli().catch(async error => {
    const { classifyGraphEvidenceError } = await import('../../src/integrations/tooling/graph-evidence.js');
    console.error(JSON.stringify({ ok: false, ...classifyGraphEvidenceError(error) })); process.exitCode = 1;
  });
}

#!/usr/bin/env node
import { guardBootstrapEntry } from '../../src/shared/bootstrap-readiness.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import path from 'node:path';
import { once } from 'node:events';
await guardBootstrapEntry(import.meta.url);

export const runGraphEvidenceCli = async (argv = process.argv, { output = process.stdout } = {}) => {
  const [{ createCli }, { GRAPH_EVIDENCE_OPTIONS }, { assertGraphEvidence },
    { runGraphEvidence }, { readVerifiedContainedFileSync }] = await Promise.all([
    import('../../src/shared/cli.js'), import('../shared/operator-cli-options.js'),
    import('../../src/contracts/validators/graph-evidence.js'), import('../../src/integrations/tooling/graph-evidence.js'),
    import('../../src/shared/contained-file.js')
  ]);
  const args = createCli({ argv, scriptName: 'pairofcleats graph-evidence', options: GRAPH_EVIDENCE_OPTIONS }).strictOptions().parse();
  const file = path.resolve(args.request);
  const bytes = readVerifiedContainedFileSync(path.dirname(file), file, { maxBytes: 65536 }).buffer;
  const request = assertGraphEvidence('request', JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)));
  let cursor = request.cursor ?? null;
  do {
    const result = await runGraphEvidence({ ...request, cursor });
    if (!output.write(JSON.stringify(result) + '\n')) await once(output, 'drain');
    cursor = args.all ? result.cursor : null;
  } while (cursor !== null);
};
if (isDirectExecution(import.meta.url)) {
  runGraphEvidenceCli().catch(async error => {
    const { classifyGraphEvidenceError } = await import('../../src/integrations/tooling/graph-evidence.js');
    console.error(JSON.stringify({ ok: false, ...classifyGraphEvidenceError(error) })); process.exitCode = 1;
  });
}

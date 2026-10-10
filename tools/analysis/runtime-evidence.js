#!/usr/bin/env node
import fs from 'node:fs/promises';
import { once } from 'node:events';
import { createCli } from '../../src/shared/cli.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { runRuntimeEvidenceLookup, runRuntimeFamilyDiscovery, classifyRuntimeEvidenceError } from '../../src/integrations/tooling/runtime-evidence.js';
import { assertRuntimeQuery } from '../../src/contracts/validators/runtime-query.js';

export const runRuntimeEvidenceCli = async (argv = process.argv, { output = process.stdout } = {}) => {
  const args = createCli({ argv, scriptName: 'pairofcleats runtime', options: {
    operation: { type: 'string', choices: ['lookup', 'families'], demandOption: true },
    request: { type: 'string', demandOption: true, description: 'Strict saved runtime request JSON file (at most 1 MiB).' },
    all: { type: 'boolean', default: false, description: 'Stream bounded saved-evidence pages as JSONL.' }
  } }).strictOptions().parse();
  if ((await fs.stat(args.request)).size > 1048576) throw new TypeError('Runtime request file exceeds allowance.');
  const kind = args.operation === 'lookup' ? 'lookupRequest' : 'discoveryRequest';
  const payload = assertRuntimeQuery(kind, JSON.parse(await fs.readFile(args.request, 'utf8')));
  let cursor = args.operation === 'lookup' ? payload.request.cursor : payload.cursor;
  do {
    const page = args.operation === 'lookup'
      ? await runRuntimeEvidenceLookup({ ...payload, request: { ...payload.request, cursor } })
      : await runRuntimeFamilyDiscovery({ ...payload, cursor });
    if (!output.write(JSON.stringify(page) + '\n')) await once(output, 'drain');
    if (args.all && page.nextCursor && page.nextCursor === cursor) throw Object.assign(new Error('Runtime page made no progress within its allowance.'), { code: 'ERR_RUNTIME_QUERY_BUDGET' });
    cursor = args.all ? page.nextCursor : null;
  } while (cursor);
};
if (isDirectExecution(import.meta.url)) runRuntimeEvidenceCli().catch(error => {
  console.error(JSON.stringify({ ok: false, ...classifyRuntimeEvidenceError(error) })); process.exitCode = 1;
});

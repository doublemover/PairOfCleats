#!/usr/bin/env node
import fs from 'node:fs/promises';
import { once } from 'node:events';
import { createCli } from '../../src/shared/cli.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { runSemanticEnrichment, classifySemanticEnrichmentError } from '../../src/integrations/tooling/semantic-enrichment.js';
export const runSemanticEnrichmentCli = async (argv = process.argv, { output = process.stdout } = {}) => {
  const args = createCli({ argv, scriptName: 'pairofcleats semantic enrichment', options: {
    request: { type: 'string', demandOption: true, description: 'Strict pinned request JSON; omitted action plans only.' }
  } }).strictOptions().parse();
  if ((await fs.stat(args.request)).size > 1048576) throw new TypeError('Enrichment request exceeds one MiB.');
  const request = JSON.parse(await fs.readFile(args.request, 'utf8'));
  const result = await runSemanticEnrichment(request);
  if (!output.write(JSON.stringify(result) + '\n')) await once(output, 'drain');
};
if (isDirectExecution(import.meta.url)) runSemanticEnrichmentCli().catch(error => {
  console.error(JSON.stringify({ ok: false, ...classifySemanticEnrichmentError(error) })); process.exitCode = 1;
});

#!/usr/bin/env node
import fs from 'node:fs/promises';
import { projectIndexFormatError } from '../../src/shared/index-format-error.js';
import { once } from 'node:events';
import { createCli } from '../../src/shared/cli.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { runSemanticFind } from '../../src/integrations/tooling/semantic-find.js';
import { classifySemanticDetailError } from '../../src/integrations/tooling/semantic-detail.js';
import { assertSemanticFind } from '../../src/contracts/validators/semantic-find.js';

/** Stream bounded JSONL pages within one process; opaque cursors expire with the process. */
export const runSemanticFindCli = async (argv = process.argv, { output = process.stdout } = {}) => {
  const args = createCli({ argv, scriptName: 'pairofcleats semantic find',
    usage: '$0 --request request.json [--all]', options: {
      request: { type: 'string', demandOption: true, description: 'Semantic find request JSON file (at most 1 MiB).' },
      all: { type: 'boolean', default: false, description: 'Stream every bounded page as JSONL in this process.' }
    } }).strictOptions().parse();
  if ((await fs.stat(args.request)).size > 1048576) throw new Error('Semantic request file exceeds allowance.');
  const request = assertSemanticFind('request', JSON.parse(await fs.readFile(args.request, 'utf8')));
  let cursor = request.cursor || null;
  do {
    const result = await runSemanticFind({ ...request, cursor });
    if (!output.write(JSON.stringify(result) + '\n')) await once(output, 'drain');
    cursor = args.all ? result.cursor : null;
  } while (cursor);
};
if (isDirectExecution(import.meta.url)) runSemanticFindCli().catch((error) => {
  const format = projectIndexFormatError(error);
  console.error(JSON.stringify({ ok: false, ...classifySemanticDetailError(error), ...(format ? { code: format.nativeCode, ...format, details: format } : {}) }));
  process.exitCode = 1;
});

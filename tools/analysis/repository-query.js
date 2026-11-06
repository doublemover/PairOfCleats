#!/usr/bin/env node
import path from 'node:path';
import { once } from 'node:events';
import { createCli } from '../../src/shared/cli.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { throwIfAborted } from '../../src/shared/abort.js';
import { runRepositoryQuery } from '../../src/integrations/tooling/repository-query.js';
import { assertRepositoryQuery } from '../../src/contracts/validators/repository-question-live.js';
import { classifySemanticDetailError } from '../../src/integrations/tooling/semantic-errors.js';
import { REPOSITORY_QUERY_OPTIONS } from '../shared/operator-cli-options.js';

/** Describe a pinned source domain, then execute the exact typed AST. Full-page
 * JSONL streaming keeps the same runner/cursor owner alive and honors backpressure.
 */
export const runRepositoryQueryCli = async (argv = process.argv, { output = process.stdout, runner = runRepositoryQuery, signal = null } = {}) => {
  const args = createCli({ argv, scriptName: 'pairofcleats repository-query', usage: '$0 --request request.json [--all]',
    options: REPOSITORY_QUERY_OPTIONS }).strictOptions().parse();
  const filename = path.resolve(args.request);
  const { buffer } = await readVerifiedContainedFile(path.dirname(filename), filename, { maxBytes: 512 * 1024, signal });
  const request = assertRepositoryQuery('request', JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)));
  let cursor = request.cursor || null;
  do {
    throwIfAborted(signal);
    const value = request.mode === 'execute' ? { ...request, cursor } : request;
    const result = await runner(value, { signal });
    assertRepositoryQuery(request.mode === 'describe' ? 'description' : 'page', result);
    throwIfAborted(signal);
    if (!output.write(JSON.stringify(result) + '\n')) await once(output, 'drain', { signal });
    cursor = args.all && request.mode === 'execute' ? result.cursor : null;
  } while (cursor);
};
if (isDirectExecution(import.meta.url)) runRepositoryQueryCli().catch(error => {
  console.error(JSON.stringify({ ok: false, ...classifySemanticDetailError(error), ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }));
  process.exitCode = 1;
});

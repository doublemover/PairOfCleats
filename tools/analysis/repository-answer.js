#!/usr/bin/env node
import path from 'node:path';
import { once } from 'node:events';
import { createCli } from '../../src/shared/cli.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { throwIfAborted } from '../../src/shared/abort.js';
import { runRepositoryAnswer } from '../../src/integrations/tooling/repository-answer.js';
import { assertRepositoryAnswer } from '../../src/contracts/validators/repository-answer.js';
import { classifySemanticDetailError } from '../../src/integrations/tooling/semantic-errors.js';
import { REPOSITORY_ANSWER_OPTIONS } from '../shared/operator-cli-options.js';

export const runRepositoryAnswerCli = async (argv = process.argv, { output = process.stdout, runner = runRepositoryAnswer, signal = null } = {}) => {
  const args = createCli({ argv, scriptName: 'pairofcleats repository-answer', usage: '$0 --request request.json [--all]',
    options: REPOSITORY_ANSWER_OPTIONS }).strictOptions().parse();
  const filename = path.resolve(args.request), { buffer } = await readVerifiedContainedFile(path.dirname(filename), filename, { maxBytes: 512 * 1024, signal });
  const request = assertRepositoryAnswer('request', JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)));
  let cursor = request.query?.cursor || null;
  let retention = request.retention;
  do {
    throwIfAborted(signal);
    const input = ['inspect', 'retained'].includes(request.mode) ? request : { ...request, query: { ...request.query, cursor }, ...(retention ? { retention } : {}) };
    const result = assertRepositoryAnswer('result', await runner(input, { signal }));
    throwIfAborted(signal);
    if (!output.write(JSON.stringify(result) + '\n')) await once(output, 'drain', { signal });
    cursor = args.all && !['inspect', 'retained'].includes(request.mode) ? result.continuation : null;
    if (retention && result.retained) retention = { expectedBaseDigest: result.retained.answerDigest };
  } while (cursor);
};
if (isDirectExecution(import.meta.url)) runRepositoryAnswerCli().catch(error => {
  console.error(JSON.stringify({ ok: false, ...classifySemanticDetailError(error), ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }));
  process.exitCode = 1;
});

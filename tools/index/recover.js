#!/usr/bin/env node
import { guardBootstrapEntry } from '../../src/shared/bootstrap-readiness.js';
import path from 'node:path';
await guardBootstrapEntry(import.meta.url);
const { buildIndex } = await import('../../src/integrations/core/build-index/index.js');
const { createCli } = await import('../../src/shared/cli.js');
const { INDEX_RECOVERY_OPTIONS } = await import('../../src/shared/index-tool-options.js');
const { readVerifiedContainedFile } = await import('../../src/shared/contained-file.js');
const { describeStorageFailure } = await import('../../src/shared/storage/failure-observation.js');
const { resolveRepoRoot } = await import('../shared/dict-utils.js');
const { emitJson } = await import('../shared/cli-utils.js');

const argv = createCli({ scriptName: 'index recover', options: INDEX_RECOVERY_OPTIONS }).parse();
const invalid = message => Object.assign(new Error(message), { code: 'ERR_RECOVERY_REQUEST' });
const controller = new AbortController();
const interrupt = () => { process.exitCode = 130; controller.abort(new Error('Recovery interrupted.')); };
const terminate = () => { process.exitCode = 143; controller.abort(new Error('Recovery terminated.')); };
process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
try {
  const modes = argv.mode === 'all' ? ['code', 'prose', 'extracted-prose', 'records'] : argv.mode ? [argv.mode] : null;
  let recovery;
  if (argv.action === 'execute') {
    if (!argv['plan-file']) throw invalid('Execute requires --plan-file with the exact reviewed inspection JSON.');
    if (argv.operation || argv.mode || argv['resume-target'] || argv['index-root'] || argv['graph-capability']) {
      throw invalid('Execute reads selectors only from the reviewed plan; do not combine it with inspection selectors.');
    }
    const filename = path.resolve(argv['plan-file']);
    const read = await readVerifiedContainedFile(path.dirname(filename), filename, { maxBytes: 512 * 1024,
      signal: controller.signal });
    let plan;
    try { plan = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.buffer)); }
    catch { throw invalid('The reviewed plan must be one valid JSON object.'); }
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw invalid('The reviewed plan must be an object.');
    recovery = { action: 'execute', plan };
  } else {
    if (argv['plan-file']) throw invalid('--plan-file is valid only for explicit execute.');
    if (argv.action === 'candidates') {
      if (argv['index-root'] || argv.operation || argv['resume-target'] || argv['graph-capability']) {
        throw invalid('Candidate inventory accepts mode selection; inspect one explicit root separately.');
      }
      recovery = { action: 'candidates', ...(modes ? { modes } : {}) };
    } else {
      if (!argv['index-root']) throw invalid('Recovery requires an exact retained --index-root; current/latest fallback is disabled.');
      if (argv.action === 'open-graph') {
        if (argv.operation || argv.mode || argv['resume-target']) throw invalid('Graph metadata open does not execute an inspection operation.');
        if (argv['graph-capability'] && !/^[a-f0-9]{64}$/.test(argv['graph-capability'])) throw invalid('Graph capability id must be an exact SHA-256 identity.');
        recovery = { action: 'open-graph', indexRoot: path.resolve(argv['index-root']),
          ...(argv['graph-capability'] ? { capabilityId: argv['graph-capability'] } : {}) };
      } else {
        if (argv['graph-capability']) throw invalid('Inspect derives graph capability authority; use open-graph for an exact existing id.');
        recovery = { action: 'inspect', indexRoot: path.resolve(argv['index-root']), operation: argv.operation || 'validate',
          ...(modes ? { modes } : {}), ...(argv['resume-target'] ? { resumeTarget: argv['resume-target'] } : {}) };
      }
    }
  }
  const result = await buildIndex(resolveRepoRoot(argv.repo), { recovery, abortSignal: controller.signal,
    log: message => process.stderr.write(`${message}\n`) });
  if (argv.json) emitJson(result, process.stdout, { spaces: 2 });
  else process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const failure = describeStorageFailure(error, { phase: 'index-recovery-cli',
    defaultCode: 'ERR_RECOVERY_FAILED', defaultMessage: 'Retained recovery failed.' });
  if (argv.json) emitJson({ ok: false, error: failure }, process.stdout, { spaces: 2 });
  else process.stderr.write(`${failure.code}: ${failure.message}\n`);
  if (!controller.signal.aborted) process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
}

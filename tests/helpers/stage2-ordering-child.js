import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { parseBuildArgs } from '../../src/index/build/args.js';
import { isTestingEnv } from '../../src/shared/env/testing.js';
assert.equal(isTestingEnv(), true);
const reportPath = process.argv[2];
assert.ok(reportPath);
const rawArgv = process.argv.slice(3), { argv } = parseBuildArgs(rawArgv);
const state = { validationCalls: 0, control: null, requested: null };
globalThis.__stage2OrderingChild = state;
const buildState = new URL('../../src/index/build/build-state.js', import.meta.url).href;
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/src/index/validate.js')) return { shortCircuit: true, format: 'module', source: `
    export * from ${JSON.stringify(new URL('../../src/index/validate.js', import.meta.url).href + '?real-validation')};
    import {validateIndexArtifacts as validate} from ${JSON.stringify(new URL('../../src/index/validate.js', import.meta.url).href + '?real-validation')};
    import {recordOrderingHash} from ${JSON.stringify(buildState)};
    export const validateIndexArtifacts=async options=>{
      const state=globalThis.__stage2OrderingChild; state.validationCalls++;
      await recordOrderingHash(options.indexRoot,{stage:'stage2',mode:'code',artifact:'chunk_meta',
        hash:'sha1:deadbeef',rule:'chunk_meta:compareChunkMetaRows',count:1});
      const control=await validate({...options,validateOrdering:false});
      state.control={ok:control.ok,issues:control.issues,warnings:control.warnings};
      const report=await validate(options);
      state.requested={ok:report.ok,issues:report.issues,warnings:report.warnings,indexRoot:options.indexRoot,
        validateOrdering:options.validateOrdering};
      return report;
    };` };
  return next(url, context);
} });
let result, error;
try {
  const { buildIndex } = await import('../../src/integrations/core/build-index/index.js');
  result = await buildIndex(argv.repo, { ...argv, rawArgv, log: () => {} });
} catch (failure) { error = { message: failure.message, code: failure.code, outcome: failure.outcome }; }
finally { hook.deregister(); delete globalThis.__stage2OrderingChild; }
await fs.writeFile(reportPath,
  JSON.stringify({ argv, rawArgv, state, result, error }));
process.exitCode = error ? 1 : 0;

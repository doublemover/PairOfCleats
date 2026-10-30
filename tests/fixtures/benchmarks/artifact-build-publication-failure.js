import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { ensureTestingEnv } from '../../helpers/test-env.js';
ensureTestingEnv(process.env);
const buildFailure = Object.assign(new Error('original artifact build failure'), { code: 'ERR_FIXTURE_ARTIFACT_BUILD' });
const publicationFailure = Object.assign(new Error('final receipt publication failure'), { code: 'ERR_FIXTURE_ARTIFACT_PUBLICATION' });
globalThis.artifactBuildFailure = buildFailure; globalThis.artifactPublicationFailure = publicationFailure;
const entry = new URL('../../../tools/bench/sqlite/build-from-artifacts.js', import.meta.url).href;
const build = new URL('../../../src/storage/sqlite/build/from-artifacts.js', import.meta.url).href;
const atomic = new URL('../../../src/shared/io/atomic-write.js', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === entry && specifier === '../../../src/storage/sqlite/build/from-artifacts.js') return { url: 'artifact-failure:build', shortCircuit: true };
  if (context.parentURL === entry && specifier === '../../../src/shared/io/atomic-write.js') return { url: 'artifact-failure:publication', shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 'artifact-failure:build') return { format: 'module', shortCircuit: true,
    source: `export {loadIndexPieces} from ${JSON.stringify(build)};export const buildDatabaseFromArtifacts=async()=>{throw globalThis.artifactBuildFailure;};` };
  if (url === 'artifact-failure:publication') return { format: 'module', shortCircuit: true,
    source: `import {atomicWriteJson as original} from ${JSON.stringify(atomic)};export const atomicWriteJson=async(file,...args)=>{
      if(file.endsWith('final.json'))throw globalThis.artifactPublicationFailure;return original(file,...args);};` };
  return next(url, context);
} });
const contains = (error, target, seen = new Set()) => {
  if (error === target) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  return contains(error.cause, target, seen) || (Array.isArray(error.errors) && error.errors.some(item => contains(item, target, seen)));
};
process.once('uncaughtException', error => {
  assert.equal(contains(error, buildFailure), true, 'the original build failure retains its object identity');
  assert.equal(contains(error, publicationFailure), true, 'the original publication failure retains its object identity');
  console.log(JSON.stringify({ fixture: 'artifact-build-publication-failure', originalBuild: true, originalPublication: true }));
  process.exitCode = 1;
});

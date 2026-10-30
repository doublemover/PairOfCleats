import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
const entry = new URL('../../../tools/bench/sqlite/build-from-artifacts.js', import.meta.url).href;
const fixture = new URL('../../../tools/bench/sqlite/artifact-fixture.js', import.meta.url).href;
globalThis.substituteArtifactWorkMarker = async owner => {
  await fs.writeFile(path.join(path.dirname(owner.workRoot), 'artifact-benchmark-owner.json'), 'substituted ordinary marker bytes');
  return owner.reclaim();
};
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === entry && specifier === './artifact-fixture.js') return { url: 'artifact-work:substitution', shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 'artifact-work:substitution') return { format: 'module', shortCircuit: true, source:
    `import {createSqliteArtifactWorkOwner as original} from ${JSON.stringify(fixture)};
    export {publishSqliteBenchmarkArtifacts,validateSqliteArtifactBenchmark} from ${JSON.stringify(fixture)};
    export const createSqliteArtifactWorkOwner=async options=>{const owner=await original(options);
      return {...owner,reclaim:()=>globalThis.substituteArtifactWorkMarker(owner)};};` };
  return next(url, context);
} });

#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import path from 'node:path';
const { createCli } = await import('../../../src/shared/cli.js');
const { writeJsonFileResolved } = await import('../../../src/shared/json-file.js');
const {
  getRuntimeConfig,
  loadUserConfig,
  resolveRuntimeEnv,
  resolveToolRoot
} = await import('../../shared/dict-utils.js');
const { checkBenchmarkPrerequisites } = await import('./prerequisite-runtime.js');

const argv = createCli({ scriptName: 'bench-prerequisite-check', options: {
  repo: { type: 'string', required: true }, out: { type: 'string', required: true },
  install: { type: 'boolean', default: true }, strict: { type: 'boolean', default: false },
  'stub-embeddings': { type: 'boolean', default: false }, sqlite: { type: 'boolean', default: false },
  'timeout-ms': { type: 'number', default: 30 * 60 * 1000 }
} }).parse();
const repoRoot = path.resolve(argv.repo);
const outputPath = path.resolve(argv.out);
let receipt;
try {
  // This process is launched with the same resolved environment as the measured child.
  const userConfig = loadUserConfig(repoRoot);
  const runtimeEnv = resolveRuntimeEnv(getRuntimeConfig(repoRoot, userConfig), process.env);
  for (const key of Object.keys(process.env)) if (!(key in runtimeEnv)) delete process.env[key];
  Object.assign(process.env, runtimeEnv);
  receipt = await checkBenchmarkPrerequisites({ repoRoot, scriptRoot: resolveToolRoot(),
    buildRoot: path.dirname(outputPath), autoInstall: argv.install !== false, strict: argv.strict,
    realEmbeddings: !argv['stub-embeddings'], wantsSqlite: argv.sqlite, timeoutMs: argv['timeout-ms'] });
} catch (error) {
  receipt = { schemaVersion: 1, repoRoot, generatedAt: new Date().toISOString(),
    readiness: { state: 'blocked', ready: false, exitCode: 1, blockedIds: ['prerequisite-check'], omittedIds: [],
      items: [{ id: 'prerequisite-check', required: true, state: 'failed', reason: error.message, code: error.code || null }] } };
}
await writeJsonFileResolved(outputPath, receipt);
process.stderr.write(`[prerequisites] ${receipt.readiness.state}\n`);
process.exitCode = receipt.readiness.exitCode;

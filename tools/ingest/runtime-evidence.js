#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { importRuntimeEvidence } from '../../src/index/semantic/runtime/import.js';
import { readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { resolveSemanticGenerationIndexDir } from '../../src/semantic/generation.js';
import { openSemanticQueryStore } from '../../src/semantic/query-store.js';
import { assertSemanticEnvelope } from '../../src/contracts/validators/semantic-envelopes.js';
import { getRepoRoot } from '../../src/shared/repo-paths.js';
import { loadUserConfig } from '../../src/shared/dict-utils.js';

const argv = createCli({ scriptName: 'runtime-evidence-import', options: {
  specification: { type: 'string', demandOption: true }, out: { type: 'string', demandOption: true },
  repo: { type: 'string', describe: 'Repository owning the explicitly selected semantic generation.' },
  generation: { type: 'string', describe: 'Pinned semantic generation as JSON; requires --repo.' }
} }).strictOptions().parse();
if (Boolean(argv.repo) !== Boolean(argv.generation)) throw new Error('--repo and --generation must be supplied together.');
const specificationPath = path.resolve(argv.specification);
const { buffer } = await readVerifiedContainedFile(path.dirname(specificationPath), specificationPath,
  { maxBytes: 16 * 1024 * 1024 });
const specification = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
if (Object.keys(specification).some(key => !['capture', 'authority', 'inputs', 'sourceCandidates', 'importOptions'].includes(key))) {
  throw new Error('Unknown runtime import specification fields.');
}
let opened;
try {
  let semanticContext = null;
  if (argv.repo) {
    const repoRoot = getRepoRoot(argv.repo);
    const generation = assertSemanticEnvelope('generation', JSON.parse(argv.generation));
    const userConfig = loadUserConfig(repoRoot);
    const indexDir = await resolveSemanticGenerationIndexDir({ repoRoot, generation, userConfig });
    opened = await openSemanticQueryStore({ repoRoot, indexDir, generation, backend: 'artifact' });
    semanticContext = { repoRoot, store: opened.store, manifest: opened.manifest };
  }
  const result = await importRuntimeEvidence({ ...specification, destination: path.resolve(argv.out), semanticContext,
    inputs: specification.inputs.map(input => ({ ...input, path: path.resolve(path.dirname(specificationPath), input.path) })) });
  process.stdout.write(JSON.stringify({ executionAuthorized: false, generationId: result.pointer.generationId,
    recordCount: result.recordCount, coverage: result.coverage, semanticVerification: opened ? 'pinned-generation' : 'not-requested' }) + '\n');
} finally { await opened?.close?.(); }

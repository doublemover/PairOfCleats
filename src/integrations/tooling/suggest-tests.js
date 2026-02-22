import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../shared/cli.js';
import { toPosix } from '../../shared/files.js';
import { normalizeOptionalNumber } from '../../shared/limits.js';
import { buildSuggestTestsReport } from '../../graph/suggest-tests.js';
import { renderSuggestTestsReport } from '../../retrieval/output/suggest-tests.js';
import { validateSuggestTests } from '../../contracts/validators/analysis.js';
import { hasIndexMeta } from '../../retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../retrieval/cli-index.js';
import { prepareGraphIndex, prepareGraphInputs } from './graph-helpers.js';
import { loadUserConfig, resolveRepoRoot } from '../../../tools/shared/dict-utils.js';
import {
  emitCliOutput,
  mergeCaps,
  parseChangedInputs,
  resolveFormat
} from './cli-helpers.js';

export async function runSuggestTestsCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'suggest-tests',
    argv: ['node', 'suggest-tests', ...rawArgs],
    options: {
      repo: { type: 'string' },
      changed: { type: 'array' },
      changedFile: { type: 'string' },
      max: { type: 'number' },
      format: { type: 'string' },
      json: { type: 'boolean', default: false },
      testPattern: { type: 'array' },
      maxDepth: { type: 'number' },
      maxNodes: { type: 'number' },
      maxEdges: { type: 'number' },
      maxPaths: { type: 'number' },
      maxCandidates: { type: 'number' },
      maxWorkUnits: { type: 'number' },
      maxWallClockMs: { type: 'number' }
    },
    aliases: {
      'test-pattern': 'testPattern',
      'changed-file': 'changedFile'
    }
  });
  const argv = cli.parse();

  if (!Number.isFinite(argv.max)) {
    throw new Error('Missing --max <n>.');
  }

  const repoRoot = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
  const format = resolveFormat(argv);
  const userConfig = loadUserConfig(repoRoot);
  const indexDir = resolveIndexDir(repoRoot, 'code', userConfig);
  if (!hasIndexMeta(indexDir)) {
    throw new Error(`Code index not found at ${indexDir}.`);
  }

  const changed = parseChangedInputs({ changed: argv.changed, changedFile: argv.changedFile }, repoRoot);
  const baseCaps = userConfig?.retrieval?.graph?.caps || {};
  const capOverrides = {
    maxDepth: normalizeOptionalNumber(argv.maxDepth),
    maxNodes: normalizeOptionalNumber(argv.maxNodes),
    maxEdges: normalizeOptionalNumber(argv.maxEdges),
    maxPaths: normalizeOptionalNumber(argv.maxPaths),
    maxCandidates: normalizeOptionalNumber(argv.maxCandidates),
    maxWorkUnits: normalizeOptionalNumber(argv.maxWorkUnits),
    maxWallClockMs: normalizeOptionalNumber(argv.maxWallClockMs),
    maxSuggestions: normalizeOptionalNumber(argv.max)
  };
  const caps = mergeCaps(baseCaps, capOverrides);

  const graphInputs = await prepareGraphInputs({
    repoRoot,
    indexDir,
    strict: true
  });
  const { graphRelations } = await prepareGraphIndex({
    repoRoot,
    indexDir,
    strict: true,
    graphInputs,
    includeGraphIndex: false,
    includeGraphRelations: true
  });

  const report = buildSuggestTestsReport({
    changed,
    graphRelations,
    repoRoot,
    testPatterns: argv.testPattern,
    caps,
    indexCompatKey: graphInputs.indexCompatKey || null,
    indexSignature: graphInputs.indexSignature || null,
    repo: toPosix(path.relative(process.cwd(), repoRoot) || '.'),
    indexDir: toPosix(path.relative(process.cwd(), indexDir) || '.')
  });

  const validation = validateSuggestTests(report);
  if (!validation.ok) {
    throw new Error(`Suggest-tests schema validation failed: ${validation.errors.join('; ')}`);
  }

  return emitCliOutput({
    format,
    payload: report,
    renderMarkdown: renderSuggestTestsReport
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSuggestTestsCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}

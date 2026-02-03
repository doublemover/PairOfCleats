import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { createCli } from '../../shared/cli.js';
import { toPosix } from '../../shared/files.js';
import { normalizeOptionalNumber } from '../../shared/limits.js';
import { readJsoncFile } from '../../shared/jsonc.js';
import { buildArchitectureReport, parseArchitectureRules } from '../../graph/architecture.js';
import { renderArchitectureReport } from '../../retrieval/output/architecture.js';
import { validateArchitectureReport } from '../../contracts/validators/analysis.js';
import { buildIndexSignature } from '../../retrieval/index-cache.js';
import { hasIndexMeta } from '../../retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../retrieval/cli-index.js';
import {
  MAX_JSON_BYTES,
  loadPiecesManifest,
  readCompatibilityKey
} from '../../shared/artifact-io.js';
import { createGraphStore } from '../../graph/store.js';
import { loadUserConfig, resolveRepoRoot } from '../../../tools/dict-utils.js';

const resolveFormat = (argv) => {
  const raw = argv.format || (argv.json ? 'json' : 'json');
  const format = String(raw).trim().toLowerCase();
  if (format === 'md' || format === 'markdown') return 'md';
  return 'json';
};

const loadRulesFile = (rulesPath) => {
  const ext = path.extname(rulesPath).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    const raw = fs.readFileSync(rulesPath, 'utf8');
    return parseYaml(raw);
  }
  return readJsoncFile(rulesPath);
};

export async function runArchitectureCheckCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'architecture-check',
    argv: ['node', 'architecture-check', ...rawArgs],
    options: {
      repo: { type: 'string' },
      rules: { type: 'string' },
      format: { type: 'string' },
      json: { type: 'boolean', default: false },
      failOnViolation: { type: 'boolean', default: false },
      maxViolations: { type: 'number' },
      maxEdgesExamined: { type: 'number' }
    },
    aliases: {
      'fail-on-violation': 'failOnViolation'
    }
  });
  const argv = cli.parse();

  if (!argv.rules) {
    throw new Error('Missing --rules <path>.');
  }

  const repoRoot = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
  const format = resolveFormat(argv);
  const rulesPath = path.resolve(argv.rules);
  if (!fs.existsSync(rulesPath)) {
    throw new Error(`Rules file not found: ${rulesPath}`);
  }
  const rulesPayload = loadRulesFile(rulesPath);
  const parsedRules = parseArchitectureRules(rulesPayload);

  const userConfig = loadUserConfig(repoRoot);
  const indexDir = resolveIndexDir(repoRoot, 'code', userConfig);
  if (!hasIndexMeta(indexDir)) {
    throw new Error(`Code index not found at ${indexDir}.`);
  }

  const manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  const graphStore = createGraphStore({ indexDir, manifest, strict: true, maxBytes: MAX_JSON_BYTES });
  const graphRelations = graphStore.hasArtifact('graph_relations')
    ? await graphStore.loadGraph()
    : null;

  const { key: indexCompatKey } = readCompatibilityKey(indexDir, {
    maxBytes: MAX_JSON_BYTES,
    strict: true
  });
  const indexSignature = buildIndexSignature(indexDir);

  const caps = {
    maxViolations: normalizeOptionalNumber(argv.maxViolations),
    maxEdgesExamined: normalizeOptionalNumber(argv.maxEdgesExamined)
  };

  const report = buildArchitectureReport({
    rules: parsedRules.rules,
    graphRelations,
    caps,
    indexCompatKey: indexCompatKey || null,
    indexSignature: indexSignature || null,
    repo: toPosix(path.relative(process.cwd(), repoRoot) || '.'),
    indexDir: toPosix(path.relative(process.cwd(), indexDir) || '.'),
    repoRoot
  });

  const validation = validateArchitectureReport(report);
  if (!validation.ok) {
    throw new Error(`Architecture report schema validation failed: ${validation.errors.join('; ')}`);
  }

  const failOnViolation = argv.failOnViolation === true || argv['fail-on-violation'] === true;
  if (failOnViolation && report.violations.length) {
    const error = new Error('Architecture violations detected.');
    error.code = 'ERR_ARCHITECTURE_VIOLATION';
    error.report = report;
    throw error;
  }

  if (format === 'md') {
    console.log(renderArchitectureReport(report));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runArchitectureCheckCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(err?.code === 'ERR_ARCHITECTURE_VIOLATION' ? 2 : 1);
  });
}

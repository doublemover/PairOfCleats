import { ARCHITECTURE_CHECK_OPTIONS } from '../../../tools/shared/operator-cli-options.js';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { createCli } from '../../shared/cli.js';
import { isDirectExecution } from '../../shared/direct-execution.js';
import { toPosix } from '../../shared/file-paths.js';
import { normalizeOptionalNumber } from '../../shared/limits.js';
import { readJsoncFile } from '../../shared/jsonc.js';
import { emitCliOutput, resolveFormat } from './cli-helpers.js';
import { buildArchitectureReport, parseArchitectureRules } from '../../graph/architecture.js';
import { renderArchitectureReport } from '../../retrieval/output/architecture.js';
import { validateArchitectureReport } from '../../contracts/validators/analysis.js';
import { hasIndexMeta } from '../../retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../retrieval/cli-index.js';
import { prepareGraphIndex, prepareGraphInputs } from './graph-helpers.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { getRepoRoot } from '../../shared/repo-paths.js';
import { admitReportInput, emitReportOutcome } from './report-outcome.js';

const loadRulesFile = (rulesPath) => {
  const ext = path.extname(rulesPath).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    const raw = fs.readFileSync(rulesPath, 'utf8');
    return parseYaml(raw);
  }
  return readJsoncFile(rulesPath);
};

/**
 * CLI entrypoint for architecture-rule validation against graph artifacts.
 *
 * Loads JSON/JSONC/YAML rule definitions, evaluates graph relations against
 * parsed rules, validates the report contract, and supports violation-gated
 * failure via `--fail-on-violation`.
 *
 * @param {string[]} [rawArgs]
 * @returns {Promise<{ok:boolean,code?:string,payload?:object,message?:string}>}
 */
export async function runArchitectureCheckCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'architecture-check',
    argv: ['node', 'architecture-check', ...rawArgs],
    options: ARCHITECTURE_CHECK_OPTIONS,
    aliases: {
      'fail-on-violation': 'failOnViolation'
    }
  });
  const argv = cli.parse();

  if (!argv.rules) {
    throw new Error('Missing --rules <path>.');
  }

  const repoRoot = getRepoRoot(argv.repo || null, process.cwd());
  const format = resolveFormat(argv);
  const rulesPath = path.resolve(argv.rules);
  if (!fs.existsSync(rulesPath)) {
    throw new Error(`Rules file not found: ${rulesPath}`);
  }
  const rulesPayload = loadRulesFile(rulesPath);
  const parsedRules = admitReportInput(() => parseArchitectureRules(rulesPayload), { format,
    inputCodes: ['ERR_ARCHITECTURE_RULE_INPUT', 'ERR_ARCHITECTURE_DUPLICATE_RULE_ID'] });

  const userConfig = loadUserConfig(repoRoot);
  const indexDir = resolveIndexDir(repoRoot, 'code', userConfig);
  if (!hasIndexMeta(indexDir)) {
    throw new Error(`Code index not found at ${indexDir}.`);
  }

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

  const caps = {
    maxViolations: normalizeOptionalNumber(argv.maxViolations),
    maxEdgesExamined: normalizeOptionalNumber(argv.maxEdgesExamined)
  };

  const report = buildArchitectureReport({
    rules: parsedRules.rules,
    graphRelations,
    caps,
    indexCompatKey: graphInputs.indexCompatKey || null,
    indexSignature: graphInputs.indexSignature || null,
    repo: toPosix(path.relative(process.cwd(), repoRoot) || '.'),
    indexDir: toPosix(path.relative(process.cwd(), indexDir) || '.'),
    repoRoot
  });

  const failOnViolation = argv.failOnViolation === true || argv['fail-on-violation'] === true;
  return emitReportOutcome({ label: 'Architecture report', validate: validateArchitectureReport,
    policyCodes: ['ERR_ARCHITECTURE_VIOLATION', 'ERR_ARCHITECTURE_INCOMPLETE'],
    build: () => {
      if (failOnViolation && (report.summary?.detectedViolations || report.violations.length)) {
        throw Object.assign(new Error('Architecture violations detected.'), { code: 'ERR_ARCHITECTURE_VIOLATION', report });
      }
      if (failOnViolation && report.summary?.complete === false) {
        throw Object.assign(new Error('Architecture evaluation is incomplete; a clean verdict is unavailable.'),
          { code: 'ERR_ARCHITECTURE_INCOMPLETE', report });
      }
      return report;
    },
    emit: payload => emitCliOutput({ format, payload, renderMarkdown: renderArchitectureReport })
  });
}

if (isDirectExecution(import.meta.url)) {
  runArchitectureCheckCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(err?.code === 'ERR_ARCHITECTURE_VIOLATION' ? 2 : 1);
  });
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { warmupNativeTreeSitterParsers } from '../../../lang/tree-sitter/native-runtime.js';
import { resolveTreeSitterSchedulerPaths } from './paths.js';
import { executeTreeSitterSchedulerPlan } from './executor.js';

const JSONL_LOAD_RETRY_ATTEMPTS = 8;
const JSONL_LOAD_RETRY_BASE_DELAY_MS = 25;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseArgs = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--outDir') {
      out.outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--grammarKey') {
      out.grammarKey = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--outDir=')) {
      out.outDir = arg.split('=', 2)[1];
      continue;
    }
    if (arg.startsWith('--grammarKey=')) {
      out.grammarKey = arg.split('=', 2)[1];
    }
  }
  return out;
};

const parseJsonLines = (text, filePath) => {
  const rows = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch (err) {
      const snippet = trimmed.slice(0, 120);
      const parseErr = new Error(
        `[tree-sitter:schedule] invalid jsonl row in ${filePath} at line ${lineNumber + 1}: ` +
        `${err?.message || err}; row=${snippet}`
      );
      parseErr.code = 'ERR_TREE_SITTER_JSONL_PARSE';
      parseErr.cause = err;
      throw parseErr;
    }
  }
  return rows;
};

const loadJsonLines = async (filePath) => {
  let lastError = null;
  for (let attempt = 0; attempt < JSONL_LOAD_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const text = await fs.readFile(filePath, 'utf8');
      return parseJsonLines(text, filePath);
    } catch (err) {
      lastError = err;
      const retryable = err?.code === 'ENOENT' || err?.code === 'ERR_TREE_SITTER_JSONL_PARSE';
      if (!retryable || attempt >= JSONL_LOAD_RETRY_ATTEMPTS - 1) {
        throw err;
      }
      await sleep(JSONL_LOAD_RETRY_BASE_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError || new Error(`[tree-sitter:schedule] failed to load JSONL rows: ${filePath}`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.outDir;
  const grammarKeyFilter = args.grammarKey || null;
  if (!outDir) {
    console.error('[tree-sitter:schedule] missing --outDir');
    process.exit(2);
  }

  const paths = resolveTreeSitterSchedulerPaths(outDir);
  const rawPlan = JSON.parse(await fs.readFile(paths.planPath, 'utf8'));
  const plan = rawPlan?.fields && typeof rawPlan.fields === 'object' ? rawPlan.fields : rawPlan;

  const repoRoot = plan?.repoRoot || null;
  const mode = plan?.mode || null;
  const treeSitterConfig = plan?.treeSitterConfig || null;
  const grammarKeys = Array.isArray(plan?.grammarKeys) ? plan.grammarKeys : [];
  if (!repoRoot || !mode || !grammarKeys.length) {
    throw new Error('[tree-sitter:schedule] invalid plan; missing repoRoot/mode/grammarKeys');
  }
  if (grammarKeyFilter && !grammarKeys.includes(grammarKeyFilter)) {
    throw new Error(`[tree-sitter:schedule] grammarKey not in plan: ${grammarKeyFilter}`);
  }

  const groups = [];
  const selectedKeys = grammarKeyFilter ? [grammarKeyFilter] : grammarKeys;
  for (const grammarKey of selectedKeys) {
    const jobPath = paths.jobPathForGrammarKey(grammarKey);
    const jobs = await loadJsonLines(jobPath);
    const languages = new Set();
    for (const job of jobs) {
      if (job?.languageId) languages.add(job.languageId);
    }
    groups.push({
      grammarKey,
      languages: Array.from(languages),
      jobs
    });
  }

  const runtime = {
    root: path.resolve(repoRoot),
    languageOptions: { treeSitter: treeSitterConfig }
  };

  if (treeSitterConfig?.nativeWarmup === true) {
    const warmupLanguages = Array.from(new Set(groups.flatMap((group) => (
      Array.isArray(group?.languages) ? group.languages : []
    ))));
    if (warmupLanguages.length) {
      const warmup = warmupNativeTreeSitterParsers(warmupLanguages, {
        treeSitter: treeSitterConfig,
        log: console.log
      });
      if (warmup.failed.length) {
        console.warn(
          `[tree-sitter:schedule] warmup failed for ${warmup.failed.length} language(s): ${warmup.failed.join(', ')}`
        );
      }
    }
  }

  await executeTreeSitterSchedulerPlan({
    mode,
    runtime,
    groups,
    outDir,
    log: console.log
  });
};

main().catch((err) => {
  const message = err?.message || String(err);
  console.error(`[tree-sitter:schedule] exec failed: ${message}`);
  process.exit(1);
});

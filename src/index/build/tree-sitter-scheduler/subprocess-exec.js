import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveTreeSitterSchedulerPaths } from './paths.js';
import { executeTreeSitterSchedulerPlan } from './executor.js';

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

const loadJsonLines = async (filePath) => {
  const text = await fs.readFile(filePath, 'utf8');
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed));
  }
  return rows;
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

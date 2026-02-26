import fs from 'node:fs/promises';
import path from 'node:path';
import { warmupNativeTreeSitterParsers } from '../../../lang/tree-sitter/native-runtime.js';
import { toStringArray } from '../../../shared/iterables.js';
import { getTreeSitterSchedulerCrashInjectionTokens } from '../../../shared/env.js';
import { resolveTreeSitterSchedulerPaths } from './paths.js';
import { executeTreeSitterSchedulerPlan } from './executor.js';

const JSONL_LOAD_RETRY_ATTEMPTS = 8;
const JSONL_LOAD_RETRY_BASE_DELAY_MS = 25;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const emitLine = (message, stream = process.stderr) => {
  stream.write(`${String(message)}\n`);
};
const emitInfo = (message) => emitLine(message, process.stdout);
const emitWarn = (message) => emitLine(message, process.stderr);
const emitError = (message) => emitLine(message, process.stderr);
const INJECTED_CRASH_PREFIX = '[tree-sitter:schedule] injected-crash ';
const CRASH_EVENT_PREFIX = '[tree-sitter:schedule] crash-event ';

const parseCrashInjectionTokens = () => getTreeSitterSchedulerCrashInjectionTokens();

const shouldInjectCrashForGroup = (group, injectionTokens) => {
  if (!(injectionTokens instanceof Set) || injectionTokens.size === 0) return false;
  if (injectionTokens.has('*') || injectionTokens.has('1') || injectionTokens.has('true')) return true;
  const grammarKey = typeof group?.grammarKey === 'string' ? group.grammarKey.trim().toLowerCase() : '';
  if (grammarKey && injectionTokens.has(grammarKey)) return true;
  const languages = Array.isArray(group?.languages) ? group.languages : [];
  for (const languageId of languages) {
    const normalized = typeof languageId === 'string' ? languageId.trim().toLowerCase() : '';
    if (!normalized) continue;
    if (injectionTokens.has(normalized) || injectionTokens.has(`language:${normalized}`)) return true;
  }
  return false;
};

const parseArgs = (argv) => {
  const out = { grammarKeys: [] };
  const pushGrammarKey = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    out.grammarKeys.push(trimmed);
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--outDir') {
      out.outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--profileOut') {
      out.profileOut = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--grammarKey') {
      pushGrammarKey(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--grammarKeys') {
      const raw = argv[i + 1];
      for (const part of String(raw || '').split(',')) pushGrammarKey(part);
      i += 1;
      continue;
    }
    if (arg.startsWith('--outDir=')) {
      out.outDir = arg.split('=', 2)[1];
      continue;
    }
    if (arg.startsWith('--profileOut=')) {
      out.profileOut = arg.split('=', 2)[1];
      continue;
    }
    if (arg.startsWith('--grammarKey=')) {
      pushGrammarKey(arg.split('=', 2)[1]);
      continue;
    }
    if (arg.startsWith('--grammarKeys=')) {
      const raw = arg.split('=', 2)[1];
      for (const part of String(raw || '').split(',')) pushGrammarKey(part);
    }
  }
  out.grammarKeys = Array.from(new Set(out.grammarKeys));
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
      const retryable = err?.code === 'ENOENT' || err?.code === 'EAGAIN' || err?.code === 'EBUSY';
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
  const grammarKeyFilters = Array.isArray(args.grammarKeys) ? args.grammarKeys : [];
  const profileOutPath = typeof args.profileOut === 'string' && args.profileOut
    ? path.resolve(args.profileOut)
    : null;
  if (!outDir) {
    emitError('[tree-sitter:schedule] missing --outDir');
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
  for (const grammarKeyFilter of grammarKeyFilters) {
    if (!grammarKeys.includes(grammarKeyFilter)) {
      throw new Error(`[tree-sitter:schedule] grammarKey not in plan: ${grammarKeyFilter}`);
    }
  }

  const groups = [];
  const selectedKeys = grammarKeyFilters.length ? grammarKeyFilters : grammarKeys;
  const groupMetaByGrammarKey = plan?.groupMeta && typeof plan.groupMeta === 'object'
    ? plan.groupMeta
    : {};
  for (const grammarKey of selectedKeys) {
    const jobPath = paths.jobPathForGrammarKey(grammarKey);
    const jobs = await loadJsonLines(jobPath);
    const configuredLanguages = groupMetaByGrammarKey?.[grammarKey]?.languages;
    const languages = new Set(toStringArray(configuredLanguages));
    if (!languages.size) {
      for (const job of jobs) {
        if (job?.languageId) languages.add(job.languageId);
      }
    }
    groups.push({
      grammarKey,
      baseGrammarKey: typeof groupMetaByGrammarKey?.[grammarKey]?.baseGrammarKey === 'string'
        ? groupMetaByGrammarKey[grammarKey].baseGrammarKey
        : grammarKey,
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
        log: emitInfo
      });
      if (warmup.failed.length) {
        emitWarn(
          `[tree-sitter:schedule] warmup failed for ${warmup.failed.length} language(s): ${warmup.failed.join(', ')}`
        );
      }
    }
  }

  const profileRows = [];
  const crashInjectionTokens = parseCrashInjectionTokens();
  for (const group of groups) {
    if (shouldInjectCrashForGroup(group, crashInjectionTokens)) {
      const injectedEvent = {
        schemaVersion: '1.0.0',
        stage: 'scheduler-subprocess',
        mode,
        grammarKey: group?.grammarKey || null,
        languages: Array.isArray(group?.languages) ? group.languages : [],
        reason: 'test-injected'
      };
      emitError(`${INJECTED_CRASH_PREFIX}${JSON.stringify(injectedEvent)}`);
      // Simulate abrupt parser worker termination for failure-injection tests.
      process.exit(86);
    }
    const startedAt = Date.now();
    await executeTreeSitterSchedulerPlan({
      mode,
      runtime,
      groups: [group],
      outDir,
      log: emitInfo
    });
    profileRows.push({
      baseGrammarKey: group.baseGrammarKey || group.grammarKey,
      grammarKey: group.grammarKey,
      rows: Array.isArray(group.jobs) ? group.jobs.length : 0,
      durationMs: Math.max(1, Date.now() - startedAt),
      at: new Date().toISOString()
    });
  }
  if (profileOutPath) {
    await fs.mkdir(path.dirname(profileOutPath), { recursive: true });
    await fs.writeFile(
      profileOutPath,
      JSON.stringify({
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        rows: profileRows
      }),
      'utf8'
    );
  }
};

main().catch((err) => {
  const message = err?.message || String(err);
  const crashEvent = {
    schemaVersion: '1.0.0',
    stage: err?.stage || 'scheduler-subprocess',
    code: err?.code || null,
    message,
    meta: err?.treeSitterSchedulerMeta || null
  };
  try {
    emitError(`${CRASH_EVENT_PREFIX}${JSON.stringify(crashEvent)}`);
  } catch {}
  emitError(`[tree-sitter:schedule] exec failed: ${message}`);
  process.exit(1);
});

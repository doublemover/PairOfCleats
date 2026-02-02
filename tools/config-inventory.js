#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveToolRoot } from './dict-utils.js';
import { collectSchemaEntries, getLeafEntries, mergeEntry } from './config-inventory/schema.js';
import { listSourceFiles, scanSourceFiles } from './config-inventory/scan.js';
import { buildInventoryReportMarkdown } from './config-inventory/report.js';

const defaultRoot = resolveToolRoot();
const defaultSchemaPath = path.join(defaultRoot, 'docs', 'config', 'schema.json');
const defaultOutputJsonPath = path.join(defaultRoot, 'docs', 'config', 'inventory.json');
const defaultOutputMdPath = path.join(defaultRoot, 'docs', 'config', 'inventory.md');

const PUBLIC_CONFIG_KEYS = new Set(['cache.root', 'quality']);
const PUBLIC_ENV_VARS = new Set(['PAIROFCLEATS_API_TOKEN']);
const PUBLIC_CLI_FLAGS = new Set([
  'repo',
  'mode',
  'quality',
  'watch',
  'top',
  'json',
  'explain',
  'filter',
  'backend',
  'host',
  'port'
]);
const KNOWN_CONFIG_KEYS = new Set();
const KNOWN_ENV_VARS = new Set([
  'PAIROFCLEATS_API_TOKEN',
  'PAIROFCLEATS_BENCH_RUN',
  'PAIROFCLEATS_BUNDLE_THREADS',
  'PAIROFCLEATS_CACHE_ROOT',
  'PAIROFCLEATS_DEBUG_CRASH',
  'PAIROFCLEATS_DICT_DIR',
  'PAIROFCLEATS_DISCOVERY_STAT_CONCURRENCY',
  'PAIROFCLEATS_EMBEDDINGS',
  'PAIROFCLEATS_EXTENSIONS_DIR',
  'PAIROFCLEATS_FILE_CACHE_MAX',
  'PAIROFCLEATS_HOME',
  'PAIROFCLEATS_IMPORT_GRAPH',
  'PAIROFCLEATS_IO_OVERSUBSCRIBE',
  'PAIROFCLEATS_LOG_FORMAT',
  'PAIROFCLEATS_LOG_LEVEL',
  'PAIROFCLEATS_MAX_OLD_SPACE_MB',
  'PAIROFCLEATS_MCP_MAX_BUFFER_BYTES',
  'PAIROFCLEATS_MCP_QUEUE_MAX',
  'PAIROFCLEATS_MCP_TOOL_TIMEOUT_MS',
  'PAIROFCLEATS_MODEL',
  'PAIROFCLEATS_MODELS_DIR',
  'PAIROFCLEATS_NODE_OPTIONS',
  'PAIROFCLEATS_PROFILE',
  'PAIROFCLEATS_SKIP_BENCH',
  'PAIROFCLEATS_SKIP_SCRIPT_COVERAGE',
  'PAIROFCLEATS_SKIP_SQLITE_INCREMENTAL',
  'PAIROFCLEATS_STAGE',
  'PAIROFCLEATS_SUITE_MODE',
  'PAIROFCLEATS_SUMMARY_CACHE_MAX',
  'PAIROFCLEATS_TESTING',
  'PAIROFCLEATS_TEST_ALLOW_TIMEOUT_TARGET',
  'PAIROFCLEATS_TEST_ALLOW_MISSING_COMPAT_KEY',
  'PAIROFCLEATS_TEST_CACHE_SUFFIX',
  'PAIROFCLEATS_TEST_CODE_MAP_BUDGET_MS',
  'PAIROFCLEATS_TEST_CONFIG',
  'PAIROFCLEATS_TEST_LOG_DIR',
  'PAIROFCLEATS_TEST_LOG_SILENT',
  'PAIROFCLEATS_TEST_MCP_DELAY_MS',
  'PAIROFCLEATS_TEST_MAX_JSON_BYTES',
  'PAIROFCLEATS_TEST_MAX_OLD_SPACE_MB',
  'PAIROFCLEATS_TEST_NODE_OPTIONS',
  'PAIROFCLEATS_TEST_PID_FILE',
  'PAIROFCLEATS_TEST_RETRIES',
  'PAIROFCLEATS_TEST_TANTIVY',
  'PAIROFCLEATS_TEST_THREADS',
  'PAIROFCLEATS_TEST_TIMEOUT_MS',
  'PAIROFCLEATS_THREADS',
  'PAIROFCLEATS_UPDATE_SNAPSHOTS',
  'PAIROFCLEATS_UV_THREADPOOL_SIZE',
  'PAIROFCLEATS_VERBOSE',
  'PAIROFCLEATS_WATCHER_BACKEND',
  'PAIROFCLEATS_WORKER_POOL',
  'PAIROFCLEATS_XXHASH_BACKEND'
]);
const PUBLIC_FLAG_SOURCES = new Set([
  'bin/pairofcleats.js',
  'src/shared/cli.js'
]);
const BUDGETS = {
  configKeys: 2,
  envVars: 1,
  cliFlags: 25
};

const shouldCheck = process.argv.includes('--check');

export const buildInventory = async (options = {}) => {
  const root = options.root ? path.resolve(options.root) : resolveToolRoot();
  const schemaPath = options.schemaPath ? path.resolve(options.schemaPath) : defaultSchemaPath;
  const outputJsonPath = options.outputJsonPath
    ? path.resolve(options.outputJsonPath)
    : defaultOutputJsonPath;
  const outputMdPath = options.outputMdPath
    ? path.resolve(options.outputMdPath)
    : defaultOutputMdPath;
  const checkBudget = typeof options.check === 'boolean' ? options.check : shouldCheck;
  const sourceFiles = Array.isArray(options.sourceFiles)
    ? options.sourceFiles
    : await listSourceFiles(root);
  const schemaRaw = await fs.readFile(schemaPath, 'utf8');
  const schema = JSON.parse(schemaRaw);
  const entries = collectSchemaEntries(schema);
  const entryMap = new Map();
  for (const entry of entries) {
    if (!entry.path) continue;
    const existing = entryMap.get(entry.path);
    if (!existing) {
      entryMap.set(entry.path, { ...entry });
    } else {
      mergeEntry(existing, entry);
    }
  }
  const configEntries = Array.from(entryMap.values())
    .sort((a, b) => a.path.localeCompare(b.path));
  const configLeafEntries = getLeafEntries(configEntries);
  const topLevel = new Map();
  for (const entry of configEntries) {
    const rootKey = entry.path.split(/[.[\]]/)[0] || entry.path;
    topLevel.set(rootKey, (topLevel.get(rootKey) || 0) + 1);
  }

  const {
    envVarMap,
    cliFlagMap,
    cliFlagsByFile,
    dynamicOptionFiles
  } = await scanSourceFiles(root, sourceFiles);

  const envVars = Array.from(envVarMap.entries())
    .map(([name, files]) => ({ name, files: Array.from(files).sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const cliFlags = Array.from(cliFlagMap.entries())
    .map(([flag, files]) => ({ flag, files: Array.from(files).sort() }))
    .sort((a, b) => a.flag.localeCompare(b.flag));

  const cliFlagsByFileOutput = Array.from(cliFlagsByFile.entries())
    .map(([file, flags]) => ({ file, flags }))
    .sort((a, b) => a.file.localeCompare(b.file));

  const publicFlagsDetected = new Set();
  for (const entry of cliFlagsByFileOutput) {
    if (!PUBLIC_FLAG_SOURCES.has(entry.file)) continue;
    entry.flags.forEach((flag) => publicFlagsDetected.add(flag));
  }

  const knownConfigLeafKeys = KNOWN_CONFIG_KEYS.size
    ? Array.from(KNOWN_CONFIG_KEYS)
    : configLeafEntries.map((entry) => entry.path);
  const publicConfigLeafKeys = configLeafEntries
    .filter((entry) => PUBLIC_CONFIG_KEYS.has(entry.path))
    .map((entry) => entry.path)
    .sort();
  const unknownConfigLeafKeys = configLeafEntries
    .filter((entry) => !knownConfigLeafKeys.includes(entry.path))
    .map((entry) => entry.path)
    .sort();

  const publicEnvVars = envVars
    .filter((entry) => PUBLIC_ENV_VARS.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  const unknownEnvVars = envVars
    .filter((entry) => !KNOWN_ENV_VARS.has(entry.name))
    .map((entry) => entry.name)
    .sort();

  const publicFlags = cliFlags
    .filter((entry) => PUBLIC_CLI_FLAGS.has(entry.flag))
    .map((entry) => entry.flag)
    .sort();
  const internalFlags = cliFlags
    .filter((entry) => !PUBLIC_CLI_FLAGS.has(entry.flag))
    .map((entry) => entry.flag)
    .sort();
  const unknownPublicFlags = Array.from(publicFlagsDetected)
    .filter((flag) => !PUBLIC_CLI_FLAGS.has(flag))
    .sort();

  const duplicatedFlags = cliFlags
    .filter((entry) => entry.files.length > 1)
    .map((entry) => ({
      flag: entry.flag,
      count: entry.files.length,
      files: entry.files
    }))
    .sort((a, b) => b.count - a.count || a.flag.localeCompare(b.flag));

  const inventory = {
    generatedAt: new Date().toISOString(),
    budgets: { ...BUDGETS },
    allowlists: {
      configKeys: Array.from(PUBLIC_CONFIG_KEYS).sort(),
      envVars: Array.from(PUBLIC_ENV_VARS).sort(),
      cliFlags: Array.from(PUBLIC_CLI_FLAGS).sort(),
      knownEnvVars: Array.from(KNOWN_ENV_VARS).sort(),
      knownConfigKeys: Array.from(knownConfigLeafKeys).sort()
    },
    configSchema: {
      path: path.relative(root, schemaPath).replace(/\\/g, '/'),
      totalKeys: configEntries.length,
      leafKeys: configLeafEntries.length,
      topLevel: Array.from(topLevel.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => a.key.localeCompare(b.key))
    },
    configKeys: configEntries,
    configKeysPublic: publicConfigLeafKeys,
    configKeysUnknown: unknownConfigLeafKeys,
    envVars,
    envVarsPublic: publicEnvVars,
    envVarsUnknown: unknownEnvVars,
    cliFlags: {
      totalFlags: cliFlags.length,
      publicFlags,
      internalFlags,
      publicDetected: Array.from(publicFlagsDetected).sort(),
      publicUnknown: unknownPublicFlags,
      byFile: cliFlagsByFileOutput,
      duplicated: duplicatedFlags,
      dynamicOptionFiles: Array.from(dynamicOptionFiles).sort()
    }
  };

  await fs.writeFile(outputJsonPath, JSON.stringify(inventory, null, 2));

  const mdOutput = buildInventoryReportMarkdown(inventory);
  await fs.writeFile(outputMdPath, mdOutput);

  if (checkBudget) {
    const errors = [];
    if (unknownConfigLeafKeys.length) {
      errors.push(`Config keys not in allowlist: ${unknownConfigLeafKeys.join(', ')}`);
    }
    if (unknownEnvVars.length) {
      errors.push(`Env vars not in allowlist: ${unknownEnvVars.join(', ')}`);
    }
    if (unknownPublicFlags.length) {
      errors.push(`Public CLI flags not in allowlist: ${unknownPublicFlags.join(', ')}`);
    }
    if (publicConfigLeafKeys.length > BUDGETS.configKeys) {
      errors.push(`Public config keys exceed budget (${publicConfigLeafKeys.length}/${BUDGETS.configKeys}).`);
    }
    if (publicEnvVars.length > BUDGETS.envVars) {
      errors.push(`Public env vars exceed budget (${publicEnvVars.length}/${BUDGETS.envVars}).`);
    }
    if (PUBLIC_CLI_FLAGS.size > BUDGETS.cliFlags) {
      errors.push(`Public CLI flags exceed budget (${PUBLIC_CLI_FLAGS.size}/${BUDGETS.cliFlags}).`);
    }
    if (errors.length) {
      errors.forEach((msg) => console.error(`[config-budget] ${msg}`));
      process.exit(1);
    }
  }
};

export { collectSchemaEntries, getLeafEntries, mergeEntry };

await buildInventory();

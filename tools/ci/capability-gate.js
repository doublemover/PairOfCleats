#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { getCapabilities } from '../../src/shared/capabilities.js';
import { ERROR_CODES } from '../../src/shared/error-codes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

const DEFAULT_JSON_PATH = path.join(ROOT, '.diagnostics', 'capabilities.json');

const parseArgs = () => {
  const parser = yargs(hideBin(process.argv))
    .scriptName('pairofcleats capability-gate')
    .option('mode', { type: 'string', default: 'ci', choices: ['ci', 'nightly'] })
    .option('require', { type: 'string', array: true, default: [] })
    .option('json', { type: 'string', default: '' })
    .help()
    .alias('h', 'help')
    .strictOptions();
  return parser.parse();
};

const serializeError = (error) => {
  if (!error) return null;
  return {
    message: error?.message || String(error),
    code: error?.code || null,
    name: error?.name || null
  };
};

const requireModule = (name) => {
  try {
    return { ok: true, mod: require(name) };
  } catch (error) {
    return { ok: false, error };
  }
};

const importModule = async (name) => {
  try {
    return { ok: true, mod: await import(name) };
  } catch (error) {
    return { ok: false, error };
  }
};

const probeSqlite = () => {
  const load = requireModule('better-sqlite3');
  if (!load.ok) {
    return { available: false, reason: 'module_load_failed', error: serializeError(load.error) };
  }
  try {
    const Database = load.mod?.default || load.mod;
    const db = new Database(':memory:');
    const row = db.prepare('select 1 as ok').get();
    db.close();
    return { available: Boolean(row?.ok), reason: 'ok' };
  } catch (error) {
    return { available: false, reason: 'runtime_probe_failed', error: serializeError(error) };
  }
};

const probeHnsw = () => {
  const load = requireModule('hnswlib-node');
  if (!load.ok) {
    return { available: false, reason: 'module_load_failed', error: serializeError(load.error) };
  }
  try {
    const HNSW = load.mod?.HierarchicalNSW || load.mod?.default?.HierarchicalNSW || load.mod?.default;
    if (!HNSW) {
      return { available: false, reason: 'constructor_missing' };
    }
    const index = new HNSW('l2', 2);
    index.initIndex({ maxElements: 2, m: 8, efConstruction: 50, randomSeed: 7 });
    index.addPoint([0, 0], 0);
    index.addPoint([1, 0], 1);
    return { available: true, reason: 'ok' };
  } catch (error) {
    return { available: false, reason: 'runtime_probe_failed', error: serializeError(error) };
  }
};

const probeLmdb = () => {
  const load = requireModule('lmdb');
  if (!load.ok) {
    return { available: false, reason: 'module_load_failed', error: serializeError(load.error) };
  }
  return { available: true, reason: 'ok' };
};

const probeTantivy = () => {
  const load = requireModule('tantivy');
  if (!load.ok) {
    return { available: false, reason: 'module_load_failed', error: serializeError(load.error) };
  }
  return { available: true, reason: 'ok' };
};

const probeLanceDb = async () => {
  const load = requireModule('@lancedb/lancedb');
  if (load.ok) {
    return { available: true, reason: 'ok' };
  }
  if (load.error?.code === 'ERR_REQUIRE_ESM') {
    const esmLoad = await importModule('@lancedb/lancedb');
    if (esmLoad.ok) {
      return { available: true, reason: 'ok' };
    }
    return { available: false, reason: 'module_load_failed', error: serializeError(esmLoad.error) };
  }
  return { available: false, reason: 'module_load_failed', error: serializeError(load.error) };
};

const buildReport = async (mode) => {
  const caps = getCapabilities({ refresh: true });
  const probes = {
    sqlite: probeSqlite(),
    lmdb: probeLmdb(),
    hnsw: probeHnsw(),
    lancedb: await probeLanceDb()
  };
  if (mode !== 'ci') {
    probes.tantivy = probeTantivy();
  }

  return {
    mode,
    timestamp: new Date().toISOString(),
    capabilities: caps,
    probes
  };
};

const collectMissing = (required, probes) => {
  const missing = [];
  for (const name of required) {
    const probe = probes[name];
    if (!probe) {
      missing.push({ capability: name, reason: 'unknown_capability' });
      continue;
    }
    if (!probe.available) {
      missing.push({ capability: name, reason: probe.reason });
    }
  }
  return missing;
};

const renderSummary = (report, requiredMissing) => {
  console.error(`Capability gate (${report.mode})`);
  for (const [name, probe] of Object.entries(report.probes)) {
    const status = probe.available ? 'available' : `missing (${probe.reason})`;
    console.error(`- ${name}: ${status}`);
  }
  if (requiredMissing.length) {
    console.error(`Required missing: ${requiredMissing.map((entry) => entry.capability).join(', ')}`);
  }
};

const main = async () => {
  const argv = parseArgs();
  const mode = argv.mode;
  const required = argv.require.map((value) => value.trim()).filter(Boolean);
  const jsonPath = argv.json ? path.resolve(argv.json) : DEFAULT_JSON_PATH;

  const report = await buildReport(mode);
  const requiredMissing = collectMissing(required, report.probes);
  report.required = required;
  report.requiredMissing = requiredMissing;

  await fsPromises.mkdir(path.dirname(jsonPath), { recursive: true });
  await fsPromises.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  renderSummary(report, requiredMissing);

  if (requiredMissing.length) {
    console.error(ERROR_CODES.CAPABILITY_MISSING);
    process.exit(3);
  }
};

main().catch((error) => {
  const message = error?.message || String(error);
  console.error(`capability gate failed: ${message}`);
  process.exit(1);
});

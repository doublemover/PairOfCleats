#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createCli } from '../../src/shared/cli.js';

const ROOT = process.cwd();
const DEFAULT_BASELINE_PATH = path.join(ROOT, 'docs', 'tooling', 'shared-module-performance-baselines.json');

const DEFAULT_MODULES = Object.freeze([
  { id: 'shared.search-request', path: 'src/shared/search-request.js' },
  { id: 'shared.command-registry', path: 'src/shared/command-registry.js' },
  { id: 'shared.runtime-capability-manifest', path: 'src/shared/runtime-capability-manifest.js' },
  { id: 'shared.artifact-io', path: 'src/shared/artifact-io.js' },
  { id: 'shared.subprocess', path: 'src/shared/subprocess.js' },
  { id: 'retrieval.run-search', path: 'src/retrieval/cli/run-search.js' }
]);

const DEFAULT_COMMANDS = Object.freeze([
  { id: 'cli.search-help', args: ['search.js', '--help'] },
  { id: 'cli.pairofcleats-help', args: ['bin/pairofcleats.js', 'help'] },
  { id: 'report.metrics-help', args: ['tools/reports/metrics-dashboard.js', '--help'] },
  { id: 'report.diagnostics-help', args: ['tools/reports/diagnostics-report.js', '--help'] }
]);

const argv = createCli({
  scriptName: 'pairofcleats testing shared-module-performance',
  options: {
    json: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    baseline: { type: 'string' }
  }
}).parse();

const IMPORT_SPECIFIER_PATTERN = /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;

const normalizePath = (filePath) => filePath.replace(/\\/g, '/');

function extractModuleSpecifiers(sourceText) {
  const specifiers = [];
  for (const match of sourceText.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    const specifier = String(match[1] || '').trim();
    if (specifier) specifiers.push(specifier);
  }
  return Array.from(new Set(specifiers));
}

function resolveLocalModulePath(fromFile, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
  const basePath = specifier.startsWith('/')
    ? path.resolve(ROOT, `.${specifier}`)
    : path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    basePath,
    `${basePath}.js`,
    path.join(basePath, 'index.js')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function collectLocalModuleGraph(entryFile) {
  const visited = new Set();
  const queue = [entryFile];
  let directLocalImports = [];
  while (queue.length > 0) {
    const currentFile = queue.shift();
    if (!currentFile || visited.has(currentFile)) continue;
    visited.add(currentFile);
    const sourceText = fs.readFileSync(currentFile, 'utf8');
    const localChildren = extractModuleSpecifiers(sourceText)
      .map((specifier) => resolveLocalModulePath(currentFile, specifier))
      .filter(Boolean);
    if (currentFile === entryFile) {
      directLocalImports = Array.from(new Set(localChildren)).sort();
    }
    for (const child of localChildren) {
      if (!visited.has(child)) queue.push(child);
    }
  }
  return {
    directLocalImports,
    transitiveLocalModules: Array.from(visited)
      .filter((filePath) => filePath !== entryFile)
      .sort()
  };
}

function measureImportMs(entryFile) {
  const importScript = [
    "import { performance } from 'node:perf_hooks';",
    'const specifier = process.argv[1];',
    'const startedAt = performance.now();',
    'await import(specifier);',
    'process.stdout.write(String(performance.now() - startedAt));'
  ].join(' ');
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', importScript, pathToFileURL(entryFile).href],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, PAIROFCLEATS_TESTING: '1' }
    }
  );
  if (child.status !== 0) {
    throw new Error(
      `import measurement failed for ${entryFile}: ${child.stderr || child.stdout || child.error || 'unknown error'}`
    );
  }
  const importMs = Number(child.stdout);
  if (!Number.isFinite(importMs) || importMs < 0) {
    throw new Error(`invalid import measurement for ${entryFile}: ${child.stdout}`);
  }
  return importMs;
}

function measureCommand(command) {
  const startedAt = performance.now();
  const result = spawnSync(
    process.execPath,
    command.args,
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, PAIROFCLEATS_TESTING: '1' }
    }
  );
  return {
    id: command.id,
    args: command.args.slice(),
    wallMs: Number((performance.now() - startedAt).toFixed(3)),
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: typeof result.signal === 'string' ? result.signal : null
  };
}

function analyzeModule(entry) {
  const resolvedPath = path.resolve(ROOT, entry.path);
  const graph = collectLocalModuleGraph(resolvedPath);
  return {
    id: entry.id,
    path: normalizePath(path.relative(ROOT, resolvedPath)),
    directLocalImportCount: graph.directLocalImports.length,
    transitiveLocalModuleCount: graph.transitiveLocalModules.length,
    importMs: Number(measureImportMs(resolvedPath).toFixed(3))
  };
}

function readBaseline(baselinePath) {
  if (!fs.existsSync(baselinePath)) {
    throw new Error(`baseline file not found: ${baselinePath}`);
  }
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
}

function collectRegressions(modules, baseline) {
  const baselineModules = baseline?.modules || {};
  const regressions = [];
  for (const moduleMetrics of modules) {
    const expected = baselineModules[moduleMetrics.id];
    if (!expected) {
      regressions.push({
        id: moduleMetrics.id,
        reason: 'missing_baseline'
      });
      continue;
    }
    if (moduleMetrics.directLocalImportCount > Number(expected.maxDirectLocalImportCount)) {
      regressions.push({
        id: moduleMetrics.id,
        reason: 'direct_local_import_count',
        actual: moduleMetrics.directLocalImportCount,
        expected: expected.maxDirectLocalImportCount
      });
    }
    if (moduleMetrics.transitiveLocalModuleCount > Number(expected.maxTransitiveLocalModuleCount)) {
      regressions.push({
        id: moduleMetrics.id,
        reason: 'transitive_local_module_count',
        actual: moduleMetrics.transitiveLocalModuleCount,
        expected: expected.maxTransitiveLocalModuleCount
      });
    }
  }
  return regressions;
}

function renderText(report) {
  const lines = [
    `Shared-module performance snapshot (${report.generatedAt})`,
    `- baseline: ${report.baselinePath}`,
    '- modules:'
  ];
  for (const moduleMetrics of report.modules) {
    lines.push(
      `  - ${moduleMetrics.id}: direct=${moduleMetrics.directLocalImportCount} `
      + `transitive=${moduleMetrics.transitiveLocalModuleCount} importMs=${moduleMetrics.importMs}`
    );
  }
  lines.push('- commands:');
  for (const commandMetrics of report.commands) {
    lines.push(
      `  - ${commandMetrics.id}: wallMs=${commandMetrics.wallMs} `
      + `exit=${commandMetrics.exitCode ?? 'null'} signal=${commandMetrics.signal ?? 'none'}`
    );
  }
  if (report.regressions.length) {
    lines.push('- regressions:');
    for (const regression of report.regressions) {
      lines.push(
        `  - ${regression.id}: ${regression.reason} `
        + `(actual=${regression.actual ?? 'n/a'} expected=${regression.expected ?? 'n/a'})`
      );
    }
  }
  return lines.join('\n');
}

function main() {
  const baselinePath = path.resolve(argv.baseline || DEFAULT_BASELINE_PATH);
  const baseline = readBaseline(baselinePath);
  const modules = DEFAULT_MODULES.map(analyzeModule);
  const commands = DEFAULT_COMMANDS.map(measureCommand);
  const regressions = collectRegressions(modules, baseline);
  const report = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    baselinePath: normalizePath(path.relative(ROOT, baselinePath)),
    modules,
    commands,
    regressions
  };
  if (argv.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderText(report));
  }
  if (argv.check && regressions.length > 0) {
    process.exit(1);
  }
}

main();

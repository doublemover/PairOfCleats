#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';

const MODULE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json'];
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const SPECIFIER_PATTERNS = [
  /(?:import|export)\s[^'"`]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
];

const parseArgs = () => createCli({
  scriptName: 'pairofcleats shared-module-cycles',
  options: {
    root: { type: 'string' },
    json: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false }
  }
})
  .strictOptions()
  .parse();

const normalizeRel = (value) => String(value || '').replace(/\\/g, '/');

const listModuleFiles = async (root, roots) => {
  const files = [];
  const walk = async (relativeDir) => {
    const absoluteDir = path.join(root, relativeDir);
    let entries = [];
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = normalizeRel(path.posix.join(normalizeRel(relativeDir), entry.name));
      if (entry.isDirectory()) {
        await walk(relPath);
        continue;
      }
      if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(relPath);
      }
    }
  };

  for (const relativeRoot of roots) {
    await walk(relativeRoot);
  }

  return Array.from(new Set(files)).sort((a, b) => a.localeCompare(b));
};

const extractModuleSpecifiers = (contents) => {
  const specifiers = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    let match;
    while ((match = pattern.exec(contents)) !== null) {
      specifiers.add(String(match[1] || '').trim());
    }
  }
  return Array.from(specifiers);
};

const resolveImport = (importer, specifier, fileSet) => {
  if (!specifier || (!specifier.startsWith('.') && !specifier.startsWith('/'))) return null;
  const importerDir = path.posix.dirname(importer);
  const basePath = specifier.startsWith('/')
    ? specifier.slice(1)
    : path.posix.normalize(path.posix.join(importerDir, specifier));
  const candidates = [
    basePath,
    ...MODULE_EXTENSIONS.map((ext) => `${basePath}${ext}`),
    ...MODULE_EXTENSIONS.map((ext) => path.posix.join(basePath, `index${ext}`))
  ];
  return candidates.find((candidate) => fileSet.has(candidate)) || null;
};

const buildGraph = async (root, files) => {
  const fileSet = new Set(files);
  const graph = new Map(files.map((file) => [file, []]));

  for (const file of files) {
    const contents = await fs.readFile(path.join(root, file), 'utf8');
    const resolvedImports = [];
    for (const specifier of extractModuleSpecifiers(contents)) {
      const resolved = resolveImport(file, specifier, fileSet);
      if (resolved && graph.has(resolved)) resolvedImports.push(resolved);
    }
    graph.set(file, Array.from(new Set(resolvedImports)).sort((a, b) => a.localeCompare(b)));
  }

  return graph;
};

const canonicalizeCycle = (cycle) => {
  const body = cycle.slice(0, -1);
  const forward = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)].join(' -> '));
  const reverseBody = [...body].reverse();
  const reverse = reverseBody.map((_, index) => [...reverseBody.slice(index), ...reverseBody.slice(0, index)].join(' -> '));
  return [...forward, ...reverse].sort()[0];
};

const findCyclesInGraph = (graph) => {
  const temp = new Set();
  const perm = new Set();
  const stack = [];
  const rawCycles = [];

  const visit = (node) => {
    if (perm.has(node)) return;
    if (temp.has(node)) {
      const start = stack.indexOf(node);
      if (start >= 0) rawCycles.push([...stack.slice(start), node]);
      return;
    }
    temp.add(node);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      visit(next);
    }
    stack.pop();
    temp.delete(node);
    perm.add(node);
  };

  for (const node of graph.keys()) visit(node);

  const unique = [];
  const seen = new Set();
  for (const cycle of rawCycles) {
    const key = canonicalizeCycle(cycle);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      key,
      nodes: cycle.slice(0, -1),
      edgeCount: cycle.length - 1
    });
  }

  return unique.sort((a, b) => a.key.localeCompare(b.key));
};

export const findSharedModuleCycles = async ({
  root = process.cwd(),
  roots = ['src/shared', 'tools/shared']
} = {}) => {
  const resolvedRoot = path.resolve(root);
  const normalizedRoots = Array.from(new Set((Array.isArray(roots) ? roots : []).map(normalizeRel))).filter(Boolean);
  const files = await listModuleFiles(resolvedRoot, normalizedRoots);
  const graph = await buildGraph(resolvedRoot, files);
  const cycles = findCyclesInGraph(graph);
  return {
    root: normalizeRel(resolvedRoot),
    roots: normalizedRoots,
    fileCount: files.length,
    cycleCount: cycles.length,
    cycles
  };
};

const main = async () => {
  const argv = parseArgs();
  const report = await findSharedModuleCycles({
    root: argv.root || process.cwd()
  });
  if (argv.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.cycleCount === 0) {
    process.stdout.write(`shared-module-cycles ok: scanned ${report.fileCount} files across ${report.roots.join(', ')}\n`);
  } else {
    process.stdout.write(`shared-module-cycles found ${report.cycleCount} cycle(s)\n`);
    for (const cycle of report.cycles) {
      process.stdout.write(`- ${cycle.nodes.join(' -> ')} -> ${cycle.nodes[0]}\n`);
    }
  }
  if (argv.check && report.cycleCount > 0) {
    process.exit(1);
  }
};

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

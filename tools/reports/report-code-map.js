#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createCli } from '../../src/shared/cli.js';
import { toPosix } from '../../src/shared/files.js';
import { buildCodeMap, buildNodeList, buildMapCacheKey } from '../../src/map/build-map.js';
import { renderDot } from '../../src/map/dot-writer.js';
import { renderSvgHtml } from '../../src/map/html-writer.js';
import { renderIsometricHtml } from '../../src/map/isometric-viewer.js';
import { loadUserConfig, resolveRepoRoot, getIndexDir, getCurrentBuildInfo, getRepoId } from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'report map',
  options: {
    repo: { type: 'string', describe: 'Repo root.' },
    mode: { type: 'string', default: 'code' },
    'index-root': { type: 'string' },
    scope: { type: 'string', default: 'repo' },
    focus: { type: 'string' },
    include: { type: 'string' },
    'only-exported': { type: 'boolean', default: false },
    collapse: { type: 'string', default: 'none' },
    'max-files': { type: 'number' },
    'max-members-per-file': { type: 'number' },
    'max-edges': { type: 'number' },
    'top-k-by-degree': { type: 'boolean', default: false },
    format: { type: 'string', default: 'json' },
    out: { type: 'string' },
    'model-out': { type: 'string' },
    'node-list-out': { type: 'string' },
    json: { type: 'boolean', default: false },
    pretty: { type: 'boolean', default: false },
    'open-uri-template': { type: 'string' },
    'three-url': { type: 'string' },
    'wasd-sensitivity': { type: 'number' },
    'wasd-acceleration': { type: 'number' },
    'wasd-max-speed': { type: 'number' },
    'wasd-drag': { type: 'number' },
    'zoom-sensitivity': { type: 'number' },
    'cache-dir': { type: 'string' },
    refresh: { type: 'boolean', default: false }
  }
}).parse();

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const repoRoot = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(repoRoot);
const mode = String(argv.mode || 'code').toLowerCase();
const indexDir = getIndexDir(repoRoot, mode, userConfig, {
  indexRoot: argv['index-root'] ? path.resolve(argv['index-root']) : null
});

const scope = String(argv.scope || 'repo').toLowerCase();
const focus = argv.focus ? String(argv.focus) : '';
const formatRaw = String(argv.format || 'json').toLowerCase();
const format = formatRaw === 'iso' ? 'html-iso' : formatRaw;
const isIso = format === 'html-iso';
const isoDisplayLimits = { maxFiles: 60, maxMembersPerFile: 20, maxEdges: 400 };

const resolveLimit = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const resolvedMaxFiles = resolveLimit(argv['max-files'], undefined);
const resolvedMaxMembers = resolveLimit(argv['max-members-per-file'], undefined);
const resolvedMaxEdges = resolveLimit(argv['max-edges'], undefined);

const viewerControls = {
  wasd: {
    ...(Number.isFinite(argv['wasd-sensitivity']) ? { sensitivity: Number(argv['wasd-sensitivity']) } : {}),
    ...(Number.isFinite(argv['wasd-acceleration']) ? { acceleration: Number(argv['wasd-acceleration']) } : {}),
    ...(Number.isFinite(argv['wasd-max-speed']) ? { maxSpeed: Number(argv['wasd-max-speed']) } : {}),
    ...(Number.isFinite(argv['wasd-drag']) ? { drag: Number(argv['wasd-drag']) } : {})
  },
  ...(Number.isFinite(argv['zoom-sensitivity']) ? { zoomSensitivity: Number(argv['zoom-sensitivity']) } : {})
};

const buildOptions = {
  mode,
  scope,
  focus,
  include: argv.include,
  onlyExported: argv['only-exported'] === true,
  collapse: argv.collapse,
  maxFiles: resolvedMaxFiles,
  maxMembersPerFile: resolvedMaxMembers,
  maxEdges: resolvedMaxEdges,
  topKByDegree: argv['top-k-by-degree'] === true,
  viewer: {
    controls: viewerControls,
    openUriTemplate: argv['open-uri-template'] || null,
    ...(isIso
      ? {
        performance: {
          displayLimits: {
            maxFiles: resolvedMaxFiles ?? isoDisplayLimits.maxFiles,
            maxMembersPerFile: resolvedMaxMembers ?? isoDisplayLimits.maxMembersPerFile,
            maxEdges: resolvedMaxEdges ?? isoDisplayLimits.maxEdges
          }
        }
      }
      : {})
  }
};

const buildInfo = getCurrentBuildInfo(repoRoot, userConfig, { mode });
const cacheKey = buildMapCacheKey({ buildId: buildInfo?.buildId || null, options: buildOptions });
const cacheDir = argv['cache-dir']
  ? path.resolve(argv['cache-dir'])
  : path.join(repoRoot, '.pairofcleats', 'maps', 'cache');
const cachePath = path.join(cacheDir, `${cacheKey}.json`);

const ensureDir = (targetPath) => {
  if (!targetPath) return;
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
};

let mapModel = null;
const warnings = [];

if (!argv.refresh && fs.existsSync(cachePath)) {
  try {
    mapModel = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch (err) {
    warnings.push(`cache read failed: ${err?.message || err}`);
  }
}

if (!mapModel) {
  mapModel = await buildCodeMap({ repoRoot, indexDir, options: buildOptions });
  mapModel.root.id = getRepoId(repoRoot);
  try {
    ensureDir(cachePath);
    fs.writeFileSync(cachePath, JSON.stringify(mapModel, null, 2));
  } catch (err) {
    warnings.push(`cache write failed: ${err?.message || err}`);
  }
}

if (mapModel) {
  mapModel.root = mapModel.root || { path: repoRoot, id: null };
  mapModel.root.path = repoRoot;
  mapModel.root.id = mapModel.root.id || getRepoId(repoRoot);
  warnings.push(...(mapModel.warnings || []));
}

const modelOut = argv['model-out'] ? path.resolve(argv['model-out']) : null;
if (modelOut) {
  try {
    ensureDir(modelOut);
    fs.writeFileSync(modelOut, JSON.stringify(mapModel, null, 2));
  } catch (err) {
    warnings.push(`model output failed: ${err?.message || err}`);
  }
}

const nodeListOut = argv['node-list-out'] ? path.resolve(argv['node-list-out']) : null;
if (nodeListOut) {
  try {
    ensureDir(nodeListOut);
    const list = buildNodeList(mapModel);
    fs.writeFileSync(nodeListOut, JSON.stringify(list, null, 2));
  } catch (err) {
    warnings.push(`node list output failed: ${err?.message || err}`);
  }
}

const resolveThreeUrl = (targetPath) => {
  if (argv['three-url']) return argv['three-url'];
  const modulePath = path.join(repoRoot, 'node_modules', 'three', 'build', 'three.module.js');
  if (!fs.existsSync(modulePath)) return '';
  if (targetPath) {
    const rel = toPosix(path.relative(path.dirname(targetPath), modulePath));
    return rel.startsWith('.') ? rel : `./${rel}`;
  }
  return pathToFileURL(modulePath).href;
};

const formatOutputPath = (targetPath, fallbackExt) => {
  if (!targetPath) return null;
  if (!fallbackExt) return targetPath;
  const currentExt = path.extname(targetPath);
  if (currentExt.toLowerCase() === fallbackExt) return targetPath;
  return `${targetPath.slice(0, targetPath.length - currentExt.length)}${fallbackExt}`;
};

const renderSvg = (dot) => {
  const result = spawnSync('dot', ['-Tsvg'], {
    input: dot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    const message = result.stderr || result.stdout || 'Graphviz dot failed.';
    warnings.push(message.trim());
    return null;
  }
  return result.stdout;
};

let output = null;
let outputPath = argv.out ? path.resolve(argv.out) : null;
let resolvedFormat = format;

if (format === 'json') {
  output = JSON.stringify(mapModel, null, argv.pretty ? 2 : 0);
} else if (format === 'dot') {
  output = renderDot(mapModel);
} else if (format === 'svg' || format === 'html') {
  const dot = renderDot(mapModel);
  const svg = renderSvg(dot);
  if (!svg) {
    resolvedFormat = 'dot';
    output = dot;
    outputPath = formatOutputPath(outputPath, '.dot');
  } else if (format === 'svg') {
    output = svg;
  } else {
    output = renderSvgHtml({ svg, mapModel, title: 'Code Map' });
  }
} else if (format === 'html-iso') {
  const threeUrl = resolveThreeUrl(outputPath);
  if (!threeUrl) warnings.push('three.js module missing; install three or set --three-url');
  output = renderIsometricHtml({
    mapModel,
    threeUrl,
    openUriTemplate: argv['open-uri-template'] || mapModel.viewer?.openUriTemplate,
    viewerConfig: mapModel.viewer || {}
  });
} else {
  output = JSON.stringify(mapModel, null, argv.pretty ? 2 : 0);
  resolvedFormat = 'json';
}

if (outputPath) {
  try {
    ensureDir(outputPath);
    fs.writeFileSync(outputPath, output);
  } catch (err) {
    warnings.push(`output write failed: ${err?.message || err}`);
  }
}

const report = {
  ok: true,
  format: resolvedFormat,
  outPath: outputPath,
  modelPath: modelOut || null,
  nodeListPath: nodeListOut || null,
  cacheKey,
  summary: mapModel.summary || null,
  warnings: Array.from(new Set(warnings.filter(Boolean)))
};

if (argv.json) {
  console.log(JSON.stringify(report, null, argv.pretty ? 2 : 0));
  process.exit(0);
}

if (!outputPath) {
  if (resolvedFormat === 'json') {
    process.stdout.write(output);
  } else {
    process.stderr.write(output);
  }
} else if (!argv.json) {
  console.error(`Wrote ${resolvedFormat} map to ${outputPath}`);
}

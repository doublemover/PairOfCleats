#!/usr/bin/env node
import { MAP_REPORT_OPTIONS } from '../shared/operator-cli-options.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createCli } from '../../src/shared/cli.js';
import { toPosix } from '../../src/shared/file-paths.js';
import { writeJsonFileSyncResolved } from '../../src/shared/json-file.js';
import { createMapCacheEnvelope, generatedMapCacheIdentity, readMapCacheEnvelope } from '../../src/shared/generated-artifact.js';
import { buildCodeMap, buildNodeList, buildMapCacheKey } from '../../src/map/build-map.js';
import { renderDot } from '../../src/map/dot-writer.js';
import { renderSvgHtml } from '../../src/map/html-writer.js';
import { renderIsometricHtml } from '../../src/map/isometric-viewer.js';
import { MAP_BENCH_BUILD_OPTIONS, resolveLimit } from '../shared/map-build-options.js';
import { getIndexDir, getRepoCacheRoot, getRepoId, resolveRepoConfig, toRealPathSync } from '../shared/dict-utils.js';
import { readJsonFile } from '../../src/shared/artifact-io/json.js';
import { assertPiecesManifestFormat } from '../../src/shared/artifact-io/manifest-read.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { emitJson } from '../shared/cli-utils.js';
import { publishMapOutput } from './map-output-publication.js';
import { runMapPreview } from '../analysis/map-iso-preview.js';

const argv = createCli({
  scriptName: 'report map',
  options: MAP_REPORT_OPTIONS
}).parse();

if (argv.serve) {
  try { await runMapPreview(argv); }
  catch (error) { console.error(`Map preview failed: ${error.message}`); process.exitCode = 1; }
} else {
  if (argv.input) throw new Error('--input opens saved evidence with --serve. It is not an output or a live-index override.');
  const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
  const mode = String(argv.mode || 'code').toLowerCase();
  const indexDir = toRealPathSync(getIndexDir(repoRoot, mode, userConfig, {
    indexRoot: argv['index-root'] ? path.resolve(argv['index-root']) : null
  }));

  const scope = String(argv.scope || 'repo').toLowerCase();
  const focus = argv.focus ? String(argv.focus) : '';
  const formatRaw = String(argv.format || 'json').toLowerCase();
  const format = formatRaw === 'iso' ? 'html-iso' : formatRaw;
  const isIso = format === 'html-iso';
  const isoDisplayLimits = { maxFiles: 60, maxMembersPerFile: 20, maxEdges: 400 };

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

  // A selected index can be independent of the repository's current pointer.
  // Read the manifest before any cache lookup, including warm-cache admission.
  const readSelectedIdentity = () => {
    const raw = readJsonFile(path.join(indexDir, 'pieces/manifest.json'));
    assertPiecesManifestFormat(indexDir, raw?.fields || raw, repoRoot);
    return { indexDir, manifest: createHash('sha256').update(stableStringify(raw)).digest('hex') };
  };
  const indexIdentity = readSelectedIdentity();
  const cacheKey = buildMapCacheKey({ indexIdentity, options: buildOptions });
  const cacheDir = argv['cache-dir']
    ? path.resolve(argv['cache-dir'])
    : path.join(getRepoCacheRoot(repoRoot, userConfig), 'maps', 'cache');
  const cacheIdentity = generatedMapCacheIdentity(cacheKey);
  const cachePath = path.join(cacheDir, cacheIdentity.fileName);

  let mapModel = null;
  const warnings = [];
  const outputs = [];

  if (!argv.refresh && fs.existsSync(cachePath)) {
    try {
      mapModel = readMapCacheEnvelope(JSON.parse(fs.readFileSync(cachePath, 'utf8')), cacheIdentity.key);
    } catch (err) {
      warnings.push(`cache read failed: ${err?.message || err}`);
    }
  }

  const cacheMiss = !mapModel;
  if (cacheMiss) {
    mapModel = await buildCodeMap({ repoRoot, indexDir, options: buildOptions });
    mapModel.root.id = getRepoId(repoRoot);
  }
  if (readSelectedIdentity().manifest !== indexIdentity.manifest) {
    throw new Error('Selected index generation changed while reading the map. Run the report again against a stable generation.');
  }
  if (cacheMiss) {
    try {
      writeJsonFileSyncResolved(cachePath, createMapCacheEnvelope(mapModel, cacheIdentity.key), { spaces: 0 });
    } catch (err) {
      warnings.push(`cache write failed: ${err?.message || err}`);
    }
  }

  if (mapModel) {
    mapModel.root = mapModel.root || { path: repoRoot, id: null };
    mapModel.root.path = repoRoot;
    mapModel.root.id = mapModel.root.id || getRepoId(repoRoot);
    warnings.push(...(mapModel.warnings || []));
    mapModel.provenance = {
      ...(mapModel.provenance || {}),
      kind: 'live-index-export',
      selectedIndex: { mode, indexDir, manifest: indexIdentity.manifest },
      exportedAt: new Date().toISOString()
    };
  }

  const modelOut = argv['model-out'] ? path.resolve(argv['model-out']) : null;
  if (modelOut) {
    outputs.push(await publishMapOutput({ kind: 'model', target: modelOut, content: JSON.stringify(mapModel, null, 2) }));
  }

  const nodeListOut = argv['node-list-out'] ? path.resolve(argv['node-list-out']) : null;
  if (nodeListOut) {
    outputs.push(await publishMapOutput({ kind: 'node-list', target: nodeListOut, content: JSON.stringify(buildNodeList(mapModel), null, 2) }));
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
  let formatUnavailable = false;

  if (format === 'json') {
    output = JSON.stringify(mapModel, null, argv.pretty ? 2 : 0);
  } else if (format === 'dot') {
    output = renderDot(mapModel);
  } else if (format === 'svg' || format === 'html') {
    const dot = renderDot(mapModel);
    const svg = renderSvg(dot);
    if (!svg) {
      formatUnavailable = true;
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
    outputs.push(await publishMapOutput({ kind: 'report', target: outputPath, content: output }));
  }

  const report = {
    ok: !formatUnavailable && outputs.every(entry => entry.ok),
    partial: outputs.some(entry => entry.ok) && (formatUnavailable || outputs.some(entry => !entry.ok)),
    requestedFormat:format,
    ...(formatUnavailable?{error:{code:'ERR_MAP_RENDER_FORMAT_UNAVAILABLE',message:`Requested ${format} rendering failed. Any emitted DOT is recovery input; request --format dot explicitly to export DOT successfully.`}}:{}),
    format: resolvedFormat,
    outPath: outputPath,
    modelPath: modelOut || null,
    nodeListPath: nodeListOut || null,
    cacheKey,
    summary: mapModel.summary || null,
    identity: { repo: mapModel.root, selectedIndex: mapModel.provenance.selectedIndex, producer: mapModel.version, options: mapModel.options },
    outputs,
    warnings: Array.from(new Set(warnings.filter(Boolean)))
  };

  if (argv.json) {
    emitJson(report, process.stdout, { spaces: argv.pretty ? 2 : 0 });
    process.exitCode = report.ok ? 0 : 1;
  } else if (!outputPath) {
    if (resolvedFormat === 'json') {
      process.stdout.write(output);
    } else {
      process.stderr.write(output);
    }
  } else if (outputs.find(entry => entry.kind === 'report')?.ok) {
    console.error(`Wrote ${resolvedFormat} map to ${outputPath}`);
  }
  if (!report.ok && !argv.json) {
    if(report.error)console.error(report.error.message);
    for (const entry of outputs.filter(item => !item.ok)) console.error(`Failed ${entry.kind} output ${entry.path}: ${entry.error.code}: ${entry.error.message}`);
    process.exitCode = 1;
  }
}

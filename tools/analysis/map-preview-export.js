import path from 'node:path';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';
import { readSavedMap } from './map-saved-input.js';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const samePath = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string' || !path.isAbsolute(left) || !path.isAbsolute(right)) return false;
  const a = path.resolve(left), b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
};
const fail = message => Object.assign(new Error(message), { code: 'ERR_MAP_PREVIEW_EXPORT_IDENTITY' });
export const captureMapPreviewGraphSelection = argv => {
  const capabilityId = argv['graph-capability'];
  if (capabilityId === null || capabilityId === undefined) return null;
  if (!hash(capabilityId) || typeof argv['index-root'] !== 'string' || !argv['index-root'].length
    || (argv.mode !== undefined && (typeof argv.mode !== 'string' || argv.mode.toLowerCase() !== 'code')) || argv.input) {
    throw fail('--graph-capability requires an exact validated id, explicit retained --index-root, code mode and no saved --input.');
  }
  return Object.freeze({ capabilityId, indexRoot: path.resolve(argv['index-root']) });
};
const graphIdentity = (selected, selection) => {
  const graph = selected?.graphCapability;
  if (!graph || graph.capability !== 'graph' || graph.status !== 'ready' || graph.capabilityId !== selection.capabilityId
    || typeof graph.buildId !== 'string' || !graph.buildId.length || !samePath(graph.sourceBuildRoot, selection.indexRoot)
    || typeof graph.indexRoot !== 'string' || !path.isAbsolute(graph.indexRoot)
    || samePath(graph.indexRoot, graph.sourceBuildRoot) || !samePath(selected.indexDir, path.join(graph.indexRoot, 'index-code'))) {
    throw fail('Map preview export did not confirm the exact retained graph capability and immutable consumer directory.');
  }
  return { capabilityId: graph.capabilityId, buildId: graph.buildId, sourceBuildRoot: graph.sourceBuildRoot,
    indexRoot: graph.indexRoot, status: graph.status, capability: graph.capability };
};

/** The canonical report child owns withBuildGraphCapability through actual map
 * read/render/publication. Admit only its exact completed pinned output here. */
export const prepareMapPreviewExport = async ({ argv, toolRoot, repoRoot, repoId, runtimeEnv, outPath, signal = null,
  spawnImpl = spawnSubprocess, readInput = readSavedMap }) => {
  const selection = captureMapPreviewGraphSelection(argv), mode = (argv.mode || 'code').toLowerCase();
  signal?.throwIfAborted();
  const args = [path.join(toolRoot, 'tools/reports/report-code-map.js'), '--repo', repoRoot,
    '--format', 'html-iso', '--out', outPath, '--three-url', '/three/three.module.js', '--json'];
  for (const key of ['mode', 'index-root', 'graph-capability', 'scope', 'focus', 'include', 'collapse', 'max-files', 'max-members-per-file', 'max-edges',
    'top-k-by-degree', 'only-exported', 'refresh', 'cache-dir', 'open-uri-template']) {
    const value = key === 'index-root' && selection ? selection.indexRoot : argv[key];
    if (value == null || value === false) continue;
    if (value === true) args.push(`--${key}`);
    else if (Array.isArray(value)) for (const item of value) args.push(`--${key}`, String(item));
    else args.push(`--${key}`, String(value));
  }
  const result = await spawnImpl(process.execPath, args, { cwd: toolRoot, env: runtimeEnv, signal,
    outputMode: 'string', maxOutputBytes: 1024 * 1024, rejectOnNonZeroExit: false });
  signal?.throwIfAborted();
  let receipt;
  try { receipt = JSON.parse(result.stdout); } catch { throw fail('Map export produced no readable success receipt. Validate the selected existing generation before retrying.'); }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw fail('Map export produced no canonical report receipt.');
  const output = Array.isArray(receipt.outputs) ? receipt.outputs.find(entry => entry?.kind === 'report') : null;
  if (result.exitCode !== 0 || result.cancelled === true || receipt.ok !== true || receipt.partial === true
    || receipt.requestedFormat !== 'html-iso' || receipt.format !== 'html-iso' || output?.ok !== true || output.path !== outPath
    || !hash(output.sha256) || !Number.isSafeInteger(output.bytes) || output.bytes < 1) {
    throw fail('Map export did not complete the requested HTML publication. The previous selected evidence remains unchanged.');
  }
  const input = await readInput(outPath, { signal });
  signal?.throwIfAborted();
  if (input.sha256 !== output.sha256 || input.bytes !== output.bytes) throw fail('Map output changed after publication; preview admission refused. Retry with a separate --out destination.');
  const identity = receipt.identity, recorded = input.model.provenance?.selectedIndex, selected = identity?.selectedIndex;
  if (!identity || identity.producer !== input.model.version || !samePath(identity.repo?.path, repoRoot)
    || !samePath(input.model.root.path, repoRoot) || identity.repo.id !== repoId || input.model.root.id !== repoId
    || selected?.mode !== mode || recorded?.mode !== mode || !hash(selected.manifest) || selected.manifest !== recorded.manifest
    || !samePath(selected.indexDir, recorded.indexDir) || JSON.stringify(identity.options) !== JSON.stringify(input.model.options)) {
    throw fail('Map preview receipt and published payload disagree about the selected repository, generation, producer or options.');
  }
  if (selection) {
    const exported = graphIdentity(selected, selection), embedded = graphIdentity(recorded, selection);
    if (JSON.stringify(exported) !== JSON.stringify(embedded) || input.model.provenance?.kind !== 'retained-graph-capability-export') {
      throw fail('Map preview graph capability differs between the report receipt and committed payload.');
    }
  } else if (selected.graphCapability || recorded.graphCapability) throw fail('An unrequested graph capability cannot replace the selected live-index export.');
  return { input, identity: { kind: selection ? 'retained-graph-capability-export' : 'live-index-export', ...identity, cacheKey: receipt.cacheKey } };
};

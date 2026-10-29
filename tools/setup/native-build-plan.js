import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

// Reviewed package-local GYP graphs. These graphs compile only package-owned
// sources, with read-only node-addon-api settings and no actions/copies/rules.
// A changed version, lifecycle hook, graph or helper selects serial npm instead.
const ADAPTERS = Object.freeze({
  'tree-sitter': ['0.25.1', '1abd3a059cdb61ef7b289c74795ab1ead55a0ad4e9ca45529c8a4bd91f66245b', true],
  'tree-sitter-javascript': ['0.25.0', '2539a994c9db570ee29805282e35452ff20ba72188d8caf99c502229b33dfca6'],
  'tree-sitter-typescript': ['0.23.2', '5451214724030d5150581c5af614d2d37c10379d9801c1170035f9777058b9e1'],
  'tree-sitter-python': ['0.25.0', 'e1aba9f4d6fcfa13948e7c8002164e87710b3f1c18635803b7c92840ba00dc4a'],
  'tree-sitter-c': ['0.24.1', '03625fee424de46e3e6c9da1d2eb0ea7a454c0133f4d1cac27f2a2ee8567be2a'],
  'tree-sitter-cpp': ['0.23.4', 'e8c7ca4208ca882655c21a99b6ef0d153634eabb1cd901a45914a121b023555c'],
  '@ganezdragon/tree-sitter-perl': ['1.1.1', '78e2fdcf73cb24ee4f4c3fa7143888b0e5d571c03e2b2844ec16c597c29155dd', true],
  'tree-sitter-swift': ['0.7.1', '3d2e7ab46e949ddea67945be3c2983693fa49bec1e14753f4f90dd6ae0a523cf', true]
});
const digest = value => createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const READ_ONLY_HELPERS = {
  'node-gyp-build': {
    'build-test.js': '34c19ff8b6675d6d27c63a7df44d77a442805eeea8756d1c89e0264f4a3028f6',
    'index.js': 'a7ed0d5ae218a19bdbdf15a590d0893790ddf536313b66a787554693cfaae078',
    'node-gyp-build.js': '134f0585f7c665db89f332a379158c6f113274422e42aaf54e0aa9d5ac37f577'
  },
  'node-addon-api': {
    'index.js': 'afbfa96b5c40c643828f212610129d2911095eff1e86e63ccfe81658d6fe61d9',
    'node_addon_api.gyp': '6d34b9bae562103233f650d8a041edc0ca6b44d90898cd232b38745adfb7edfc',
    'except.gypi': 'ddbc09f5b66fe24dd898fbe659085a6ff72e9575025004fc3762271dba781e8b',
    'noexcept.gypi': '0e815179b5d2697e0acdc8f3c3a5d0a1ed050d48a295ee000454cf5352357f66'
  }
};

export const inspectNativeBuildAdapter = (root, packageName) => {
  const spec = ADAPTERS[packageName];
  if (!spec) return null;
  try {
    const packageRoot = path.join(root, 'node_modules', ...packageName.split('/'));
    const manifest = readJson(path.join(packageRoot, 'package.json'));
    if (manifest.name !== packageName || manifest.version !== spec[0]
      || manifest.scripts?.install !== 'node-gyp-build'
      || ['preinstall', 'postinstall', 'prepare', 'preprepare', 'postprepare']
        .some(key => manifest.scripts?.[key])
      || manifest.prebuild?.test) return null;
    if (digest(fs.readFileSync(path.join(packageRoot, 'binding.gyp'))) !== spec[1]) return null;
    const require = createRequire(path.join(packageRoot, 'package.json'));
    const buildRoot = path.dirname(require.resolve('node-gyp-build/package.json'));
    if (readJson(path.join(buildRoot, 'package.json')).version !== '4.8.4') return null;
    const addonRoot = path.dirname(require.resolve('node-addon-api/package.json'));
    for (const [helper, directory] of [['node-gyp-build', buildRoot], ['node-addon-api', addonRoot]]) {
      for (const [file, expected] of Object.entries(READ_ONLY_HELPERS[helper])) {
        if (digest(fs.readFileSync(path.join(directory, file))) !== expected) return null;
      }
    }
    const nodeGypManifest = require.resolve('node-gyp/package.json');
    const nodeGypPackage = readJson(nodeGypManifest);
    const nodeGyp = path.resolve(path.dirname(nodeGypManifest), typeof nodeGypPackage.bin === 'string'
      ? nodeGypPackage.bin : nodeGypPackage.bin['node-gyp']);
    return { packageName, packageRoot, version: manifest.version, forceSource: spec[2] === true,
      nodeGyp, prebuildTest: path.join(buildRoot, 'build-test.js'),
      inputs: ['package.json', 'binding.gyp', 'bindings/node', 'src', 'typescript/src', 'tsx/src',
        'vendor/tree-sitter', 'node-addon-api', 'Node headers'],
      outputs: [path.join(packageRoot, 'build')], writes: 'package-local-build-directory' };
  } catch { return null; }
};

/** Root npm owners never overlap: each fallback depends on the previous one
 * and every local task has settled before the first fallback can mutate npm. */
export const createNativeBuildTasks = ({ packages, adapters, budget, prepareHeaders,
  buildLocal, buildFallback }) => {
  const local = packages.filter(entry => adapters.has(entry.packageName));
  const tasks = local.length ? [{ id: 'native:headers', exclusive: true, run: prepareHeaders }] : [];
  const runtime = local.find(entry => entry.packageName === 'tree-sitter');
  for (const entry of local) {
    const adapter = adapters.get(entry.packageName);
    tasks.push({ id: entry.packageName, required: entry.required,
      dependsOn: ['native:headers', ...(runtime && entry !== runtime ? ['tree-sitter'] : [])],
      cpu: budget.compilerJobs, bytes: 256 * 1024 * 1024 * budget.compilerJobs,
      run: context => buildLocal(adapter, context) });
  }
  let previous = null;
  for (const entry of packages.filter(item => !adapters.has(item.packageName))) {
    tasks.push({ id: entry.packageName, required: entry.required, exclusive: true,
      dependsOn: previous ? [{ id: previous, settled: true }]
        : local.map(item => ({ id: item.packageName, settled: true })),
      run: context => buildFallback(entry, context) });
    previous = entry.packageName;
  }
  return tasks;
};

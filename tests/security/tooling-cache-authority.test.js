import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

// Exercise the real config loader and TypeScript provider without executing any
// repository commands or touching files outside this newly allocated fixture.
const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-cache-authority-')));
const repo = path.join(tmp, 'repo');
const sibling = path.join(tmp, 'unrelated');
const savedCommands = new Map();
let commandAttempts = 0;
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  savedCommands.set(name, childProcess[name]);
  childProcess[name] = () => { commandAttempts += 1; throw new Error('Fixture subprocesses disabled.'); };
}
syncBuiltinESMExports();
const envNames = ['PAIROFCLEATS_TRUSTED_REPOS', 'PAIROFCLEATS_TRUSTED_CONFIG', 'PAIROFCLEATS_TESTING'];
const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
process.env.PAIROFCLEATS_TRUSTED_REPOS = '[]';
delete process.env.PAIROFCLEATS_TRUSTED_CONFIG;
process.env.PAIROFCLEATS_TESTING = '0';

try {
  const { loadUserConfig } = await import('../../tools/dict-utils/config.js');
  const { getToolingConfig } = await import('../../tools/dict-utils/paths/cache.js');
  const { isRepoTrusted } = await import('../../src/shared/config-authority.js');
  const { runToolingPass } = await import('../../src/index/type-inference-crossfile/tooling.js');
  const { registerDefaultToolingProviders } = await import('../../src/index/tooling/providers/index.js');
  const { TOOLING_PROVIDERS } = await import('../../src/index/tooling/provider-registry.js');
  await fs.mkdir(path.join(repo, 'src'), { recursive: true });
  await fs.mkdir(sibling);
  const sentinels = ['unrelated-a.json', 'unrelated-b.json', 'unrelated-c.json', 'unrelated.txt'];
  const snapshot = {};
  for (const name of sentinels) {
    snapshot[name] = JSON.stringify({ fixtureOnly: true, name });
    await fs.writeFile(path.join(sibling, name), snapshot[name]);
    await fs.utimes(path.join(sibling, name), new Date('2000-01-01'), new Date('2000-01-01'));
  }
  const configPath = path.join(repo, '.pairofcleats.json');
  const writeConfig = async (dir) => fs.writeFile(configPath, JSON.stringify({
    tooling: { enabledTools: ['typescript'], typescript: { enabled: true }, cache: { enabled: true, dir, maxEntries: 1 } }
  }));
  const text = 'export function sum(a: number, b: number) { return a + b; }\n';
  await fs.writeFile(path.join(repo, 'src/sample.ts'), text);
  const run = async (toolingConfig, buildRoot = repo) => {
    const chunk = {
      file: 'src/sample.ts', name: 'sum', kind: 'function', lang: 'typescript', ext: '.ts',
      chunkUid: 'fixture-cache-authority', start: 0, end: text.trimEnd().length,
      docmeta: {}, metaV2: { symbol: { qualifiedName: 'sum' } }
    };
    return runToolingPass({
      rootDir: repo, buildRoot, chunks: [chunk],
      entryByUid: new Map([[chunk.chunkUid, { name: 'sum', file: chunk.file, kind: 'function',
        chunkUid: chunk.chunkUid, qualifiedName: 'sum', paramTypes: {} }]]),
      log: () => {}, toolingConfig, toolingTimeoutMs: 3000, toolingRetries: 0,
      toolingBreaker: 1, fileTextByFile: new Map([[chunk.file, text]])
    });
  };
  const assertSentinels = async () => {
    for (const [name, expected] of Object.entries(snapshot)) {
      assert.equal(await fs.readFile(path.join(sibling, name), 'utf8'), expected);
    }
  };
  registerDefaultToolingProviders();
  const provider = TOOLING_PROVIDERS.get('typescript');
  const originalRun = provider.run;
  let liveRuns = 0;
  provider.run = async (...args) => { liveRuns += 1; return originalRun.apply(provider, args); };

  for (const dir of [sibling, '../unrelated']) {
    await writeConfig(dir);
    const config = loadUserConfig(repo);
    assert.equal(config.tooling.cache.dir, undefined, 'untrusted repo cannot select storage');
    assert.equal(config.tooling.cache.maxEntries, 1, 'limits remain usable inside owned storage');
    const tooling = getToolingConfig(repo, config);
    assert.equal(tooling.cache.dir, '');
    const result = await run(tooling);
    assert.equal(result.toolingProvidersExecuted, 1);
    assert.equal(result.toolingProvidersContributed, 1, 'real TypeScript output contributes types');
    await assertSentinels();
    assert.deepEqual((await fs.readdir(sibling)).sort(), sentinels.slice().sort(), 'no redirected writes');
    assert.equal(isRepoTrusted(repo), false);
  }
  assert.equal(liveRuns, 1, 'ordinary default cache is reused');

  // An owner-selected custom cache can coexist with unrelated JSON. Only owned
  // format/key pairs are eligible for pruning; changing generations prunes them.
  const policy = path.join(tmp, 'owner-policy.json');
  await fs.writeFile(policy, JSON.stringify({ tooling: { cache: { dir: sibling } } }));
  process.env.PAIROFCLEATS_TRUSTED_CONFIG = policy;
  const tooling = getToolingConfig(repo, loadUserConfig(repo));
  assert.equal(tooling.cache.dir, sibling);
  await run(tooling, path.join(repo, 'build-a'));
  const firstCache = (await fs.readdir(sibling)).find((name) => !sentinels.includes(name));
  assert.ok(firstCache, 'trusted custom cache writes normally');
  await fs.utimes(path.join(sibling, firstCache), new Date('2001-01-01'), new Date('2001-01-01'));
  // A generated-looking filename with unowned content and a misplaced ownership
  // envelope are both unrelated files and must survive pruning.
  snapshot['fixture-tooling-provider_lk3_0000000000000000000000000000000000000000.json'] = '{}';
  snapshot['misnamed.json'] = await fs.readFile(path.join(sibling, firstCache), 'utf8');
  for (const name of Object.keys(snapshot).filter((name) => !sentinels.includes(name))) {
    await fs.writeFile(path.join(sibling, name), snapshot[name]);
  }
  await run(tooling, path.join(repo, 'build-b'));
  await assertSentinels();
  assert.equal(await fs.stat(path.join(sibling, firstCache)).then(() => true, () => false), false, 'owned old entry pruned');
  const filesAfterPrune = await fs.readdir(sibling);
  assert.equal(filesAfterPrune.filter((name) => !(name in snapshot)).length, 1);
  const runsBeforeHit = liveRuns;
  await run(tooling, path.join(repo, 'build-b'));
  assert.equal(liveRuns, runsBeforeHit, 'trusted custom cache reused');
  await run({ ...tooling, cache: { ...tooling.cache, maxBytes: 1 } }, path.join(repo, 'build-b'));
  await assertSentinels();
  assert.deepEqual((await fs.readdir(sibling)).sort(), Object.keys(snapshot).sort(), 'byte pruning removes only owned entries');

  await run(tooling, path.join(repo, 'build-collision'));
  const collisionName = (await fs.readdir(sibling)).find((name) => !(name in snapshot));
  assert.ok(collisionName);
  snapshot[collisionName] = '{"unrelatedReplacement":true}';
  await fs.writeFile(path.join(sibling, collisionName), snapshot[collisionName]);
  await run(tooling, path.join(repo, 'build-collision'));
  await assertSentinels();

  delete process.env.PAIROFCLEATS_TRUSTED_CONFIG;
  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([repo]);
  assert.equal(loadUserConfig(repo).tooling.cache.dir, '../unrelated', 'owner trust retains custom configuration');
  process.env.PAIROFCLEATS_TRUSTED_REPOS = '[]';

  // POSIX symlinks and Windows junctions must be checked before mkdir, writes,
  // diagnostic snapshots or pruning, including when descendants do not exist.
  await fs.rm(path.join(repo, '.build'), { recursive: true, force: true });
  await fs.symlink(sibling, path.join(repo, '.build'), process.platform === 'win32' ? 'junction' : 'dir');
  await run(getToolingConfig(repo, loadUserConfig(repo)));
  await assertSentinels();
  assert.deepEqual((await fs.readdir(sibling)).sort(), Object.keys(snapshot).sort());

  const customLink = path.join(tmp, 'custom-cache-link');
  await fs.symlink(sibling, customLink, process.platform === 'win32' ? 'junction' : 'dir');
  await fs.writeFile(policy, JSON.stringify({ tooling: { cache: { dir: customLink } } }));
  process.env.PAIROFCLEATS_TRUSTED_CONFIG = policy;
  await run(getToolingConfig(repo, loadUserConfig(repo)));
  await assertSentinels();
  assert.deepEqual((await fs.readdir(sibling)).sort(), Object.keys(snapshot).sort());
  const { ensureSourcekitPackageResolutionPreflight } = await import('../../src/index/tooling/preflight/sourcekit-package-resolution.js');
  await fs.mkdir(path.join(repo, 'Package.swift'));
  const sourcekit = await ensureSourcekitPackageResolutionPreflight({ repoRoot: repo, cacheRoot: customLink, log: () => {} });
  assert.equal(sourcekit.state, 'blocked');
  await assertSentinels();
  assert.deepEqual((await fs.readdir(sibling)).sort(), Object.keys(snapshot).sort(), 'SourceKit marker cannot follow cache-root link');
  assert.equal(commandAttempts, 0);
  console.log('tooling cache authority: untrusted redirects, trusted ownership, reuse/pruning and link boundaries passed');
} finally {
  for (const [name, fn] of savedCommands) childProcess[name] = fn;
  syncBuiltinESMExports();
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await fs.rm(tmp, { recursive: true, force: true });
}

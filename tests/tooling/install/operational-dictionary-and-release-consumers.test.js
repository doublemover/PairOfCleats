#!/usr/bin/env node
// Authored actual-consumer fixture; trusted explicit adapters stand in for
// operational executables. No package, SDK, SBOM producer or native tool runs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const { dir: root } = await prepareTestCacheDir('operational-dictionary-release');
const repo = path.join(root, 'repo'), preload = path.join(root, 'preload.mjs'), trace = path.join(root, 'trace.jsonl');
await fs.mkdir(repo, { recursive: true });
await fs.writeFile(path.join(repo, 'probe.js'), 'function sentinelWord() { return sentinelWord; }\n');
const bom = { bomFormat: 'CycloneDX', specVersion: '1.5', components: [] };
const adapter = `import fs from 'node:fs/promises'; import path from 'node:path';
  export async function runOperationalCommand(input) {
    if (input.id !== 'ripgrep') throw new Error('Only the trusted ripgrep fixture is selected');
    await fs.appendFile(${JSON.stringify(trace)}, JSON.stringify({ id: input.id, args: input.args })+'\\n');
    return { exitCode: 0, stdout: 'probe.js\\n' };
  }
  export async function withOperationalTool(id, selection, execute) {
    if (!['npm-sbom','cargo-cyclonedx'].includes(id)) throw new Error('Only trusted SBOM fixtures are selected');
    return execute({ command: 'explicit-trusted-'+id+'-fixture', run: async (args, options) => {
      await fs.appendFile(${JSON.stringify(trace)}, JSON.stringify({ id, args, cwd: options.cwd })+'\\n');
      if (id === 'cargo-cyclonedx') {
        if (!args.includes('--override-filename') || args.includes('--output-prefix')) throw new Error('Selected pinned cargo-cyclonedx argv required');
        await fs.writeFile(path.join(options.cwd, 'sbom-tui.cdx.json'), ${JSON.stringify(JSON.stringify(bom))});
      }
      return { exitCode: 0, stdout: ${JSON.stringify(JSON.stringify(bom))} };
    } });
  }`;
await fs.writeFile(preload, `import { registerHooks } from 'node:module'; registerHooks({ load(url, context, next) {
  if (!url.endsWith('/tools/tooling/operational-execution.js')) return next(url, context);
  return { format: 'module', shortCircuit: true, source: ${JSON.stringify(adapter)} }; } });`);
const env = applyTestEnv({ syncProcess: false, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_HOME: path.join(root, 'home'),
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(preload).href}`.trim() } });
try {
  const dictionary = path.join(root, 'dictionary.txt');
  const generated = runNode(['tools/dicts/generate-repo-dict.js', '--repo', repo, '--min-count', '1', '--out', dictionary],
    'dictionary uses selected trusted ripgrep', process.cwd(), env, { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
  assert.equal(generated.status, 0, generated.stderr);
  assert.ok((await fs.readFile(dictionary, 'utf8')).includes('sentinelword'));
  assert.deepEqual(JSON.parse((await fs.readFile(trace, 'utf8')).trim()), { id: 'ripgrep', args: ['--files'] });
  await fs.rm(trace);
  const bundle = path.join(root, 'bundle'), out = path.join(root, 'trust'), manifest = path.join(root, 'Cargo.toml');
  await fs.mkdir(bundle);
  await fs.writeFile(manifest, '[package]\nname="fixture"\nversion="0.0.0"\n');
  const artifact = { path: 'fixture.zip', sizeBytes: 1, sha256: 'a'.repeat(64) };
  await fs.writeFile(path.join(bundle, 'release-artifacts.json'), JSON.stringify({ schemaVersion: 1, artifacts: [artifact] }));
  await fs.writeFile(path.join(bundle, 'release-checksums.txt'), artifact.sha256 + '  ' + artifact.path + '\n');
  const released = runNode(['tools/release/generate-trust-materials.js', '--bundle-dir', bundle, '--out-dir', out,
    '--cargo-manifest-path', manifest], 'release binds trusted selected SBOM producers', process.cwd(), env,
  { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
  assert.equal(released.status, 0, released.stderr);
  assert.equal(JSON.parse(released.stdout).ok, true);
  const invocations = (await fs.readFile(trace, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(invocations.map(entry => entry.id), ['npm-sbom', 'cargo-cyclonedx']);
  assert.ok(invocations[0].args.includes('--package-lock-only'));
  assert.ok(invocations[1].args.includes('--override-filename'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(out, 'node-root.cyclonedx.json'), 'utf8')), bom);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(out, 'tui.cyclonedx.json'), 'utf8')), bom);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Dictionary and release consumers use canonical selected operational commands and retain their existing output contracts.');

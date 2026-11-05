#!/usr/bin/env node
// Authored actual-consumer fixture; trusted explicit adapters stand in for
// operational executables. No package, SDK, SBOM producer or native tool runs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { observeReleaseSource, SBOM_SOURCE_PROPERTY } from '../../../tools/release/source-revision.js';

const { dir: root } = await prepareIsolatedTestCacheDir('operational-dictionary-release');
const repo = path.join(root, 'repo'), preload = path.join(root, 'preload.mjs'), trace = path.join(root, 'trace.jsonl');
await fs.mkdir(repo, { recursive: true });
await fs.writeFile(path.join(repo, 'probe.js'), 'function sentinelWord() { return sentinelWord; }\n');
await fs.writeFile(path.join(repo, ' leading source.js'), 'const whitespaceSentinel = 1;\n');
const fixtureFiles = ['probe.js', ' leading source.js'];
if (process.platform !== 'win32') {
  fixtureFiles.push('literal\\name.js', 'line\nname.js');
  await fs.writeFile(path.join(repo, fixtureFiles[2]), 'const backslashSentinel = 1;\n');
  await fs.writeFile(path.join(repo, fixtureFiles[3]), 'const newlineSentinel = 1;\n');
}
const bom = { bomFormat: 'CycloneDX', specVersion: '1.5', components: [] };
const adapter = `import fs from 'node:fs/promises'; import path from 'node:path';
  export async function runOperationalCommand(input) {
    if (input.id !== 'ripgrep') throw new Error('Only the trusted ripgrep fixture is selected');
    await fs.appendFile(${JSON.stringify(trace)}, JSON.stringify({ id: input.id, args: input.args })+'\\n');
    if (process.env.DICTIONARY_FIXTURE_MODE === 'unavailable') throw Object.assign(new Error('explicit unavailable ripgrep fixture'), { code: 'ERR_OPERATIONAL_TOOL_UNAVAILABLE' });
    if (process.env.DICTIONARY_FIXTURE_MODE === 'failure') throw Object.assign(new Error('original selected tool failure'), { code: 'ERR_OPERATIONAL_TOOL_CHANGED' });
    if (process.env.DICTIONARY_FIXTURE_MODE === 'nonzero') return { exitCode: 2, stdout: '', stderr: 'original selected failure' };
    if (process.env.DICTIONARY_FIXTURE_MODE === 'empty') return { exitCode: 0, stdout: '' };
    if (process.env.DICTIONARY_FIXTURE_MODE === 'unterminated') return { exitCode: 0, stdout: 'probe.js' };
    if (process.env.DICTIONARY_FIXTURE_MODE === 'outside') return { exitCode: 0, stdout: '../outside.js\\0' };
    return { exitCode: 0, stdout: input.args.includes('--null')
      ? ${JSON.stringify(fixtureFiles.join('\0') + '\0')}
      : ${JSON.stringify(fixtureFiles.join('\n') + '\n')} };
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
  const expectedDictionary = await fs.readFile(dictionary, 'utf8');
  assert.ok(expectedDictionary.includes('whitespacesentinel'), 'NUL inventory preserves leading filename whitespace');
  if (process.platform !== 'win32') {
    assert.ok(expectedDictionary.includes('backslashsentinel'));
    assert.ok(expectedDictionary.includes('newlinesentinel'));
  }
  assert.deepEqual(JSON.parse((await fs.readFile(trace, 'utf8')).trim()), { id: 'ripgrep', args: ['--files', '--null'] });
  const fallback = path.join(root, 'fallback.txt');
  const walked = runNode(['tools/dicts/generate-repo-dict.js', '--repo', repo, '--min-count', '1', '--out', fallback],
    'dictionary uses its independent walker when selected ripgrep is unavailable', process.cwd(),
    { ...env, DICTIONARY_FIXTURE_MODE: 'unavailable' }, { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
  assert.equal(walked.status, 0, walked.stderr);
  assert.equal(await fs.readFile(fallback, 'utf8'), expectedDictionary);
  const emptyOutput = path.join(root, 'empty.txt');
  const empty = runNode(['tools/dicts/generate-repo-dict.js', '--repo', repo, '--min-count', '1', '--out', emptyOutput],
    'valid empty selected inventory does not invoke the walker', process.cwd(), { ...env, DICTIONARY_FIXTURE_MODE: 'empty' },
    { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(await fs.readFile(emptyOutput, 'utf8'), '');
  for (const mode of ['failure', 'nonzero', 'unterminated', 'outside']) {
    const output = path.join(root, `rejected-${mode}.txt`);
    const rejected = runNode(['tools/dicts/generate-repo-dict.js', '--repo', repo, '--min-count', '1', '--out', output],
      `dictionary preserves selected ${mode} failure`, process.cwd(), { ...env, DICTIONARY_FIXTURE_MODE: mode },
      { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
    assert.notEqual(rejected.status, 0, rejected.stderr);
    await assert.rejects(fs.stat(output), { code: 'ENOENT' }, 'a failed selected inventory cannot silently fall back and publish');
  }
  await fs.rm(trace);
  const bundle = path.join(root, 'bundle'), out = path.join(root, 'trust'), manifest = path.join(root, 'Cargo.toml');
  const sourceCommit = observeReleaseSource(process.cwd()), metadata = path.join(root, 'metadata.json');
  await fs.mkdir(bundle);
  await fs.writeFile(manifest, '[package]\nname="fixture"\nversion="0.0.0"\n');
  const artifact = { path: 'fixture.zip', sizeBytes: 1, sha256: 'a'.repeat(64) };
  await fs.writeFile(metadata, JSON.stringify({ gitSha: sourceCommit }));
  await fs.writeFile(path.join(bundle, 'release-artifacts.json'), JSON.stringify({ schemaVersion: 1,
    gitSha: sourceCommit, observedSourceCommit: sourceCommit, artifacts: [artifact] }));
  await fs.writeFile(path.join(bundle, 'release-checksums.txt'), artifact.sha256 + '  ' + artifact.path + '\n');
  const released = runNode(['tools/release/generate-trust-materials.js', '--bundle-dir', bundle, '--out-dir', out,
    '--cargo-manifest-path', manifest, '--metadata', metadata], 'release binds trusted selected SBOM producers', process.cwd(), env,
  { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
  assert.equal(released.status, 0, released.stderr);
  assert.equal(JSON.parse(released.stdout).ok, true);
  const invocations = (await fs.readFile(trace, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(invocations.map(entry => entry.id), ['npm-sbom', 'cargo-cyclonedx']);
  assert.ok(invocations[0].args.includes('--package-lock-only'));
  assert.ok(invocations[1].args.includes('--override-filename'));
  for (const file of ['node-root.cyclonedx.json', 'tui.cyclonedx.json']) {
    const output = JSON.parse(await fs.readFile(path.join(out, file), 'utf8'));
    const { metadata: sourceMetadata, ...content } = output;
    assert.deepEqual(content, bom, 'selected SBOM content survives source binding');
    assert.deepEqual(sourceMetadata, { properties: [{ name: SBOM_SOURCE_PROPERTY, value: sourceCommit }] });
  }
  for (const file of ['release-checksum-bundle.json', 'provenance-summary.json', 'trust-manifest.json']) {
    assert.equal(JSON.parse(await fs.readFile(path.join(out, file), 'utf8')).observedSourceCommit, sourceCommit);
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Dictionary and release consumers use canonical selected operational commands and retain their existing output contracts.');

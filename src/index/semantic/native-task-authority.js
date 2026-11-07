import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalSemanticJson, semanticHash } from './identity.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from './analysis-versions.js';
import { readVerifiedContainedFile, assertNoSymlinkPath } from '../../shared/contained-file.js';
import { isWithinRoot } from '../../workspace/identity.js';
import { resolveCompileCommandsDir } from '../tooling/compile-commands.js';
import { resolveProviderCommandOverride } from '../tooling/provider-command-override.js';
import { resolveNativeExecutable, collectNativeToolchainFiles } from './native-toolchain.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import { throwIfAborted } from '../../shared/abort.js';
import { collectNativeIncludeProbes } from './native-include-probes.js';
export { collectNativeIncludeProbes } from './native-include-probes.js';

export const NATIVE_DEPENDENCY_KEY = 'semantic.native.clangd-inventory.v1';
const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
const envKeys = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'CPATH', 'C_INCLUDE_PATH', 'CPLUS_INCLUDE_PATH', 'OBJC_INCLUDE_PATH',
  'SDKROOT', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH'];
const environment = () => Object.fromEntries(envKeys.map(key => [key, process.env[key] || null]));
const MAX_PROJECT_BYTES = 16 * 1024 * 1024, MAX_PROJECT_FILES = 512;

/** Arguments are data for clangd. They never become a shell/driver invocation. */
export const projectNativeCompileEntry = async (row, repoRoot) => {
  if (!row || !Array.isArray(row.arguments) || row.arguments.length > 128 || row.command !== undefined
    || typeof row.directory !== 'string' || typeof row.file !== 'string') throw fail('Sealed C tasks require bounded arguments-only compilation entries.');
  const directory = path.resolve(repoRoot, row.directory), filename = path.resolve(directory, row.file);
  if (!isWithinRoot(directory, repoRoot) || !isWithinRoot(filename, repoRoot) || !filename.endsWith('.c')) throw fail('Native compilation entry escapes its C project.');
  const args = row.arguments;
  if (!args.every(value => typeof value === 'string' && value.length <= 4096) || !args.includes('-nostdinc') || !args.includes('-ffreestanding')
    || !args.some(value => ['-std=c11', '-std=c17'].includes(value))) throw fail('Sealed C tasks require explicit C standard/freestanding/no-system-include flags.');
  const driver = await resolveNativeExecutable(path.isAbsolute(args[0]) ? args[0] : args[0].includes(path.sep) ? path.resolve(directory, args[0]) : args[0]);
  if (!/^clang(?:-\d+)?$/.test(path.basename(driver))) throw fail('Sealed C compiler identity requires an actual clang executable.');
  const includeRoots = []; let sourceArguments = 0;
  for (let index = 1; index < args.length; index += 1) {
    const value = args[index];
    if (['-nostdinc', '-ffreestanding', '-c', '-fsyntax-only', '-std=c11', '-std=c17'].includes(value)) continue;
    if (value === '-x') { if (args[++index] !== 'c') throw fail('Native compilation language is outside the C subset.'); continue; }
    if (value === '-I' || value.startsWith('-I')) {
      const input = value === '-I' ? args[++index] : value.slice(2), root = path.resolve(directory, input || '');
      if (!input || !isWithinRoot(root, repoRoot)) throw fail('Native include root escapes the project.');
      includeRoots.push(root); continue;
    }
    if (/^-D[A-Za-z_][A-Za-z0-9_]*(?:=[A-Za-z0-9_()+*\/ .-]+)?$/.test(value) && !/__DATE__|__TIME__|__TIMESTAMP__/.test(value)) continue;
    if (value === '-o') { const output = args[++index]; if (!output || !isWithinRoot(path.resolve(directory, output), repoRoot)) throw fail('Native output locator escapes its project.'); continue; }
    if (path.resolve(directory, value) === filename && !value.startsWith('-')) { sourceArguments += 1; continue; }
    throw fail('Native compilation flag is outside the sealed subset: ' + value);
  }
  if (sourceArguments !== 1) throw fail('Native compilation arguments require one exact C source.');
  return { file: filename, directory, arguments: [...args], driver, includeRoots: [...new Set(includeRoots)] };
};

export const nativeTaskInventoryHash = inventory => semanticHash(NATIVE_DEPENDENCY_KEY, inventory);

/** Actual C/clangd closure: all bounded project files/directory names, supported
 * include probes, safe launch config, environment and installed ELF dependencies.
 */
const collectInventory = async ({ repoRoot, toolingConfig, sources, signal = null }) => {
  repoRoot = path.resolve(repoRoot);
  if (sources.some(source => source.language !== 'c' || source.mapping || source.encoding !== 'utf8')) throw fail('Native task source is outside the direct C subset.');
  const env = environment();
  if (envKeys.slice(4).filter(key => key !== 'LD_LIBRARY_PATH').some(key => env[key])
    || Object.keys(process.env).some(key => key.startsWith('LD_') && key !== 'LD_LIBRARY_PATH' && process.env[key])) throw fail('Native include/loader environment is outside sealed authority.');
  const override = resolveProviderCommandOverride({ providerId: 'clangd', toolingConfig });
  if (override.args !== null) throw fail('Native custom server arguments are outside sealed authority.');
  if (toolingConfig?.clangd?.fallbackFlags?.length) throw fail('Native fallback flags are outside sealed authority.');
  const executable = await resolveNativeExecutable(override.cmd || 'clangd');
  const compilationRoot = resolveCompileCommandsDir(repoRoot, toolingConfig?.clangd);
  if (!compilationRoot || !isWithinRoot(path.resolve(compilationRoot), repoRoot)) throw fail('Native task requires a project-contained compilation database.');
  const databasePath = path.join(compilationRoot, 'compile_commands.json');
  const database = await readVerifiedContainedFile(repoRoot, databasePath, { maxBytes: 1024 * 1024, signal });
  const rawEntries = JSON.parse(database.buffer.toString('utf8'));
  if (!Array.isArray(rawEntries) || !rawEntries.length || rawEntries.length > 64) throw fail('Native compilation inventory exceeds its allowance.');
  const entries = [];
  for (const row of rawEntries) entries.push(await projectNativeCompileEntry(row, repoRoot));
  if (new Set(entries.map(row => row.file)).size !== entries.length) throw fail('Native compilation entries are ambiguous.');
  const files = [], directories = [], textByPath = new Map(), pending = [repoRoot]; let bytes = 0;
  while (pending.length) {
    throwIfAborted(signal);
    const directory = pending.pop(); assertNoSymlinkPath(repoRoot, directory);
    const children = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    directories.push({ path: directory, names: children.map(entry => [entry.name, entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'unsupported']) });
    if (directories.length > 128) throw fail('Native project directory inventory exceeds its allowance.');
    for (const entry of children) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw fail('Native project authority cannot follow symlinks.');
      if (entry.isDirectory()) { if (!['.git', 'node_modules'].includes(entry.name)) pending.push(filename); continue; }
      if (!entry.isFile()) throw fail('Native project contains an unsupported filesystem object.');
      const read = await readVerifiedContainedFile(repoRoot, filename, { maxBytes: 1024 * 1024, signal });
      files.push({ path: filename, hash: read.hash, bytes: read.buffer.length }); bytes += read.buffer.length;
      if (files.length > MAX_PROJECT_FILES || bytes > MAX_PROJECT_BYTES) throw fail('Native project byte/file inventory exceeds its allowance.');
      if (/\.(?:c|h|inc)$/.test(filename)) textByPath.set(filename, new TextDecoder('utf-8', { fatal: true }).decode(read.buffer));
    }
  }
  const probes = await collectNativeIncludeProbes({ repoRoot, entries, textByPath,
    present: new Set(files.map(row => row.path)), signal });
  for (const source of sources) {
    const row = files.find(row => row.path === path.resolve(repoRoot, source.path));
    if (!row || row.hash !== source.byteHash || !entries.some(entry => entry.file === row.path)) throw fail('Native source differs from its retained syntax authority.');
  }
  const toolchain = await collectNativeToolchainFiles({ executables: [executable, ...entries.map(row => row.driver)], signal });
  const launch = { cmd: executable, args: ['--log=error', '--background-index=false', '--enable-config=false', '--clang-tidy=false',
    '--header-insertion=never', '--compile-commands-dir=' + compilationRoot] };
  const inventory = { schemaVersion: 1, kind: 'clangd-c-bindings', producerVersion: SEMANTIC_ANALYSIS_VERSIONS.lspBindings,
    repoRoot, documentRouting: 'admitted-physical-c-file-uri-v1', toolingHash: semanticHash('semantic.native.tooling.v1', toolingConfig), environment: env, platform: process.platform, architecture: process.arch,
    sources: sources.map(source => ({ sourceUnitId: source.sourceUnitId, path: source.path, byteHash: source.byteHash })).sort((a, b) => a.sourceUnitId.localeCompare(b.sourceUnitId)),
    launch, entries, files: files.sort((a, b) => a.path.localeCompare(b.path)), directories: directories.sort((a, b) => a.path.localeCompare(b.path)),
    probes: probes.slice().sort((a, b) => a.path.localeCompare(b.path)), includeProbeWork: probes.work, toolchain };
  if (Buffer.byteLength(canonicalSemanticJson(inventory)) > 24 * 1024 * 1024) throw fail('Native authority descriptor exceeds its allowance.');
  return inventory;
};
export const collectNativeTaskInventory = async options => {
  try { return await collectInventory(options); }
  catch (error) {
    const observation = observeStorageResource(error, { phase: 'native-authority-discovery' });
    observation.requireSettled();
    throwIfAborted(options.signal);
    let code, message;
    try { code = observation.primary.code; message = observation.primary.message; }
    catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
    observation.requireSettled();
    if (code === 'ERR_SEMANTIC_NATIVE_UNSEALED') throw error;
    const reason = typeof code === 'string' && code ? code : typeof message === 'string' ? message : 'read failed';
    throw addStorageFailureContext(fail('Native authority discovery is incomplete: ' + reason),
      { cacheOwnershipPending: true, cacheOwnershipReleased: observation.isSettled }, error, { secondaryPresent: true });
  }
};

export const assertNativeTaskAuthority = (task, target) => {
  const inventory = target.nativeInventory, dependency = task.dependencies.find(row => row.dependencyKey === NATIVE_DEPENDENCY_KEY);
  if (!inventory) { if (dependency) throw fail('Native task authority is missing.'); return; }
  if (inventory.schemaVersion !== 1 || inventory.kind !== 'clangd-c-bindings' || !Array.isArray(inventory.sources)
    || !inventory.sources.length || inventory.sources.length > 64
    || inventory.sources.some(row => !row || !/^su1:[a-f0-9]{64}$/.test(row.sourceUnitId) || !/^[a-f0-9]{64}$/.test(row.byteHash)
      || typeof row.path !== 'string' || !row.path.endsWith('.c')) || task.kind !== 'bind'
    || canonicalSemanticJson(task.coverageToProduce) !== canonicalSemanticJson(['bindings'])
    || target.compilerInventory || target.binaryInventory || task.dependencies.length !== 1 || !dependency
    || dependency.expectedHash !== nativeTaskInventoryHash(inventory) || canonicalSemanticJson([...task.sourceUnits].sort())
      !== canonicalSemanticJson(inventory.sources.map(row => row.sourceUnitId))) throw fail('Native task authority differs from its immutable task.');
};

export const verifyNativeTaskAuthority = async ({ task, target, repoRoot, toolingConfig, sources, store, signal = null }) => {
  assertNativeTaskAuthority(task, target);
  const inventory = target.nativeInventory;
  if (!inventory || inventory.producerVersion !== SEMANTIC_ANALYSIS_VERSIONS.lspBindings) throw fail('Native producer identity changed.');
  const selected = task.sourceUnits.map(id => sources.get(id));
  if (selected.some(source => !source)) throw fail('Native retained source inventory is incomplete.');
  for (const source of selected) await store.verifySource(source, { signal });
  const current = await collectNativeTaskInventory({ repoRoot, toolingConfig, sources: selected, signal });
  const authorityHash = nativeTaskInventoryHash(current);
  if (authorityHash !== nativeTaskInventoryHash(inventory)) throw fail('Native compiler/project/environment/negative-probe closure changed.');
  return { verified: true, complete: true, authorityHash, dependencyHashes: new Map([[NATIVE_DEPENDENCY_KEY, authorityHash]]) };
};

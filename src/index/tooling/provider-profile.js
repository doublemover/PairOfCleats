import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { semanticHash, canonicalSemanticJson } from '../semantic/identity.js';
import { readVerifiedContainedFile, assertNoSymlinkPath } from '../../shared/contained-file.js';
import { throwIfAborted } from '../../shared/abort.js';

export const PROVIDER_PROFILE_VERSION = 1;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const fail = (message) => Object.assign(new Error(message), { code: 'ERR_TOOLING_PROFILE_IDENTITY' });
const requireText = (value, name) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || value.includes('\0')) throw fail(`Invalid provider profile ${name}.`);
  return value;
};
const command = (value) => {
  if (!Array.isArray(value) || !value.length || value.length > 128) throw fail('Provider command must be a bounded argument array.');
  return value.map((part) => requireText(part, 'command argument'));
};
const freeze = (value) => {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
};

/** Observe explicitly selected files only. This reads bytes; it never resolves a
 * PATH command, probes a version, executes a project, installs or fetches tools.
 * Unknown read closure remains non-durable even when every known file hashes. */
export const observeProviderProfile = async ({ providerId, adapterVersion, contractVersion = 1,
  apiProfile, capabilities = [], configuredCommand, resolvedCommand, observedVersion = null,
  selection = 'explicit', expectedToolHash = null, toolFiles = [], repoRoot,
  sourceInputs = [], project = {}, dependencyClosure = 'unknown',
  maxFiles = 1024, maxBytes = 64 * 1024 * 1024, signal = null }) => {
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 16384
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024 * 1024) throw fail('Invalid profile observation bounds.');
  if (contractVersion !== 1 || !['complete', 'unknown'].includes(dependencyClosure)) throw fail('Unsupported profile contract or dependency closure.');
  if (!Array.isArray(toolFiles) || !Array.isArray(sourceInputs) || !Array.isArray(capabilities)
    || capabilities.length > 128 || !sourceInputs.length) throw fail('Profile needs bounded tool/source/capability inventories.');
  const root = await fs.realpath(repoRoot), seen = new Set();
  let retainedBytes = 0, fileCount = 0;
  const observe = async (entry, purpose, defaultRoot = root) => {
    throwIfAborted(signal);
    if (++fileCount > maxFiles) throw fail('Provider profile file budget exhausted.');
    if (!entry || typeof entry !== 'object') throw fail('Invalid profile file entry.');
    const authorizedRoot = await fs.realpath(entry.root || defaultRoot);
    const filename = path.resolve(authorizedRoot, requireText(entry.path, 'file path'));
    const key = purpose + ':' + filename;
    if (seen.has(key)) throw fail('Duplicate provider profile file identity.');
    seen.add(key);
    if (entry.absent === true) {
      assertNoSymlinkPath(authorizedRoot, filename, { allowMissing: true });
      try { await fs.lstat(filename); } catch (error) {
        if (error.code === 'ENOENT') return { path: filename, state: 'absent', hash: null, bytes: 0 };
        throw error;
      }
      throw fail('A recorded negative resolution is now present.');
    }
    if (entry.hash !== undefined && !digest(entry.hash)) throw fail('Expected SHA-256 file identity.');
    const { buffer: bytes } = await readVerifiedContainedFile(authorizedRoot, filename, {
      expectedHash: entry.hash ?? null, maxBytes: maxBytes - retainedBytes, signal
    });
    retainedBytes += bytes.length;
    return { path: filename, state: 'present', hash: hash(bytes), bytes: bytes.length };
  };
  const files = async (entries, purpose, defaultRoot) => {
    if (!Array.isArray(entries)) throw fail(`Expected ${purpose} file inventory.`);
    const result = [];
    for (const entry of entries) result.push(await observe(entry, purpose, defaultRoot));
    return result.sort((a, b) => a.path.localeCompare(b.path));
  };
  const tool = await files(toolFiles, 'tool');
  if (tool.some(entry => entry.state !== 'present')) throw fail('Tool identity cannot use a negative file observation.');
  for (const input of sourceInputs) {
    if (!digest(input?.hash) || input.absent || input.root) throw fail('Source inputs need pinned repository bytes.');
  }
  const sources = await files(sourceInputs, 'source');
  const projectFiles = await files(project.files || [], 'project');
  const sdkFiles = await files(project.sdkFiles || [], 'sdk');
  const dependencies = await files(project.dependencies || [], 'dependency');
  const configured = command(configuredCommand), resolved = command(resolvedCommand);
  const capabilityProfile = [...new Set(capabilities.map(value => requireText(value, 'capability')))].sort();
  const toolHash = semanticHash('tooling.observed-tool.v1', { files: tool, resolvedCommand: resolved,
    observedVersion: observedVersion === null ? null : requireText(observedVersion, 'observed version'),
    apiProfile: requireText(apiProfile, 'API profile'), capabilityProfile });
  if (expectedToolHash !== null && !digest(expectedToolHash)) throw fail('Invalid expected tool identity.');
  const reasons = [];
  if (!tool.length) reasons.push('tool_bytes_unobserved');
  if (dependencyClosure !== 'complete') reasons.push('read_dependency_closure_unknown');
  if (expectedToolHash !== null && expectedToolHash !== toolHash) reasons.push('install_runtime_identity_mismatch');
  if (!['explicit', 'managed', 'ambient-fallback'].includes(selection)) throw fail('Unknown tool selection source.');
  const identity = { schemaVersion: PROVIDER_PROFILE_VERSION, providerId: requireText(providerId, 'provider ID'),
    adapterVersion: requireText(adapterVersion, 'adapter version'), contractVersion,
    tool: { hash: toolHash, files: tool, configuredCommand: configured, resolvedCommand: resolved,
      observedVersion, apiProfile, capabilities: capabilityProfile, selection, expectedToolHash },
    project: { root, variant: project.variant ?? null, targets: structuredClone(project.targets ?? []),
      configHash: semanticHash('tooling.project-config.v1', projectFiles),
      moduleResolutionHash: semanticHash('tooling.project-dependencies.v1', dependencies),
      sdkHash: semanticHash('tooling.project-sdk.v1', sdkFiles),
      vfsMappingHash: semanticHash('tooling.project-vfs.v1', project.vfsMappings ?? []),
      files: projectFiles, sdkFiles, dependencies, dependencyClosure },
    sources, durable: reasons.length === 0, reasons };
  const receipt = { ...identity, profileHash: semanticHash('tooling.provider-profile.v1', identity) };
  throwIfAborted(signal);
  return freeze(receipt);
};

/** Validate a host-observed receipt before using it as cache provenance. */
export const providerProfileCacheIdentity = (receipt, { providerId, adapterVersion, repoRoot } = {}) => {
  if (!receipt || receipt.schemaVersion !== PROVIDER_PROFILE_VERSION || receipt.durable !== true
    || !digest(receipt.profileHash) || receipt.providerId !== providerId || receipt.adapterVersion !== adapterVersion
    || (repoRoot && path.resolve(receipt.project?.root || '') !== path.resolve(repoRoot))) return null;
  const { profileHash, ...identity } = receipt;
  if (semanticHash('tooling.provider-profile.v1', identity) !== profileHash) throw fail('Provider profile receipt content changed.');
  // Canonicalization also rejects accessors, exotic objects and non-JSON values.
  canonicalSemanticJson(identity);
  return profileHash;
};

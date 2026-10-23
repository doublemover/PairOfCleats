import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyEdits, modify } from 'jsonc-parser';
import { parseJsoncText } from '../../../src/shared/jsonc.js';
import { validateConfig } from '../../../src/config/validate.js';
import { readVerifiedContainedFile, readVerifiedContainedFileSync, assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { applyRepoConfigAuthority } from '../../../src/shared/config-authority.js';
import { sanitizeRuntimeReceipt } from '../../../src/shared/runtime-envelope/receipt.js';
import { atomicWriteTextSync } from '../../../src/shared/io/atomic-write.js';
import { withFileLock } from '../../../src/shared/locks/file-lock.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { loadUserConfig, resolveRepoConfigPath } from '../../../src/shared/dict-utils.js';
import { getOperationalGuardrailDiagnostic, resolveOperationalGuardrails } from '../../../src/retrieval/operational-guardrails.js';
import { loadWorkspaceConfig } from '../../../src/workspace/config.js';
import { DEFAULT_USER_CONFIG_TEMPLATE } from '../../config/default-template.js';
import { assertTuiSettingsRequest } from '../../../src/contracts/validators/tui-settings.js';

const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_PREVIEWS = 16;
const PREVIEW_TTL_MS = 5 * 60 * 1000;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// Raw command/startup inputs can carry credentials in tool-specific flag
// syntax. Keep them in the private config file rather than native UI records.
const PRIVATE_INPUT_KEY = /^(?:.*args|cmd|command|env|environment|nodeOptions)$/i;
const protectInputValues = value => {
  if (Array.isArray(value)) return value.map(protectInputValues);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    PRIVATE_INPUT_KEY.test(key) ? { redacted: true } : protectInputValues(child)]));
};
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const atPath = (object, keys) => keys.reduce((value, key) => (
  value && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined
), object);
const wrappedValue = (keys, value) => keys.reduceRight((child, key) => ({ [key]: child }), value ?? null);
const safeValue = (keys, value) => {
  let safe = protectInputValues(sanitizeRuntimeReceipt(wrappedValue(keys, value)));
  for (const key of keys) {
    if (safe?.redacted === true) return safe;
    safe = safe?.[key];
  }
  return safe ?? null;
};
const unchangedByRedaction = (keys, value) => JSON.stringify(value ?? null) === JSON.stringify(safeValue(keys, value));
const collectFields = (schema, prefix = []) => Object.entries(schema.properties || {}).flatMap(([key, child]) => {
  const keys = [...prefix, key];
  if (BLOCKED_KEYS.has(key)) return [];
  return child.properties ? collectFields(child, keys) : [{ path: keys, schema: child }];
});
const projectDocument = read => {
  const raw = read.buffer.toString('utf8');
  return { raw, buffer: read.buffer, encodingValid: Buffer.from(raw).equals(read.buffer),
    revision: `sha256:${read.hash}`, found: true, mode: read.stat.mode & 0o777 };
};
const missingDocument = () => ({ raw: '{}\n', buffer: Buffer.from('{}\n'), encodingValid: true,
  revision: 'missing', found: false, mode: 0o600 });

const readDocument = async (root, target, signal) => {
  assertNoSymlinkPath(root, target, { allowMissing: true });
  try {
    const read = await readVerifiedContainedFile(root, target, { maxBytes: MAX_CONFIG_BYTES, signal });
    return projectDocument(read);
  } catch (error) {
    if (error.code === 'ENOENT') return missingDocument();
    throw error;
  }
};
const readDocumentSync = (root, target, signal) => {
  assertNoSymlinkPath(root, target, { allowMissing: true });
  try { return projectDocument(readVerifiedContainedFileSync(root, target, { maxBytes: MAX_CONFIG_BYTES, signal })); }
  catch (error) { if (error.code === 'ENOENT') return missingDocument(); throw error; }
};

/** Session-owned settings transactions. Public results never contain source text or credentials. */
export const createTuiSettingsSession = ({ toolRoot, schemaPath = path.join(toolRoot, 'docs/config/schema.json'),
  env = process.env, now = Date.now } = {}) => {
  let scope = null;
  let rootIdentity = null;
  let selectionEpoch = 0;
  let disposed = false;
  let schemaMemo = null;
  const previews = new Map();
  const validateEffectiveRetrieval = (config, selected) => {
    // Reuse canonical authority/trusted-source precedence for the proposed bytes;
    // never publish a temporary repository config or initialize search backends.
    const effective = loadUserConfig(selected.configRoot, { env, repositoryConfig: config });
    try { resolveOperationalGuardrails({ userConfig: effective }); }
    catch (error) {
      const diagnostic = getOperationalGuardrailDiagnostic(error);
      if (!diagnostic) throw error;
      return { ok: false, errors: [diagnostic.message] };
    }
    return { ok: true, errors: [] };
  };
  const requireScope = scopeId => {
    if (!scope || scope.id !== scopeId) fail('ERR_TUI_SCOPE_CHANGED', 'Select the current repository or workspace again.');
    const current = fsSync.lstatSync(scope.configRoot, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink()
      || current.dev !== rootIdentity.dev || current.ino !== rootIdentity.ino) {
      fail('ERR_TUI_SCOPE_CHANGED', 'The selected directory changed. Select it again.');
    }
    if (scope.kind === 'workspace') {
      assertNoSymlinkPath(path.dirname(scope.target), scope.target);
      if (fsSync.statSync(scope.target).size > MAX_CONFIG_BYTES
        || loadWorkspaceConfig(scope.target).workspaceConfigHash !== scope.workspaceConfigHash) {
        fail('ERR_TUI_SCOPE_CHANGED', 'Workspace membership changed. Select it again.');
      }
    }
    return scope;
  };
  const loadSchema = async signal => {
    const read = await readVerifiedContainedFile(toolRoot, schemaPath,
      { maxBytes: MAX_CONFIG_BYTES, signal });
    const revision = `sha256:${read.hash}`;
    // validateConfig owns compiled validators by schema object identity. Keep
    // that identity while verified bytes agree; still recheck the file each time.
    if (schemaMemo?.revision !== revision) schemaMemo = { schema: JSON.parse(read.buffer.toString('utf8')), revision };
    return schemaMemo;
  };
  const selectScope = async (request, { signal } = {}) => {
    const { kind, target } = assertTuiSettingsRequest('select', request);
    if (disposed) fail('ERR_TUI_SESSION_CLOSED', 'The settings session has closed.');
    const epoch = ++selectionEpoch;
    throwIfAborted(signal);
    if (!['repo', 'workspace'].includes(kind) || typeof target !== 'string' || !target.trim()
      || target.includes('\0') || target.length > 4096) fail('ERR_TUI_SCOPE_INVALID', 'Choose a repository directory or workspace file.');
    const canonical = await fs.realpath(path.resolve(target));
    const stat = await fs.stat(canonical);
    let next;
    if (kind === 'repo') {
      if (!stat.isDirectory()) fail('ERR_TUI_SCOPE_INVALID', 'A repository scope requires a directory.');
      next = { id: randomUUID(), kind, target: canonical, configRoot: canonical, name: path.basename(canonical) };
    } else {
      if (!stat.isFile()) fail('ERR_TUI_SCOPE_INVALID', 'A workspace scope requires a workspace file.');
      await readVerifiedContainedFile(path.dirname(canonical), canonical, { maxBytes: MAX_CONFIG_BYTES, signal });
      const workspace = loadWorkspaceConfig(canonical);
      next = { id: randomUUID(), kind, target: canonical, configRoot: workspace.workspaceDir,
        name: workspace.name, repoCount: workspace.repos.length, workspaceConfigHash: workspace.workspaceConfigHash };
    }
    throwIfAborted(signal);
    if (epoch !== selectionEpoch) fail('ERR_TUI_SCOPE_CHANGED', 'A newer scope selection replaced this request.');
    rootIdentity = fsSync.lstatSync(next.configRoot, { bigint: true });
    scope = Object.freeze(next);
    previews.clear();
    return { ...scope };
  };
  const captureScope = scopeId => Object.freeze({ ...requireScope(scopeId) });
  const inspectConfig = async (request, { signal } = {}) => {
    const { scopeId } = assertTuiSettingsRequest('inspect', request);
    const selected = captureScope(scopeId);
    const file = resolveRepoConfigPath(selected.configRoot);
    const [document, schema] = await Promise.all([
      readDocument(selected.configRoot, file, signal), loadSchema(signal)
    ]);
    let config = {}, validation;
    try {
      if (!document.encodingValid) fail('ERR_TUI_SETTINGS_ENCODING', 'Configuration is not valid UTF-8. Use reset with a byte-preserving backup or your private editor.');
      config = parseJsoncText(document.raw); validation = validateConfig(schema.schema, config);
    }
    catch (error) { validation = { ok: false, errors: [error.message] }; }
    if (validation.ok) validation = validateEffectiveRetrieval(config, selected);
    let effective = null;
    let diagnostics = [];
    if (validation.ok) {
      const child = await spawnSubprocess(process.execPath, [path.join(toolRoot, 'bin/pairofcleats.js'),
        'config', 'dump', '--repo', selected.configRoot, '--json'], {
        cwd: selected.configRoot, env, signal, timeoutMs: 10000,
        stdio: ['ignore', 'pipe', 'pipe'], maxOutputBytes: MAX_CONFIG_BYTES, rejectOnNonZeroExit: true
      });
      if (child.outputCapture?.stdout?.truncated || child.outputCapture?.stdout?.encodingLoss) {
        fail('ERR_TUI_SETTINGS_OUTPUT', 'Configuration preview output was incomplete.');
      }
      effective = JSON.parse(child.stdout);
      if (child.stderr.trim()) diagnostics = [sanitizeRuntimeReceipt(child.stderr.trim())];
    }
    const [current, currentSchema] = await Promise.all([
      readDocument(selected.configRoot, file, signal), loadSchema(signal)
    ]);
    if (current.revision !== document.revision || currentSchema.revision !== schema.revision) {
      fail('ERR_TUI_SETTINGS_STALE', 'Configuration or schema changed during inspection. Reload it.');
    }
    requireScope(scopeId);
    const fields = collectFields(schema.schema).map(field => {
      const requested = atPath(config, field.path);
      const probe = wrappedValue(field.path, 'editable-probe');
      const admitted = atPath(applyRepoConfigAuthority(probe, selected.configRoot, env), field.path) === 'editable-probe';
      const privateValue = !unchangedByRedaction(field.path, requested);
      const editable = admitted && !privateValue;
      return { path: field.path, schema: structuredClone(field.schema),
        requested: privateValue ? { redacted: true } : safeValue(field.path, requested),
        requestedPresent: requested !== undefined,
        effective: privateValue ? { redacted: true } : safeValue(field.path, atPath(effective?.userConfig, field.path)),
        effectiveRecorded: atPath(effective?.userConfig, field.path) !== undefined, editable,
        readOnlyReason: editable ? null : admitted ? 'Use your private configuration editor for sensitive values.'
          : 'This setting is controlled by launch trust policy.' };
    });
    if (effective) effective.userConfig = protectInputValues(effective.userConfig);
    return { scope: selected, configPath: file, found: document.found, revision: document.revision,
      schemaRevision: schema.revision, validation, fields, effective, diagnostics };
  };
  const preview = async (request, { signal } = {}) => {
    assertTuiSettingsRequest('preview', request);
    const selected = captureScope(request.scopeId);
    const file = resolveRepoConfigPath(selected.configRoot);
    const [document, schema] = await Promise.all([
      readDocument(selected.configRoot, file, signal), loadSchema(signal)
    ]);
    if (request.revision !== document.revision || request.schemaRevision !== schema.revision) {
      fail('ERR_TUI_SETTINGS_STALE', 'Configuration or schema changed. Reload it before editing.');
    }
    let raw, diff;
    const reset = request.operation === 'reset';
    if (reset) {
      raw = `${DEFAULT_USER_CONFIG_TEMPLATE.trimEnd()}\n`;
      let old;
      try { old = parseJsoncText(document.raw); } catch { old = null; }
      const replacement = parseJsoncText(raw);
      diff = [{ action: 'reset', description: 'Replace repository overrides with the canonical default template.' },
        ...collectFields(schema.schema).flatMap(field => {
          const before = atPath(old, field.path), after = atPath(replacement, field.path);
          return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path: field.path,
            before: safeValue(field.path, before), after: safeValue(field.path, after),
            beforePresent: before !== undefined, afterPresent: after !== undefined }];
        })];
    } else {
      if (!document.encodingValid) fail('ERR_TUI_SETTINGS_ENCODING', 'Configuration cannot be edited as UTF-8.');
      const field = collectFields(schema.schema).find(entry => JSON.stringify(entry.path) === JSON.stringify(request.path));
      const removing = request.operation === 'remove';
      if (!field || !['edit', 'remove'].includes(request.operation)) fail('ERR_TUI_SETTINGS_FIELD', 'Choose a setting from the current schema.');
      const old = parseJsoncText(document.raw);
      const probe = wrappedValue(field.path, 'editable-probe');
      if (atPath(applyRepoConfigAuthority(probe, selected.configRoot, env), field.path) !== 'editable-probe') {
        fail('ERR_TUI_SETTINGS_AUTHORITY', 'This setting is controlled by launch trust policy.');
      }
      if (!unchangedByRedaction(field.path, atPath(old, field.path)) || !unchangedByRedaction(field.path, request.value)) {
        fail('ERR_TUI_SETTINGS_SENSITIVE', 'Use your private configuration editor for sensitive values.');
      }
      if (!removing && (Buffer.byteLength(JSON.stringify(request.value) ?? '') > 64 * 1024 || request.value === undefined)) {
        fail('ERR_TUI_SETTINGS_VALUE', 'The selected value is missing or exceeds the editor limit.');
      }
      raw = applyEdits(document.raw, modify(document.raw, field.path, request.value,
        { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
      diff = [{ path: field.path, before: safeValue(field.path, atPath(old, field.path)),
        after: safeValue(field.path, request.value), beforePresent: atPath(old, field.path) !== undefined,
        afterPresent: !removing,
        ...(removing ? { action: 'remove', description: 'Remove only this override. The next effective configuration layer or policy applies; it may differ from the schema default.' } : {}) }];
    }
    if (Buffer.byteLength(raw) > MAX_CONFIG_BYTES) fail('ERR_TUI_SETTINGS_VALUE', 'Configuration exceeds the editor limit.');
    const proposed = parseJsoncText(raw);
    let validation = validateConfig(schema.schema, proposed);
    if (validation.ok) validation = validateEffectiveRetrieval(proposed, selected);
    if (!validation.ok) return { ok: false, scope: selected, validation, diff };
    const backup = reset && document.found ? await readDocument(selected.configRoot, `${file}.bak`, signal) : null;
    requireScope(request.scopeId);
    throwIfAborted(signal);
    for (const [id, entry] of previews) if (entry.expiresAt <= now()) previews.delete(id);
    while (previews.size >= MAX_PREVIEWS) previews.delete(previews.keys().next().value);
    const previewId = randomUUID();
    previews.set(previewId, { scopeId: selected.id, raw, revision: document.revision, schemaRevision: schema.revision,
      reset, backupRevision: backup?.revision ?? null, expiresAt: now() + PREVIEW_TTL_MS });
    return { ok: true, scope: selected, previewId, validation, diff,
      backupPath: reset && document.found ? `${file}.bak` : null,
      overwritesBackup: Boolean(backup?.found), requiresResetConfirmation: reset };
  };
  const commit = async (request, { signal } = {}) => {
    const { scopeId, previewId, confirmed, resetConfirmation } = assertTuiSettingsRequest('commit', request);
    const selected = captureScope(scopeId), pending = previews.get(previewId);
    if (!pending || pending.scopeId !== scopeId || pending.expiresAt <= now()) {
      previews.delete(previewId);
      fail('ERR_TUI_SETTINGS_PREVIEW', 'The settings preview expired or was cancelled.');
    }
    if (confirmed !== true || (pending.reset && resetConfirmation !== 'RESET')) {
      fail('ERR_TUI_SETTINGS_CONFIRMATION', 'Review the preview and explicitly confirm this change.');
    }
    const file = resolveRepoConfigPath(selected.configRoot);
    const lockPath = `${file}.edit.lock`;
    assertNoSymlinkPath(selected.configRoot, lockPath, { allowMissing: true });
    const result = await withFileLock({ lockPath, waitMs: 1000, signal }, async () => {
      const [document, schema] = await Promise.all([
        readDocument(selected.configRoot, file, signal), loadSchema(signal)
      ]);
      requireScope(scopeId);
      if (pending.revision !== document.revision || pending.schemaRevision !== schema.revision) {
        previews.delete(previewId);
        fail('ERR_TUI_SETTINGS_STALE', 'Configuration or schema changed. Reload and preview again.');
      }
      const backup = pending.reset && document.found ? await readDocument(selected.configRoot, `${file}.bak`, signal) : null;
      if ((backup?.revision ?? null) !== pending.backupRevision) fail('ERR_TUI_SETTINGS_STALE', 'The backup changed. Preview reset again.');
      throwIfAborted(signal);
      requireScope(scopeId);
      if (previews.get(previewId) !== pending || pending.expiresAt <= now()) {
        fail('ERR_TUI_SETTINGS_PREVIEW', 'The settings preview expired or was cancelled.');
      }
      assertNoSymlinkPath(selected.configRoot, file, { allowMissing: true });
      // Keep the final check/publication synchronous: cancellation cannot report
      // an unchanged file after the atomic rename has already committed it.
      const finalDocument = readDocumentSync(selected.configRoot, file, signal);
      const finalSchema = readDocumentSync(toolRoot, schemaPath, signal);
      const finalBackup = backup ? readDocumentSync(selected.configRoot, `${file}.bak`, signal) : null;
      if (finalDocument.revision !== pending.revision || finalSchema.revision !== pending.schemaRevision
        || (finalBackup?.revision ?? null) !== pending.backupRevision) {
        previews.delete(previewId);
        fail('ERR_TUI_SETTINGS_STALE', 'Configuration, schema or backup changed before publication.');
      }
      // Trusted configuration can change without changing repository bytes.
      // Re-admit the current effective combination before backup or publication.
      const effectiveValidation = validateEffectiveRetrieval(parseJsoncText(pending.raw), selected);
      if (!effectiveValidation.ok) {
        previews.delete(previewId);
        fail('ERR_TUI_SETTINGS_GUARDRAIL', effectiveValidation.errors.join('\n'));
      }
      if (backup) {
        assertNoSymlinkPath(selected.configRoot, `${file}.bak`, { allowMissing: true });
        atomicWriteTextSync(`${file}.bak`, finalDocument.buffer, { mkdir: false, mode: 0o600 });
      }
      atomicWriteTextSync(file, pending.raw, { mkdir: false, mode: finalDocument.mode });
      previews.delete(previewId);
      return { ok: true, scope: selected, saved: true, reset: pending.reset,
        backupPath: backup ? `${file}.bak` : null };
    });
    if (!result) fail('ERR_TUI_SETTINGS_BUSY', 'Another settings save is in progress.');
    return result;
  };
  const cancel = request => {
    const { scopeId, previewId } = assertTuiSettingsRequest('cancel', request);
    requireScope(scopeId);
    return { cancelled: previews.delete(previewId) };
  };
  return { selectScope, captureScope, inspectConfig, preview, commit, cancel,
    dispose() { previews.clear(); scope = null; schemaMemo = null; selectionEpoch++; disposed = true; } };
};

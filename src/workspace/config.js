import fs from 'node:fs';
import path from 'node:path';
import { readJsoncFile } from '../shared/jsonc.js';
import { stableStringify } from '../shared/stable-json.js';
import { sha1 } from '../shared/hash.js';
import { createError, ERROR_CODES } from '../shared/error-codes.js';
import { validateWorkspaceConfigResolved } from '../contracts/validators/workspace.js';
import { getRepoId, resolveRepoRoot } from '../../tools/shared/dict-utils.js';
import { normalizeIdentityPath, toRealPathSync } from './identity.js';

export const WORKSPACE_CONFIG_DEFAULT_FILENAME = '.pairofcleats-workspace.jsonc';

export const WORKSPACE_ERROR_CODES = Object.freeze({
  FILE_NOT_FOUND: 'ERR_WORKSPACE_FILE_NOT_FOUND',
  PARSE_FAILED: 'ERR_WORKSPACE_PARSE_FAILED',
  ROOT_NOT_OBJECT: 'ERR_WORKSPACE_ROOT_NOT_OBJECT',
  SCHEMA_VERSION: 'ERR_WORKSPACE_SCHEMA_VERSION',
  REPOS_EMPTY: 'ERR_WORKSPACE_REPOS_EMPTY',
  REPO_ROOT_NOT_FOUND: 'ERR_WORKSPACE_REPO_ROOT_NOT_FOUND',
  REPO_ROOT_NOT_DIRECTORY: 'ERR_WORKSPACE_REPO_ROOT_NOT_DIRECTORY',
  DUPLICATE_REPO_ROOT: 'ERR_WORKSPACE_DUPLICATE_REPO_ROOT',
  DUPLICATE_REPO_ID: 'ERR_WORKSPACE_DUPLICATE_REPO_ID',
  DUPLICATE_ALIAS: 'ERR_WORKSPACE_DUPLICATE_ALIAS',
  INVALID_SHAPE: 'ERR_WORKSPACE_INVALID_SHAPE',
  UNKNOWN_KEY: 'ERR_WORKSPACE_UNKNOWN_KEY'
});

const TOP_LEVEL_KEYS = new Set(['schemaVersion', 'name', 'cacheRoot', 'defaults', 'repos']);
const DEFAULT_KEYS = new Set(['enabled', 'priority', 'tags']);
const REPO_KEYS = new Set(['root', 'alias', 'enabled', 'priority', 'tags']);
const SUPPORTED_SCHEMA_VERSION = 1;

const isPlainObject = (value) => (
  Boolean(value) && typeof value === 'object' && value.constructor === Object
);

const createWorkspaceIssue = (code, message, {
  path: issuePath,
  field = null,
  reason = null,
  hint = null
} = {}) => ({
  code,
  message,
  path: issuePath || null,
  field,
  reason,
  hint
});

const throwWorkspaceIssues = (issues) => {
  const list = Array.isArray(issues) ? issues.filter(Boolean) : [];
  const first = list[0] || createWorkspaceIssue(
    WORKSPACE_ERROR_CODES.INVALID_SHAPE,
    'Invalid workspace configuration.'
  );
  const err = createError(ERROR_CODES.INVALID_REQUEST, first.message, {
    workspaceCode: first.code,
    path: first.path,
    field: first.field,
    reason: first.reason,
    hint: first.hint,
    issues: list
  });
  err.code = first.code;
  err.errorCode = ERROR_CODES.INVALID_REQUEST;
  throw err;
};

const collectUnknownKeys = (issues, value, allowedKeys, objectPath) => {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (allowedKeys.has(key)) continue;
    issues.push(createWorkspaceIssue(
      WORKSPACE_ERROR_CODES.UNKNOWN_KEY,
      `Unknown key "${key}" at ${objectPath}.`,
      {
        path: objectPath,
        field: key,
        reason: 'unknown-key',
        hint: 'Remove the key or update the workspace schema.'
      }
    ));
  }
};

const normalizeAlias = (value, fieldPath, issues) => {
  if (value == null) return null;
  if (typeof value !== 'string') {
    issues.push(createWorkspaceIssue(
      WORKSPACE_ERROR_CODES.INVALID_SHAPE,
      `${fieldPath} must be a string or null.`,
      {
        path: fieldPath,
        field: 'alias',
        reason: 'type',
        hint: 'Use a string alias or null.'
      }
    ));
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
};

const normalizeInteger = (value, fallback, fieldPath, issues, fieldName) => {
  if (value == null) return fallback;
  if (!Number.isInteger(value)) {
    issues.push(createWorkspaceIssue(
      WORKSPACE_ERROR_CODES.INVALID_SHAPE,
      `${fieldPath} must be an integer.`,
      {
        path: fieldPath,
        field: fieldName,
        reason: 'type',
        hint: 'Use a whole number value.'
      }
    ));
    return fallback;
  }
  return value;
};

const normalizeBoolean = (value, fallback, fieldPath, issues, fieldName) => {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') {
    issues.push(createWorkspaceIssue(
      WORKSPACE_ERROR_CODES.INVALID_SHAPE,
      `${fieldPath} must be a boolean.`,
      {
        path: fieldPath,
        field: fieldName,
        reason: 'type',
        hint: 'Use true or false.'
      }
    ));
    return fallback;
  }
  return value;
};

const normalizeTags = (value, fallbackTags, fieldPath, issues) => {
  if (value == null) return [...fallbackTags];
  if (!Array.isArray(value)) {
    issues.push(createWorkspaceIssue(
      WORKSPACE_ERROR_CODES.INVALID_SHAPE,
      `${fieldPath} must be an array of strings.`,
      {
        path: fieldPath,
        field: 'tags',
        reason: 'type',
        hint: 'Use an array, for example ["service", "core"].'
      }
    ));
    return [...fallbackTags];
  }
  const out = [];
  for (let idx = 0; idx < value.length; idx += 1) {
    const entry = value[idx];
    if (typeof entry !== 'string') {
      issues.push(createWorkspaceIssue(
        WORKSPACE_ERROR_CODES.INVALID_SHAPE,
        `${fieldPath}[${idx}] must be a string.`,
        {
          path: `${fieldPath}[${idx}]`,
          field: 'tags',
          reason: 'type',
          hint: 'Use only string tag values.'
        }
      ));
      continue;
    }
    const normalized = entry.trim().toLowerCase();
    if (!normalized) continue;
    out.push(normalized);
  }
  return Array.from(new Set(out)).sort((a, b) => a.localeCompare(b));
};

const normalizeDefaults = (rawDefaults, issues) => {
  if (rawDefaults == null) {
    return { enabled: true, priority: 0, tags: [] };
  }
  if (!isPlainObject(rawDefaults)) {
    issues.push(createWorkspaceIssue(
      WORKSPACE_ERROR_CODES.INVALID_SHAPE,
      'defaults must be an object.',
      {
        path: '$.defaults',
        field: 'defaults',
        reason: 'type',
        hint: 'Use an object with enabled/priority/tags keys.'
      }
    ));
    return { enabled: true, priority: 0, tags: [] };
  }
  collectUnknownKeys(issues, rawDefaults, DEFAULT_KEYS, '$.defaults');
  const enabled = normalizeBoolean(rawDefaults.enabled, true, '$.defaults.enabled', issues, 'enabled');
  const priority = normalizeInteger(rawDefaults.priority, 0, '$.defaults.priority', issues, 'priority');
  const tags = normalizeTags(rawDefaults.tags, [], '$.defaults.tags', issues);
  return { enabled, priority, tags };
};

const resolveCacheRoot = (rawCacheRoot, workspaceDir, issues) => {
  if (rawCacheRoot == null) return null;
  if (typeof rawCacheRoot !== 'string') {
    issues.push(createWorkspaceIssue(
      WORKSPACE_ERROR_CODES.INVALID_SHAPE,
      '$.cacheRoot must be a string or null.',
      {
        path: '$.cacheRoot',
        field: 'cacheRoot',
        reason: 'type',
        hint: 'Use an absolute path or a path relative to the workspace file.'
      }
    ));
    return null;
  }
  const trimmed = rawCacheRoot.trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(workspaceDir, trimmed);
};

export const computeRepoSetId = (reposResolved) => {
  const identities = (Array.isArray(reposResolved) ? reposResolved : [])
    .map((repo) => ({
      repoId: String(repo?.repoId || ''),
      repoRootCanonical: String(repo?.repoRootCanonical || '')
    }))
    .sort((a, b) => (
      a.repoId.localeCompare(b.repoId) || a.repoRootCanonical.localeCompare(b.repoRootCanonical)
    ));
  return `ws1-${sha1(stableStringify({
    v: 1,
    schemaVersion: 1,
    repos: identities
  }))}`;
};

export const computeWorkspaceConfigHash = (resolvedWorkspace) => {
  const repos = (Array.isArray(resolvedWorkspace?.repos) ? resolvedWorkspace.repos : [])
    .map((repo) => ({
      root: repo.repoRootCanonical,
      alias: repo.alias,
      enabled: repo.enabled,
      priority: repo.priority,
      tags: Array.isArray(repo.tags) ? [...repo.tags] : []
    }))
    .sort((a, b) => (
      String(a.root || '').localeCompare(String(b.root || ''))
    ));
  const payload = {
    schemaVersion: 1,
    name: typeof resolvedWorkspace?.name === 'string' ? resolvedWorkspace.name.trim() : '',
    cacheRoot: resolvedWorkspace?.cacheRoot || null,
    defaults: {
      enabled: Boolean(resolvedWorkspace?.defaults?.enabled),
      priority: Number.isInteger(resolvedWorkspace?.defaults?.priority) ? resolvedWorkspace.defaults.priority : 0,
      tags: Array.isArray(resolvedWorkspace?.defaults?.tags) ? [...resolvedWorkspace.defaults.tags] : []
    },
    repos
  };
  return `wsc1-${sha1(stableStringify(payload))}`;
};

export const resolveRepoEntry = (workspaceDir, repoEntry, index, {
  defaults,
  platform = process.platform
} = {}, issues = []) => {
  const entryPath = `$.repos[${index}]`;
  if (!isPlainObject(repoEntry)) {
    issues.push(createWorkspaceIssue(
      WORKSPACE_ERROR_CODES.INVALID_SHAPE,
      `${entryPath} must be an object.`,
      {
        path: entryPath,
        field: 'repos',
        reason: 'type',
        hint: 'Use an object with root/alias/enabled/priority/tags fields.'
      }
    ));
    return null;
  }
  collectUnknownKeys(issues, repoEntry, REPO_KEYS, entryPath);

  const rootInput = typeof repoEntry.root === 'string' ? repoEntry.root.trim() : '';
  if (!rootInput) {
    issues.push(createWorkspaceIssue(
      WORKSPACE_ERROR_CODES.INVALID_SHAPE,
      `${entryPath}.root must be a non-empty string.`,
      {
        path: `${entryPath}.root`,
        field: 'root',
        reason: 'required',
        hint: 'Set root to an absolute path or a path relative to the workspace file.'
      }
    ));
    return null;
  }

  const rootAbs = path.isAbsolute(rootInput) ? path.resolve(rootInput) : path.resolve(workspaceDir, rootInput);
  if (!fs.existsSync(rootAbs)) {
    issues.push(createWorkspaceIssue(
      WORKSPACE_ERROR_CODES.REPO_ROOT_NOT_FOUND,
      `Workspace repo root not found: ${rootAbs}`,
      {
        path: `${entryPath}.root`,
        field: 'root',
        reason: 'missing',
        hint: 'Create the path or fix the root value in the workspace file.'
      }
    ));
    return null;
  }
  let rootStat = null;
  try {
    rootStat = fs.statSync(rootAbs);
  } catch {
    rootStat = null;
  }
  if (!rootStat?.isDirectory?.()) {
    issues.push(createWorkspaceIssue(
      WORKSPACE_ERROR_CODES.REPO_ROOT_NOT_DIRECTORY,
      `Workspace repo root must be a directory: ${rootAbs}`,
      {
        path: `${entryPath}.root`,
        field: 'root',
        reason: 'not-directory',
        hint: 'Point root at a repository directory, not a file path.'
      }
    ));
    return null;
  }

  const repoRootResolved = resolveRepoRoot(rootAbs);
  const repoRootCanonical = toRealPathSync(repoRootResolved, { platform });
  if (!repoRootCanonical) {
    issues.push(createWorkspaceIssue(
      WORKSPACE_ERROR_CODES.REPO_ROOT_NOT_FOUND,
      `Workspace repo root could not be resolved for ${rootAbs}`,
      {
        path: `${entryPath}.root`,
        field: 'root',
        reason: 'resolve-failed',
        hint: 'Verify the directory exists and is readable.'
      }
    ));
    return null;
  }

  const repoId = getRepoId(repoRootCanonical);
  const alias = normalizeAlias(repoEntry.alias, `${entryPath}.alias`, issues);
  const tags = normalizeTags(
    repoEntry.tags,
    defaults.tags,
    `${entryPath}.tags`,
    issues
  );
  const enabled = normalizeBoolean(
    repoEntry.enabled,
    defaults.enabled,
    `${entryPath}.enabled`,
    issues,
    'enabled'
  );
  const priority = normalizeInteger(
    repoEntry.priority,
    defaults.priority,
    `${entryPath}.priority`,
    issues,
    'priority'
  );

  return {
    repoId,
    repoRootResolved: normalizeIdentityPath(repoRootResolved, { platform }),
    repoRootCanonical,
    alias,
    tags,
    enabled,
    priority,
    rootInput,
    rootAbs: normalizeIdentityPath(rootAbs, { platform }),
    index
  };
};

const validateUniqueness = (repos, issues) => {
  const byCanonical = new Map();
  const byRepoId = new Map();
  const byAlias = new Map();

  for (const repo of repos) {
    const existingCanonical = byCanonical.get(repo.repoRootCanonical);
    if (existingCanonical) {
      issues.push(createWorkspaceIssue(
        WORKSPACE_ERROR_CODES.DUPLICATE_REPO_ROOT,
        `Duplicate canonical repo root: ${repo.repoRootCanonical}`,
        {
          path: `$.repos[${repo.index}]`,
          field: 'root',
          reason: 'duplicate',
          hint: `Already declared at $.repos[${existingCanonical.index}].`
        }
      ));
    } else {
      byCanonical.set(repo.repoRootCanonical, repo);
    }

    const existingRepoId = byRepoId.get(repo.repoId);
    if (existingRepoId) {
      issues.push(createWorkspaceIssue(
        WORKSPACE_ERROR_CODES.DUPLICATE_REPO_ID,
        `Duplicate repoId "${repo.repoId}" detected.`,
        {
          path: `$.repos[${repo.index}]`,
          field: 'repoId',
          reason: 'duplicate',
          hint: `Conflicts with $.repos[${existingRepoId.index}].`
        }
      ));
    } else {
      byRepoId.set(repo.repoId, repo);
    }

    if (repo.alias) {
      const aliasKey = repo.alias.toLowerCase();
      const existingAlias = byAlias.get(aliasKey);
      if (existingAlias) {
        issues.push(createWorkspaceIssue(
          WORKSPACE_ERROR_CODES.DUPLICATE_ALIAS,
          `Duplicate alias "${repo.alias}" (case-insensitive).`,
          {
            path: `$.repos[${repo.index}].alias`,
            field: 'alias',
            reason: 'duplicate',
            hint: `Conflicts with $.repos[${existingAlias.index}].alias.`
          }
        ));
      } else {
        byAlias.set(aliasKey, repo);
      }
    }
  }
};

export const loadWorkspaceConfig = (workspacePath, {
  platform = process.platform
} = {}) => {
  const targetPath = typeof workspacePath === 'string' && workspacePath.trim()
    ? path.resolve(workspacePath)
    : '';
  if (!targetPath || !fs.existsSync(targetPath)) {
    throwWorkspaceIssues([
      createWorkspaceIssue(
        WORKSPACE_ERROR_CODES.FILE_NOT_FOUND,
        `Workspace file not found: ${targetPath || '<empty>'}`,
        {
          path: targetPath || null,
          field: 'workspacePath',
          reason: 'missing',
          hint: `Provide an existing workspace file path (for example ${WORKSPACE_CONFIG_DEFAULT_FILENAME}).`
        }
      )
    ]);
  }

  let parsed = null;
  try {
    parsed = readJsoncFile(targetPath);
  } catch (err) {
    throwWorkspaceIssues([
      createWorkspaceIssue(
        WORKSPACE_ERROR_CODES.PARSE_FAILED,
        `Failed to parse workspace config: ${targetPath}`,
        {
          path: targetPath,
          field: 'workspaceFile',
          reason: err?.message || 'parse-error',
          hint: 'Fix JSONC syntax errors and retry.'
        }
      )
    ]);
  }

  if (!isPlainObject(parsed)) {
    throwWorkspaceIssues([
      createWorkspaceIssue(
        WORKSPACE_ERROR_CODES.ROOT_NOT_OBJECT,
        'Workspace config root must be an object.',
        {
          path: targetPath,
          field: 'root',
          reason: 'type',
          hint: 'Use a JSONC object at the top level.'
        }
      )
    ]);
  }

  const issues = [];
  const workspaceDir = path.dirname(targetPath);
  collectUnknownKeys(issues, parsed, TOP_LEVEL_KEYS, '$');

  const schemaVersion = parsed.schemaVersion;
  if (!Number.isInteger(schemaVersion) || schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    issues.push(createWorkspaceIssue(
      WORKSPACE_ERROR_CODES.SCHEMA_VERSION,
      `Unsupported schemaVersion: ${schemaVersion ?? 'missing'}. Supported version: ${SUPPORTED_SCHEMA_VERSION}.`,
      {
        path: '$.schemaVersion',
        field: 'schemaVersion',
        reason: 'unsupported',
        hint: `Set schemaVersion to ${SUPPORTED_SCHEMA_VERSION}.`
      }
    ));
  }

  const name = typeof parsed.name === 'string'
    ? parsed.name.trim()
    : (parsed.name == null ? '' : (() => {
      issues.push(createWorkspaceIssue(
        WORKSPACE_ERROR_CODES.INVALID_SHAPE,
        '$.name must be a string when provided.',
        {
          path: '$.name',
          field: 'name',
          reason: 'type',
          hint: 'Use a string workspace name.'
        }
      ));
      return '';
    })());

  const defaults = normalizeDefaults(parsed.defaults, issues);
  const cacheRoot = resolveCacheRoot(parsed.cacheRoot, workspaceDir, issues);

  const reposRaw = parsed.repos;
  if (!Array.isArray(reposRaw) || reposRaw.length === 0) {
    issues.push(createWorkspaceIssue(
      WORKSPACE_ERROR_CODES.REPOS_EMPTY,
      'Workspace repos must be a non-empty array.',
      {
        path: '$.repos',
        field: 'repos',
        reason: 'required',
        hint: 'Add at least one repo entry.'
      }
    ));
  }

  const reposResolved = [];
  if (Array.isArray(reposRaw)) {
    for (let index = 0; index < reposRaw.length; index += 1) {
      const resolved = resolveRepoEntry(workspaceDir, reposRaw[index], index, {
        defaults,
        platform
      }, issues);
      if (resolved) reposResolved.push(resolved);
    }
  }

  validateUniqueness(reposResolved, issues);
  if (issues.length) throwWorkspaceIssues(issues);

  const resolved = {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    workspacePath: normalizeIdentityPath(targetPath, { platform }),
    workspaceDir: normalizeIdentityPath(workspaceDir, { platform }),
    name,
    cacheRoot: cacheRoot ? normalizeIdentityPath(cacheRoot, { platform }) : null,
    defaults,
    repos: reposResolved,
    repoSetId: computeRepoSetId(reposResolved)
  };
  resolved.workspaceConfigHash = computeWorkspaceConfigHash(resolved);
  const validation = validateWorkspaceConfigResolved(resolved);
  if (!validation.ok) {
    throwWorkspaceIssues(validation.errors.map((message, index) => (
      createWorkspaceIssue(
        WORKSPACE_ERROR_CODES.INVALID_SHAPE,
        `Resolved workspace contract validation failed (${index + 1}/${validation.errors.length}): ${message}`,
        {
          path: '$',
          field: 'workspace',
          reason: 'schema',
          hint: 'Update workspace loader output to match contract schema.'
        }
      )
    )));
  }
  return resolved;
};

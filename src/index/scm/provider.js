import { SCM_PROVIDER_NAMES } from './types.js';

const REQUIRED_METHODS = [
  'detect',
  'listTrackedFiles',
  'getRepoProvenance',
  'getChangedFiles',
  'getFileMeta'
];

const OPTIONAL_METHODS = ['annotate'];
const FILE_LIST_UNAVAILABLE_REASONS = new Set(['unavailable']);
const CHANGED_FILES_UNAVAILABLE_REASONS = new Set(['unsupported', 'unavailable']);
const FILE_META_UNAVAILABLE_REASONS = new Set(['unsupported', 'unavailable']);
const ANNOTATE_UNAVAILABLE_REASONS = new Set(['disabled', 'unsupported', 'timeout', 'unavailable']);

export const normalizeProviderName = (value) => {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SCM_PROVIDER_NAMES.includes(name) ? name : null;
};

export const assertScmProvider = (provider) => {
  if (!provider || typeof provider !== 'object') {
    throw new Error('SCM provider must be an object.');
  }
  const name = normalizeProviderName(provider.name);
  if (!name) {
    throw new Error('SCM provider name is missing or invalid.');
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`SCM provider ${name} missing ${method}().`);
    }
  }
  for (const method of OPTIONAL_METHODS) {
    if (provider[method] != null && typeof provider[method] !== 'function') {
      throw new Error(`SCM provider ${name} ${method} must be a function.`);
    }
  }
  const normalizeReason = (result, allowedReasons, fallbackReason = 'unavailable') => {
    const reason = typeof result?.reason === 'string' ? result.reason : '';
    return {
      ok: false,
      reason: allowedReasons.has(reason) ? reason : fallbackReason
    };
  };
  const normalizeFileList = (result, allowedReasons) => {
    if (result && Array.isArray(result.filesPosix)) {
      const filesPosix = Array.from(new Set(
        result.filesPosix
          .map((entry) => String(entry || '').replace(/\\/g, '/'))
          .filter(Boolean)
      )).sort((a, b) => a.localeCompare(b));
      return { filesPosix };
    }
    return normalizeReason(result, allowedReasons);
  };
  const normalizeFileMeta = (result) => {
    if (result && result.ok === false) {
      return normalizeReason(result, FILE_META_UNAVAILABLE_REASONS);
    }
    const meta = result && typeof result === 'object' ? result : {};
    return {
      lastModifiedAt: typeof meta.lastModifiedAt === 'string' ? meta.lastModifiedAt : null,
      lastAuthor: typeof meta.lastAuthor === 'string' ? meta.lastAuthor : null,
      churn: Number.isFinite(meta.churn) ? Number(meta.churn) : null,
      churnAdded: Number.isFinite(meta.churnAdded) ? Number(meta.churnAdded) : null,
      churnDeleted: Number.isFinite(meta.churnDeleted) ? Number(meta.churnDeleted) : null,
      churnCommits: Number.isFinite(meta.churnCommits) ? Number(meta.churnCommits) : null
    };
  };
  const normalizeProvenance = (result, input) => {
    const root = typeof result?.root === 'string'
      ? result.root
      : (typeof input?.repoRoot === 'string' ? input.repoRoot : '');
    const head = result?.head && typeof result.head === 'object' ? result.head : null;
    const bookmarks = Array.isArray(result?.bookmarks) ? [...result.bookmarks].sort((a, b) => a.localeCompare(b)) : null;
    return {
      provider: name,
      root,
      head: head ? {
        commitId: typeof head.commitId === 'string' ? head.commitId : null,
        changeId: typeof head.changeId === 'string' ? head.changeId : null,
        operationId: typeof head.operationId === 'string' ? head.operationId : null,
        branch: typeof head.branch === 'string' ? head.branch : null,
        bookmarks: Array.isArray(head.bookmarks) ? [...head.bookmarks].sort((a, b) => a.localeCompare(b)) : bookmarks,
        author: typeof head.author === 'string' ? head.author : null,
        timestamp: typeof head.timestamp === 'string' ? head.timestamp : null
      } : null,
      dirty: typeof result?.dirty === 'boolean' ? result.dirty : null,
      detectedBy: typeof result?.detectedBy === 'string' ? result.detectedBy : null,
      commit: typeof result?.commit === 'string' ? result.commit : (typeof head?.commitId === 'string' ? head.commitId : null),
      branch: typeof result?.branch === 'string' ? result.branch : (typeof head?.branch === 'string' ? head.branch : null),
      isRepo: typeof result?.isRepo === 'boolean' ? result.isRepo : (name === 'none' ? false : null),
      bookmarks
    };
  };
  const wrapped = {
    ...provider,
    name,
    detect(input) {
      try {
        const result = provider.detect(input);
        if (result && result.ok && typeof result.repoRoot === 'string' && result.repoRoot) {
          return {
            ok: true,
            provider: name,
            repoRoot: result.repoRoot,
            detectedBy: typeof result.detectedBy === 'string' ? result.detectedBy : null
          };
        }
        return { ok: false };
      } catch {
        return { ok: false };
      }
    },
    async listTrackedFiles(input) {
      try {
        const result = await Promise.resolve(provider.listTrackedFiles(input));
        return normalizeFileList(result, FILE_LIST_UNAVAILABLE_REASONS);
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
    },
    async getRepoProvenance(input) {
      try {
        const result = await Promise.resolve(provider.getRepoProvenance(input));
        return normalizeProvenance(result, input);
      } catch {
        return normalizeProvenance(null, input);
      }
    },
    async getChangedFiles(input) {
      try {
        const result = await Promise.resolve(provider.getChangedFiles(input));
        return normalizeFileList(result, CHANGED_FILES_UNAVAILABLE_REASONS);
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
    },
    async getFileMeta(input) {
      try {
        const result = await Promise.resolve(provider.getFileMeta(input));
        return normalizeFileMeta(result);
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
    }
  };
  if (typeof provider.annotate === 'function') {
    wrapped.annotate = async (input) => {
      try {
        const result = await Promise.resolve(provider.annotate(input));
        if (result && Array.isArray(result.lines)) {
          const lines = result.lines
            .map((entry, index) => ({
              line: Number.isFinite(Number(entry?.line)) ? Math.max(1, Math.floor(Number(entry.line))) : index + 1,
              author: String(entry?.author || 'unknown'),
              commitId: entry?.commitId ? String(entry.commitId) : null
            }))
            .sort((a, b) => a.line - b.line);
          return { lines };
        }
        return normalizeReason(result, ANNOTATE_UNAVAILABLE_REASONS);
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
    };
  }
  return wrapped;
};

import { SCM_PROVIDER_NAMES } from './types.js';

const REQUIRED_METHODS = [
  'detect',
  'listTrackedFiles',
  'getRepoProvenance',
  'getChangedFiles',
  'getFileMeta'
];

const OPTIONAL_METHODS = ['annotate', 'getFileMetaBatch'];
const ADAPTER_MODES = Object.freeze(['parity', 'experimental', 'disabled']);
const DEFAULT_ADAPTER_MODE_BY_PROVIDER = Object.freeze({
  git: 'parity',
  jj: 'experimental',
  none: 'disabled'
});
const DEFAULT_METADATA_CAPABILITIES = Object.freeze({
  author: false,
  time: false,
  branch: false,
  churn: false,
  commitId: false,
  changeId: false,
  operationId: false,
  bookmarks: false,
  annotateCommitId: false
});
const FILE_LIST_UNAVAILABLE_REASONS = new Set(['unavailable']);
const CHANGED_FILES_UNAVAILABLE_REASONS = new Set(['unsupported', 'unavailable']);
const FILE_META_UNAVAILABLE_REASONS = new Set(['unsupported', 'unavailable']);
const ANNOTATE_UNAVAILABLE_REASONS = new Set(['disabled', 'unsupported', 'timeout', 'unavailable']);
const FILE_META_BATCH_UNAVAILABLE_REASONS = new Set(['unsupported', 'unavailable']);

const normalizeMetadataCapabilities = (value) => {
  const candidate = value && typeof value === 'object'
    ? { ...DEFAULT_METADATA_CAPABILITIES, ...value }
    : DEFAULT_METADATA_CAPABILITIES;
  return Object.freeze({
    author: candidate.author === true,
    time: candidate.time === true,
    branch: candidate.branch === true,
    churn: candidate.churn === true,
    commitId: candidate.commitId === true,
    changeId: candidate.changeId === true,
    operationId: candidate.operationId === true,
    bookmarks: candidate.bookmarks === true,
    annotateCommitId: candidate.annotateCommitId === true
  });
};

const normalizeAdapterMode = (value, providerName) => {
  const raw = typeof value === 'string'
    ? value
    : (value && typeof value === 'object' ? value.mode : '');
  const mode = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (ADAPTER_MODES.includes(mode)) return mode;
  return DEFAULT_ADAPTER_MODE_BY_PROVIDER[providerName] || 'experimental';
};

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
  if (provider.metadataCapabilities != null && (
    typeof provider.metadataCapabilities !== 'object' || Array.isArray(provider.metadataCapabilities)
  )) {
    throw new Error(`SCM provider ${name} metadataCapabilities must be an object.`);
  }
  const metadataCapabilities = normalizeMetadataCapabilities(provider.metadataCapabilities);
  const adapter = normalizeAdapterMode(provider.adapter, name);
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
  const normalizeFileMetaValue = (meta) => {
    const value = meta && typeof meta === 'object' ? meta : {};
    return {
      lastCommitId: metadataCapabilities.commitId && typeof value.lastCommitId === 'string'
        ? value.lastCommitId
        : null,
      lastModifiedAt: metadataCapabilities.time && typeof value.lastModifiedAt === 'string'
        ? value.lastModifiedAt
        : null,
      lastAuthor: metadataCapabilities.author && typeof value.lastAuthor === 'string'
        ? value.lastAuthor
        : null,
      churn: metadataCapabilities.churn && Number.isFinite(value.churn) ? Number(value.churn) : null,
      churnAdded: metadataCapabilities.churn && Number.isFinite(value.churnAdded)
        ? Number(value.churnAdded)
        : null,
      churnDeleted: metadataCapabilities.churn && Number.isFinite(value.churnDeleted)
        ? Number(value.churnDeleted)
        : null,
      churnCommits: metadataCapabilities.churn && Number.isFinite(value.churnCommits)
        ? Number(value.churnCommits)
        : null
    };
  };
  const normalizeFileMeta = (result) => {
    if (result && result.ok === false) {
      return normalizeReason(result, FILE_META_UNAVAILABLE_REASONS);
    }
    return normalizeFileMetaValue(result);
  };
  const normalizeFileMetaBatch = (result) => {
    if (result && result.ok === false) {
      return normalizeReason(result, FILE_META_BATCH_UNAVAILABLE_REASONS);
    }
    const source = result?.fileMetaByPath;
    const entries = source && typeof source === 'object'
      ? Object.entries(source)
      : [];
    const fileMetaByPath = Object.create(null);
    for (const [rawPath, rawMeta] of entries) {
      const key = String(rawPath || '').replace(/\\/g, '/').trim();
      if (!key) continue;
      fileMetaByPath[key] = normalizeFileMetaValue(rawMeta);
    }
    return { fileMetaByPath };
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
        commitId: metadataCapabilities.commitId && typeof head.commitId === 'string'
          ? head.commitId
          : null,
        changeId: metadataCapabilities.changeId && typeof head.changeId === 'string'
          ? head.changeId
          : null,
        operationId: metadataCapabilities.operationId && typeof head.operationId === 'string'
          ? head.operationId
          : null,
        branch: metadataCapabilities.branch && typeof head.branch === 'string'
          ? head.branch
          : null,
        bookmarks: metadataCapabilities.bookmarks
          ? (Array.isArray(head.bookmarks) ? [...head.bookmarks].sort((a, b) => a.localeCompare(b)) : bookmarks)
          : null,
        author: metadataCapabilities.author && typeof head.author === 'string'
          ? head.author
          : null,
        timestamp: metadataCapabilities.time && typeof head.timestamp === 'string'
          ? head.timestamp
          : null
      } : null,
      dirty: typeof result?.dirty === 'boolean' ? result.dirty : null,
      detectedBy: typeof result?.detectedBy === 'string' ? result.detectedBy : null,
      commit: metadataCapabilities.commitId
        ? (typeof result?.commit === 'string' ? result.commit : (typeof head?.commitId === 'string' ? head.commitId : null))
        : null,
      branch: metadataCapabilities.branch
        ? (typeof result?.branch === 'string' ? result.branch : (typeof head?.branch === 'string' ? head.branch : null))
        : null,
      isRepo: typeof result?.isRepo === 'boolean' ? result.isRepo : (name === 'none' ? false : null),
      bookmarks: metadataCapabilities.bookmarks ? bookmarks : null
    };
  };
  const wrapped = {
    ...provider,
    name,
    adapter,
    metadataCapabilities,
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
              author: metadataCapabilities.author ? String(entry?.author || 'unknown') : 'unknown',
              commitId: metadataCapabilities.annotateCommitId && entry?.commitId ? String(entry.commitId) : null
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
  if (typeof provider.getFileMetaBatch === 'function') {
    wrapped.getFileMetaBatch = async (input) => {
      try {
        const result = await Promise.resolve(provider.getFileMetaBatch(input));
        return normalizeFileMetaBatch(result);
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
    };
  }
  return wrapped;
};

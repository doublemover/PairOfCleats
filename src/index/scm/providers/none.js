const unsupported = { ok: false, reason: 'unsupported' };

export const noneProvider = {
  name: 'none',
  detect() {
    return { ok: false };
  },
  listTrackedFiles() {
    return { filesPosix: [] };
  },
  getRepoProvenance({ repoRoot }) {
    return {
      provider: 'none',
      root: repoRoot,
      head: null,
      dirty: null,
      detectedBy: 'none',
      isRepo: false
    };
  },
  getChangedFiles() {
    return unsupported;
  },
  getFileMeta() {
    return unsupported;
  },
  annotate() {
    return { ok: false, reason: 'disabled' };
  }
};

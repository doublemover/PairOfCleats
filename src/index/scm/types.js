/**
 * @typedef {'git'|'jj'|'none'} ScmProviderName
 */

/**
 * @typedef {{
 *  commitId?: string|null,
 *  changeId?: string|null,
 *  operationId?: string|null,
 *  branch?: string|null,
 *  bookmarks?: string[]|null,
 *  author?: string|null,
 *  timestamp?: string|null
 * }} ScmRepoHead
 */

/**
 * @typedef {{
 *  provider: ScmProviderName,
 *  root: string,
 *  head: ScmRepoHead|null,
 *  dirty: boolean|null,
 *  detectedBy?: string|null,
 *  commit?: string|null,
 *  branch?: string|null,
 *  isRepo?: boolean|null,
 *  bookmarks?: string[]|null
 * }} ScmRepoProvenance
 */

/**
 * @typedef {{
 *  ok: true,
 *  provider: ScmProviderName,
 *  repoRoot: string,
 *  detectedBy?: string|null
 * } | { ok: false }} ScmDetectResult
 */

/**
 * @typedef {{
 *  filesPosix: string[]
 * }} ScmFileList
 */

/**
 * @typedef {{
 *  ok: false,
 *  reason: 'unsupported'|'unavailable'|'disabled'|'timeout'
 * }} ScmUnavailable
 */

/**
 * @typedef {{
 *  lastModifiedAt?: string|null,
 *  lastAuthor?: string|null,
 *  churn?: number|null,
 *  churnAdded?: number|null,
 *  churnDeleted?: number|null,
 *  churnCommits?: number|null,
 *  lineAuthors?: string[]|null
 * }} ScmFileMeta
 */

/**
 * @typedef {{
 *  line: number,
 *  author: string,
 *  commitId?: string|null
 * }} ScmAnnotateLine
 */

/**
 * @typedef {{
 *  lines: ScmAnnotateLine[]
 * }} ScmAnnotateResult
 */

/**
 * @typedef {{
 *  name: ScmProviderName,
 *  detect: (input: { startPath: string }) => Promise<ScmDetectResult> | ScmDetectResult,
 *  listTrackedFiles: (input: { repoRoot: string, subdir?: string|null }) => Promise<ScmFileList> | ScmFileList,
 *  getRepoProvenance: (input: { repoRoot: string }) => Promise<ScmRepoProvenance> | ScmRepoProvenance,
 *  getChangedFiles: (input: { repoRoot: string, fromRef?: string|null, toRef?: string|null, subdir?: string|null }) => Promise<ScmFileList|ScmUnavailable> | ScmFileList|ScmUnavailable,
 *  getFileMeta: (input: { repoRoot: string, filePosix: string }) => Promise<ScmFileMeta|ScmUnavailable> | ScmFileMeta|ScmUnavailable,
 *  annotate?: (input: { repoRoot: string, filePosix: string, timeoutMs: number }) => Promise<ScmAnnotateResult|ScmUnavailable> | ScmAnnotateResult|ScmUnavailable
 * }} ScmProvider
 */

export const SCM_PROVIDER_NAMES = Object.freeze(['git', 'jj', 'none']);

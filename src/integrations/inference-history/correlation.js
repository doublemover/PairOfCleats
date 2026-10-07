import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { devNull } from 'node:os';
import { spawnSubprocess } from '../../shared/subprocess/runner.js';
import { digest, historyError, redactHistoryText } from './common.js';

const invalid = () => historyError('ERR_INFERENCE_HISTORY_CODE_SCOPE', 'Invalid authorized code scope.');

export function validateCodeAccess(access) {
  if (!access || typeof access.policyEpoch !== 'string' || !access.policyEpoch
    || !Array.isArray(access.repositories) || access.repositories.length > 8) throw invalid();
  const seen = new Set();
  for (const repo of access.repositories) {
    if (typeof repo.repositoryId !== 'string' || !repo.repositoryId || seen.has(repo.repositoryId)
      || typeof repo.root !== 'string' || !path.isAbsolute(repo.root)
      || !Array.isArray(repo.markdownPaths) || repo.markdownPaths.length > 64
      || repo.markdownPaths.some((value) => typeof value !== 'string' || path.isAbsolute(value)
        || !/\.md$/i.test(value) || value.split(/[\\/]/).includes('..'))) throw invalid();
    seen.add(repo.repositoryId);
  }
  return access;
}

async function git(root, args, signal) {
  // Read object data only, without config-driven pagers, replacement objects,
  // ambient GIT_DIR overrides, textconv, external diffs or network operations.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull,
    GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' });
  const result = await spawnSubprocess('git', ['--no-pager', '--no-replace-objects', '-C', root, ...args], {
    env, signal, timeoutMs: 2000, maxOutputBytes: 64 * 1024, rejectOnNonZeroExit: false,
    outputMode: 'string'
  });
  return result.exitCode === 0 ? String(result.stdout).trim() : null;
}

/** Exact identifier evidence only. Similarity/time never establish implementation. */
export async function correlateAuthorizedCode(text, access, { signal } = {}) {
  validateCodeAccess(access);
  signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
  const commits = [...new Set(text.match(/\b[a-f0-9]{7,64}\b/gi) || [])].slice(0, 32);
  const tasks = [...new Set(text.match(/\b[A-Z][A-Z0-9]{1,15}-[0-9]+\b/g) || [])].slice(0, 32);
  const references = [...commits, ...tasks];
  const relations = [];
  for (const repo of access.repositories) {
    signal.throwIfAborted();
    const root = await fs.realpath(repo.root);
    if (root !== path.resolve(repo.root)) throw invalid();
    for (const mention of commits) {
      const oid = await git(root, ['rev-parse', '--verify', '--quiet', `${mention}^{object}`], signal);
      if (!oid || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(oid)) continue;
      if (await git(root, ['cat-file', '-t', oid], signal) !== 'commit') continue;
      const details = await git(root, ['show', '-s', '--format=%H%n%T%n%P%n%aI%n%cI%n%s', oid, '--'], signal);
      if (!details) continue;
      const [verifiedOid, treeOid, parents, authorTime, committerTime, ...subject] = details.split('\n');
      if (verifiedOid !== oid) continue;
      relations.push({ kind: 'references_commit', repositoryId: repo.repositoryId,
        mention, state: 'verified_object', oid, treeOid, parents: parents ? parents.split(' ') : [],
        authorTime, committerTime, subject: redactHistoryText(subject.join('\n')).slice(0, 512),
        basis: 'exact_identifier_and_local_git_object', implementationClaim: false });
    }
    for (const relative of repo.markdownPaths) {
      signal.throwIfAborted();
      const file = path.resolve(root, relative);
      if (!file.startsWith(`${root}${path.sep}`) || await fs.realpath(file) !== file) throw invalid();
      const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 256 * 1024) throw invalid();
        const buffer = Buffer.alloc(256 * 1024 + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 256 * 1024) throw invalid();
        const bytes = buffer.subarray(0, bytesRead);
        const current = await fs.lstat(file);
        if (current.isSymbolicLink() || current.dev !== stat.dev || current.ino !== stat.ino
          || current.size !== stat.size || current.mtimeMs !== stat.mtimeMs
          || await fs.realpath(file) !== file || await fs.realpath(repo.root) !== root) throw invalid();
        const revision = digest(bytes);
        const lines = bytes.toString('utf8').split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          if (relations.length >= 256) break;
          const matches = references.filter((reference) => {
            const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, 'i').test(lines[index]);
          });
          if (!matches.length) continue;
          relations.push({ kind: 'markdown_reference', repositoryId: repo.repositoryId,
            path: relative, line: index + 1, revision, mentions: matches,
            excerpt: redactHistoryText(lines[index]).slice(0, 512),
            basis: 'exact_identifier_in_working_tree', implementationClaim: false });
        }
      } finally { await handle.close(); }
    }
  }
  return { relations, unresolvedCommitMentions: commits.filter((mention) =>
    !relations.some((relation) => relation.kind === 'references_commit' && relation.mention === mention)),
  truncatedMentions: (text.match(/\b[a-f0-9]{7,64}\b/gi) || []).length > 32 };
}

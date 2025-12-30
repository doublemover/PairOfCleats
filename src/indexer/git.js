import simpleGit from 'simple-git';

const gitMetaCache = new Map();

/**
 * Fetch git metadata for a file/chunk (author, date, churn, blame authors).
 * Returns empty object when git is unavailable or fails.
 * @param {string} file
 * @param {number} [start]
 * @param {number} [end]
 * @param {{blame?:boolean}} [options]
 * @returns {Promise<{last_modified?:string,last_author?:string,churn?:number,chunk_authors?:string[]}|{}>}
 */
export async function getGitMeta(file, start = 0, end = 0, options = {}) {
  const blameEnabled = options.blame !== false;
  if (gitMetaCache.has(file)) {
    const cached = gitMetaCache.get(file);
    if (!blameEnabled) return cached;
    let blameData = {};
    try {
      const git = simpleGit();
      const blame = await git.raw(['blame', '-L', `${start + 1},${end + 1}`, file]);
      const authors = new Set();
      for (const line of blame.split('\n')) {
        const m = line.match(/^\^?\w+\s+\(([^)]+)\s+\d{4}/);
        if (m) authors.add(m[1].trim());
      }
      blameData = { chunk_authors: Array.from(authors) };
    } catch {}
    return {
      ...cached,
      ...blameData
    };
  }

  try {
    const git = simpleGit();
    const log = await git.log({ file, n: 10 });
    const { added, deleted } = await computeNumstatChurn(git, file, log.all.length || 10);
    const churn = added + deleted;
    const meta = {
      last_modified: log.latest?.date || null,
      last_author: log.latest?.author_name || null,
      churn,
      churn_added: added,
      churn_deleted: deleted,
      churn_commits: log.all.length || 0
    };
    gitMetaCache.set(file, meta);
    let blameData = {};
    if (blameEnabled) {
      try {
        const blame = await git.raw(['blame', '-L', `${start + 1},${end + 1}`, file]);
        const authors = new Set();
        for (const line of blame.split('\n')) {
          const m = line.match(/^\^?\w+\s+\(([^)]+)\s+\d{4}/);
          if (m) authors.add(m[1].trim());
        }
        blameData = { chunk_authors: Array.from(authors) };
      } catch {}
    }

    return {
      ...meta,
      ...blameData
    };
  } catch {
    return {};
  }
}

/**
 * Compute churn from git numstat output.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} file
 * @param {number} limit
 * @returns {Promise<{added:number,deleted:number}>}
 */
async function computeNumstatChurn(git, file, limit) {
  try {
    const raw = await git.raw(['log', '--numstat', '-n', String(limit), '--format=', '--', file]);
    let added = 0;
    let deleted = 0;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split('\t');
      if (parts.length < 2) continue;
      const addedVal = parts[0] === '-' ? 0 : Number.parseInt(parts[0], 10);
      const deletedVal = parts[1] === '-' ? 0 : Number.parseInt(parts[1], 10);
      if (Number.isFinite(addedVal)) added += addedVal;
      if (Number.isFinite(deletedVal)) deleted += deletedVal;
    }
    return { added, deleted };
  } catch {
    return { added: 0, deleted: 0 };
  }
}

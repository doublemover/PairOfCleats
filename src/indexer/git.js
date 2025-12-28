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
        const m = line.match(/^\w+\s+\(([^)]+)\s+\d{4}/);
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
    let churn = 0;
    for (const c of log.all) {
      churn += c.body ? c.body.length : 0;
    }
    const meta = {
      last_modified: log.latest?.date || null,
      last_author: log.latest?.author_name || null,
      churn
    };
    gitMetaCache.set(file, meta);
    let blameData = {};
    if (blameEnabled) {
      try {
        const blame = await git.raw(['blame', '-L', `${start + 1},${end + 1}`, file]);
        const authors = new Set();
        for (const line of blame.split('\n')) {
          const m = line.match(/^\w+\s+\(([^)]+)\s+\d{4}/);
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

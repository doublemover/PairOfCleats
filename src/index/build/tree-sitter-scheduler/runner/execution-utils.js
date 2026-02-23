import fs from 'node:fs/promises';

/**
 * Load subprocess profile rows and eagerly remove profile artifact.
 *
 * @param {string|null|undefined} profilePath
 * @returns {Promise<object[]>}
 */
export const loadSubprocessProfile = async (profilePath) => {
  if (!profilePath) return [];
  try {
    const raw = JSON.parse(await fs.readFile(profilePath, 'utf8'));
    const fields = raw?.fields && typeof raw.fields === 'object' ? raw.fields : raw;
    const rows = Array.isArray(fields?.rows) ? fields.rows : [];
    return rows.filter((row) => row && typeof row === 'object');
  } catch {
    return [];
  } finally {
    try { await fs.rm(profilePath, { force: true }); } catch {}
  }
};

/**
 * Buffer chunked subprocess output into complete lines.
 *
 * Child process stream chunks can split lines arbitrarily. We only forward
 * complete lines to the parent logger so progress rendering stays stable and
 * does not interleave partial fragments with TTY redraw output.
 *
 * @param {(line: string) => void} onLine
 * @returns {{ push: (text: string) => void, flush: () => void }}
 */
export const createLineBuffer = (onLine) => {
  let buffer = '';
  return {
    push(text) {
      buffer += String(text || '');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        onLine(trimmed);
      }
    },
    flush() {
      const trimmed = buffer.trim();
      if (trimmed) onLine(trimmed);
      buffer = '';
    }
  };
};

/**
 * Aggregate planned segment metadata grouped by container path.
 *
 * @param {Array<object>} groups
 * @returns {Map<string, Array<object>>}
 */
export const buildPlannedSegmentsByContainer = (groups) => {
  const byContainer = new Map();
  const seen = new Map();
  const entries = Array.isArray(groups) ? groups : [];
  for (const group of entries) {
    const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
    for (const job of jobs) {
      const containerPath = typeof job?.containerPath === 'string' ? job.containerPath : null;
      const segment = job?.segment && typeof job.segment === 'object' ? job.segment : null;
      if (!containerPath || !segment) continue;
      const start = Number(segment.start);
      const end = Number(segment.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      const segmentUid = segment.segmentUid || null;
      const dedupeKey = `${containerPath}|${segmentUid || ''}|${start}:${end}`;
      if (seen.has(dedupeKey)) continue;
      seen.set(dedupeKey, true);
      const target = byContainer.get(containerPath) || [];
      target.push({
        ...segment,
        start,
        end
      });
      byContainer.set(containerPath, target);
    }
  }
  for (const segments of byContainer.values()) {
    segments.sort((a, b) => (a.start - b.start) || (a.end - b.end));
  }
  return byContainer;
};

/**
 * Build the set of language ids participating in scheduled parsing.
 *
 * @param {Array<object>} groups
 * @returns {Set<string>}
 */
export const buildScheduledLanguageSet = (groups) => {
  const scheduled = new Set();
  const entries = Array.isArray(groups) ? groups : [];
  for (const group of entries) {
    const languages = Array.isArray(group?.languages) ? group.languages : [];
    for (const languageId of languages) {
      if (typeof languageId !== 'string' || !languageId) continue;
      scheduled.add(languageId);
    }
  }
  return scheduled;
};

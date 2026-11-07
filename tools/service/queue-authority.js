import fs from 'node:fs';
import path from 'node:path';
import { assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';

const refused = message => Object.assign(new Error(message), { code: 'ERR_QUEUE_ARTIFACT_AUTHORITY' });

export const assertQueueJobId = id => {
  if (typeof id !== 'string' || !id || id === '.' || id === '..'
    || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(id) || /[. ]$/.test(id)
    || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id)) {
    throw Object.assign(new Error('Queue job ID must be a portable, nonempty filename segment.'), { code: 'ERR_QUEUE_JOB_ID' });
  }
  return id;
};

/** Inspect missing roots through their existing ancestor without creating them. */
export const assertQueueArtifactPath = (dirPath, target) => {
  const root = path.resolve(dirPath), resolved = path.resolve(target);
  if (!isPathWithinRoot(resolved, root)) throw refused('Queue artifact escapes its queue root.');
  let anchor = root;
  while (!fs.lstatSync(anchor, { throwIfNoEntry: false })) {
    const parent = path.dirname(anchor);
    if (parent === anchor) throw refused('Queue root has no existing authority ancestor.');
    anchor = parent;
  }
  assertNoSymlinkPath(anchor, resolved, { allowMissing: true });
  return resolved;
};

export const admitQueueJobPaths = (dirPath, job) => {
  const id = assertQueueJobId(job?.id);
  const root = path.resolve(dirPath);
  const paths = { logPath: path.join(root, 'logs', `${id}.log`), reportPath: path.join(root, 'reports', `${id}.json`) };
  for (const [field, expected] of Object.entries(paths)) {
    const supplied = job[field];
    if (supplied != null) {
      if (typeof supplied !== 'string' || !supplied) throw refused(`Queue ${field} is invalid.`);
      const normalized = path.resolve(supplied);
      const equal = process.platform === 'win32' ? normalized.toLowerCase() === expected.toLowerCase() : normalized === expected;
      if (!equal) throw refused(`Queue ${field} does not belong to its validated job ID.`);
    }
    assertQueueArtifactPath(root, expected);
    const stat = fs.lstatSync(expected, { throwIfNoEntry: false });
    if (stat && (!stat.isFile() || stat.nlink > 1)) throw refused(`Queue ${field} must be an independently owned ordinary file.`);
  }
  return { ...job, ...paths };
};

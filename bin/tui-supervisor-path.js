import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const resolveTuiSupervisorPath = (packageRoot, metadata) => {
  const root = fs.realpathSync(packageRoot);
  const expected = path.join(root, 'tools', 'tui', 'supervisor.js');
  const actual = fs.realpathSync(expected);
  if (actual !== expected || !fs.statSync(actual).isFile()) {
    throw new Error('TUI supervisor must be a regular package-owned file without symlink redirection.');
  }
  const record = metadata?.supervisor;
  if (record?.path !== 'tools/tui/supervisor.js'
    || !/^[a-f0-9]{64}$/.test(String(record?.sha256 || ''))) {
    throw new Error('TUI install metadata has no trusted supervisor digest; reinstall the TUI.');
  }
  const digest = crypto.createHash('sha256').update(fs.readFileSync(actual)).digest('hex');
  if (digest !== record.sha256) throw new Error('TUI supervisor checksum mismatch; reinstall the TUI.');
  return actual;
};

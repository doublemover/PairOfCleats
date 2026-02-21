import { killProcessTree as sharedKillProcessTree } from '../../src/shared/kill-tree.js';

export const killProcessTree = async (pid, { graceMs = 2000 } = {}) => (
  sharedKillProcessTree(pid, { graceMs })
);

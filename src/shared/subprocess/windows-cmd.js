import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  quoteWindowsCmdArg,
  buildWindowsShellCommand,
  resolveWindowsCmdShimPath,
  resolveWindowsCmdInvocation
} = require('./windows-cmd-core.cjs');

export {
  quoteWindowsCmdArg,
  buildWindowsShellCommand,
  resolveWindowsCmdShimPath,
  resolveWindowsCmdInvocation
};

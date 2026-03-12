import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  quoteWindowsCmdArg,
  buildWindowsShellCommand,
  resolveWindowsCmdInvocation
} = require('./windows-cmd-core.cjs');

export {
  quoteWindowsCmdArg,
  buildWindowsShellCommand,
  resolveWindowsCmdInvocation
};

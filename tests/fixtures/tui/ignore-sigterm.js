#!/usr/bin/env node

process.on('SIGTERM', () => {
  // Ignore graceful termination to force supervisor kill-tree escalation.
});

setInterval(() => {}, 1000);

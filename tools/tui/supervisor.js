#!/usr/bin/env node

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stderr.write('Usage: node tools/tui/supervisor.js\n');
  process.stderr.write('Runs the Node supervisor process for the terminal TUI.\n');
  process.exit(0);
}

process.stderr.write('TUI supervisor runtime is not yet initialized for this invocation.\n');
process.exit(1);

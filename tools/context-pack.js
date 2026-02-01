#!/usr/bin/env node
import { runContextPackCli } from '../src/integrations/tooling/context-pack.js';

runContextPackCli().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

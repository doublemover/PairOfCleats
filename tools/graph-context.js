#!/usr/bin/env node
import { runGraphContextCli } from '../src/integrations/tooling/graph-context.js';

runGraphContextCli().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

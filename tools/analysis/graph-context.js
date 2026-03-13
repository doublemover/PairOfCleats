#!/usr/bin/env node
import { runGraphContextCli } from '../../src/integrations/tooling/graph-context.js';

runGraphContextCli()
  .then((result) => {
    if (result?.ok === false) {
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });

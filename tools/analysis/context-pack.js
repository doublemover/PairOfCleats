#!/usr/bin/env node
import { runContextPackCli } from '../../src/integrations/tooling/context-pack.js';

runContextPackCli()
  .then((result) => {
    if (result?.ok === false) {
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });

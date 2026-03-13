#!/usr/bin/env node
import { runSuggestTestsCli } from '../../src/integrations/tooling/suggest-tests.js';

runSuggestTestsCli()
  .then((result) => {
    if (result?.ok === false) {
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });

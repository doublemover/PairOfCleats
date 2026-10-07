#!/usr/bin/env node
import {
  collectUnknownActionCovers,
  createScriptCoverageActionsFixture
} from './coverage-fixture.js';

const { actions, scriptNames, cleanup } = await createScriptCoverageActionsFixture();
const unknown = collectUnknownActionCovers(actions, scriptNames);

if (unknown.size) {
  console.error(`script coverage wiring invalid: ${Array.from(unknown).sort().join(', ')}`);
  process.exit(1);
}

await cleanup();
console.log('script coverage wiring test passed');

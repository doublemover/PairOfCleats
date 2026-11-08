#!/usr/bin/env node
import { resolveDevelopmentArtifactPath } from '../../../tools/shared/dev-artifacts.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveToolsForLanguages } from '../../../tools/tooling/utils.js';

const root = process.cwd();
const toolingRoot = resolveDevelopmentArtifactPath(root, 'test-cache', 'tooling-resolve-preferred-enabled-fallback');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');

const rubyTools = resolveToolsForLanguages(
  ['ruby'],
  toolingRoot,
  fixtureRoot,
  {
    enabledTools: ['solargraph'],
    disabledTools: ['ruby-lsp']
  }
);

assert.deepEqual(
  rubyTools.map((tool) => tool.id),
  ['solargraph'],
  'expected enabled non-preferred tool to remain selectable when preferred tool is disabled'
);

const kotlinTools = resolveToolsForLanguages(
  ['kotlin'],
  toolingRoot,
  fixtureRoot,
  {
    enabledTools: ['kotlin-language-server'],
    disabledTools: ['kotlin-lsp']
  }
);

assert.deepEqual(
  kotlinTools.map((tool) => tool.id),
  ['kotlin-language-server'],
  'expected enabled fallback tool to remain selectable when preferred Kotlin tool is disabled'
);

console.log('tooling resolve preferred enabled fallback test passed');

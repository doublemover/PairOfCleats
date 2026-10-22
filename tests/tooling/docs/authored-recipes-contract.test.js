#!/usr/bin/env node
import assert from 'node:assert/strict';
import { tokenizeRecipeCommands } from '../../../tools/docs/recipes/shell.js';
import { extractAuthoredRecipes } from '../../../tools/docs/recipes/extract.js';
import { validateRecipeCommand } from '../../../tools/docs/recipes/contracts.js';
import { checkAuthoredRecipes } from '../../../tools/docs/check-authored-recipes.js';

assert.deepEqual(tokenizeRecipeCommands('node bin/pairofcleats.js search \\\n  --repo "C:\\project with spaces" -- "a quoted query"'), [['node', 'bin/pairofcleats.js', 'search', '--repo', 'C:\\project with spaces', '--', 'a quoted query']]);
assert.deepEqual(tokenizeRecipeCommands("node bin/pairofcleats.js search `\n --repo 'C:\\target''s source' -- <query>", { shell: 'powershell' })[0].slice(-4), ['--repo', "C:\\target's source", '--', '<query>']);
assert.throws(() => tokenizeRecipeCommands('node bin/pairofcleats.js search $(run-dangerous)'), /composition/);
assert.throws(() => tokenizeRecipeCommands('node bin/pairofcleats.js search > output'), /Redirection/);
for (const args of [
  ['node', 'bin/pairofcleats.js', 'sqlite', 'build'],
  ['node', 'bin/pairofcleats.js', 'assets', 'extensions'],
  ['node', 'bin/pairofcleats.js', 'uninstall'],
  ['node', 'bin/pairofcleats.js', 'service', 'indexer', 'purge', '--queue', 'index', '--json']
]) assert.throws(() => validateRecipeCommand(args));
const purge = validateRecipeCommand(['node', 'bin/pairofcleats.js', 'service', 'indexer', 'purge', '--config', '<config>', '--queue', 'index', '--job', '<job-id>', '--dry-run', '--json']);
assert.equal(purge.selection.config, '<config>');
const marked = extractAuthoredRecipes('<!-- poc:recipe a shell=portable effects=read-only -->\n```sh\nnode bin/pairofcleats.js config dump --repo "fixture" --json\n```', 'fixture.md');
assert.equal(marked[0].line, 3);
assert.match(marked[0].content, /config dump/);
const coverage = checkAuthoredRecipes();
assert.equal(coverage.execution, 'none');
assert.ok(coverage.recipes.length > 0);
assert.equal(coverage.ok, true, coverage.recipes.filter(recipe => recipe.error).map(recipe => recipe.error).join('\n'));
assert.equal(coverage.recipes.every(recipe => recipe.behavior === 'not-run'), true);
console.log('Authored recipes are checked against extracted source and canonical contracts.');

#!/usr/bin/env node
// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tokenizeRecipeCommands } from '../../../tools/docs/recipes/shell.js';
import { extractAuthoredRecipes, inventoryAuthoredRecipeFences } from '../../../tools/docs/recipes/extract.js';
import { validateRecipeCommand } from '../../../tools/docs/recipes/contracts.js';
import { checkAuthoredRecipes } from '../../../tools/docs/check-authored-recipes.js';
import { validateAuthoredConfigRecipe } from '../../../tools/docs/recipes/config.js';

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
assert.equal(inventoryAuthoredRecipeFences('```sh\nnot qualified\n```', []).at(0).classification, 'unmarked-unqualified');
assert.throws(() => extractAuthoredRecipes('<!-- poc:recipe bad classification=currnet -->\n```sh\nnode bin/pairofcleats.js help\n```', 'bad.md'), /bad.md:1.*unknown classification/);
const configRecipe = text => extractAuthoredRecipes('<!-- poc:recipe config-case kind=config effects=read-only -->\n```json\n' + text + '\n```', 'config-case.md')[0];
const schema = JSON.parse(fs.readFileSync('docs/config/schema.json', 'utf8'));
const context = { schema, repoRoot: process.cwd() };
assert.throws(() => validateAuthoredConfigRecipe(configRecipe('{"search":{"queryCache":{"enabled":true}}}'), context), /queryCache|additional|unknown/i);
const ignored = configRecipe('{"tooling":{"autoInstallOnDetect":true}}');
assert.throws(() => validateAuthoredConfigRecipe(ignored, context), /Advertised effective settings are ignored.*tooling.autoInstallOnDetect/);
assert.deepEqual(validateAuthoredConfigRecipe({ ...ignored, authority: 'illustrates-discard' }, context).ignored, ['tooling.autoInstallOnDetect']);
const partial = { ...configRecipe('{"enabled":false}'), enclosing: 'indexing.workerPool' };
assert.equal(validateAuthoredConfigRecipe(partial, context).effective, 'canonical-untrusted-loader-fixture');
assert.throws(() => validateAuthoredConfigRecipe({ ...partial, enclosing: '__proto__.bad' }, context), /invalid enclosing path/);
const coverage = checkAuthoredRecipes();
assert.equal(coverage.execution, 'none');
assert.ok(coverage.recipes.length > 0);
assert.equal(coverage.ok, true, coverage.recipes.filter(recipe => recipe.error).map(recipe => recipe.error).join('\n'));
assert.equal(coverage.recipes.every(recipe => recipe.behavior === 'not-run'), true);
assert.ok(coverage.recipes.some(recipe => recipe.id === 'first-search-config' && recipe.effective === 'canonical-untrusted-loader-fixture'));
assert.equal(coverage.evaluated.behavior, 0);
assert.ok(coverage.sourceCoverage.some(source => source.unmarked.length > 0), 'unmarked authored fences are inventoried instead of silently passing');
console.log('Authored recipes are checked against extracted source and canonical contracts.');

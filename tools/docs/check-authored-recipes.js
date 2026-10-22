#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { parseJsoncText } from '../../src/shared/jsonc.js';
import { validateConfig } from '../../src/config/validate.js';
import { extractAuthoredRecipes } from './recipes/extract.js';
import { tokenizeRecipeCommands } from './recipes/shell.js';
import { validateRecipeCommand } from './recipes/contracts.js';

export const AUTHORED_RECIPE_SOURCES = Object.freeze([
  'docs/guides/setup.md', 'docs/guides/configuration.md', 'docs/guides/workspaces.md',
  'docs/guides/external-backends.md', 'docs/guides/service-mode.md', 'docs/guides/upgrades.md', 'docs/guides/query-cache.md'
]);

export const checkAuthoredRecipes = ({ root = process.cwd(), sources = AUTHORED_RECIPE_SOURCES } = {}) => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/schema.json'), 'utf8'));
  const rows = [];
  const seen = new Set();
  for (const sourcePath of sources) {
    for (const recipe of extractAuthoredRecipes(fs.readFileSync(path.join(root, sourcePath), 'utf8'), sourcePath)) {
      if (seen.has(recipe.id)) throw new Error(`Duplicate authored recipe id: ${recipe.id}`);
      seen.add(recipe.id);
      const row = { id: recipe.id, sourcePath, line: recipe.line, shell: recipe.shell, effects: recipe.effects,
        classification: recipe.classification, commands: [], structural: 'unrun', behavior: 'not-run', platform: 'not-qualified' };
      try {
        if (recipe.classification !== 'current') { row.structural = 'excluded'; row.exclusion = recipe.classification; }
        else if (recipe.kind === 'config') {
          const config = parseJsoncText(recipe.content, `${sourcePath}:${recipe.line}`);
          const validation = validateConfig(schema, config);
          if (!validation.ok) throw new Error(validation.errors.join('; '));
          row.structural = 'schema-accepted';
          row.effective = 'not-evaluated-without-disposable-loader-fixture';
        } else {
          const commands = tokenizeRecipeCommands(recipe.content, { shell: recipe.shell }).map(validateRecipeCommand);
          for (const key of ['config', 'workspace']) {
            const identities = [...new Set(commands.map(command => command.selection[key]).filter(Boolean))];
            if (identities.length > 1) throw new Error(`Multi-step recipe changes selected ${key} identity.`);
            if (identities.length && commands.some(command => command.selection[key] === null)) throw new Error(`Multi-step recipe loses explicit ${key} identity.`);
          }
          row.commands = commands.map(({ commandId, script, options }) => ({ commandId, script, options }));
          row.structural = commands.some(command => command.options === 'not-evaluated') ? 'route-accepted-options-partial' : 'accepted';
        }
      } catch (error) { row.structural = 'failed'; row.error = `${sourcePath}:${recipe.line}: ${recipe.id}: ${error.message}`; }
      rows.push(row);
    }
  }
  return { schemaVersion: 1, kind: 'authored-recipe-coverage', ok: rows.every(row => row.structural !== 'failed'),
    sources, recipes: rows, execution: 'none', exclusions: ['unmarked snippets', 'arbitrary Markdown execution', 'downloads/installers', 'live roots/services/cleanup', 'behavior/platform qualification'] };
};

if (isDirectExecution(import.meta.url)) {
  const argv = createCli({ scriptName: 'check-authored-recipes', options: { json: { type: 'boolean', default: false }, root: { type: 'string', default: process.cwd() } } }).strictOptions().parse();
  const report = checkAuthoredRecipes({ root: argv.root });
  if (argv.json) console.log(JSON.stringify(report, null, 2));
  else for (const recipe of report.recipes) console.error(recipe.error || `${recipe.sourcePath}:${recipe.line}: ${recipe.id}: ${recipe.structural}; behavior/platform unrun`);
  process.exitCode = report.ok ? 0 : 1;
}

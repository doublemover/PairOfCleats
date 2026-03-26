#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { readJsonFile } from '../../src/shared/json-file.js';

const DEFAULT_SCAN_ROOTS = ['src', 'tools', 'tests', 'bin'];
const DEFAULT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const SKIP_SEGMENTS = new Set(['.git', 'node_modules', '.testLogs', 'dist', 'coverage']);

const normalizePath = (value) => String(value || '').replace(/\\/g, '/');

const parseRenameEntries = (input) => {
  const entries = input && typeof input === 'object' ? input : {};
  return Object.fromEntries(
    Object.entries(entries)
      .map(([from, to]) => [String(from || '').trim(), String(to || '').trim()])
      .filter(([from, to]) => from && to)
  );
};

const normalizeRecipe = (entry) => {
  const id = String(entry?.id || '').trim();
  const from = normalizePath(entry?.from);
  const to = normalizePath(entry?.to);
  const roots = Array.isArray(entry?.roots) && entry.roots.length
    ? entry.roots.map((root) => normalizePath(root))
    : DEFAULT_SCAN_ROOTS.slice();
  const renames = parseRenameEntries(entry?.renames);
  if (!id) throw new Error('recipe missing id');
  if (!from) throw new Error(`recipe ${id} missing "from"`);
  if (!to) throw new Error(`recipe ${id} missing "to"`);
  return {
    id,
    description: String(entry?.description || '').trim() || null,
    from,
    to,
    roots,
    renames
  };
};

const normalizeRecipeFile = (input) => {
  const recipes = Array.isArray(input?.recipes) ? input.recipes.map(normalizeRecipe) : [];
  if (!recipes.length) {
    throw new Error('recipe file must contain at least one recipe');
  }
  return {
    schemaVersion: String(input?.schemaVersion || '').trim() || '1.0.0',
    roots: Array.isArray(input?.roots) && input.roots.length
      ? input.roots.map((root) => normalizePath(root))
      : DEFAULT_SCAN_ROOTS.slice(),
    recipes
  };
};

const collectFiles = async (rootDir, roots) => {
  const unique = new Set();
  for (const root of roots) {
    const absRoot = path.resolve(rootDir, root);
    if (!fs.existsSync(absRoot)) continue;
    const stack = [absRoot];
    while (stack.length) {
      const current = stack.pop();
      const relative = normalizePath(path.relative(rootDir, current));
      if (relative && relative.split('/').some((segment) => SKIP_SEGMENTS.has(segment))) continue;
      const stats = await fsPromises.stat(current);
      if (stats.isDirectory()) {
        const children = await fsPromises.readdir(current);
        for (const child of children) {
          stack.push(path.join(current, child));
        }
        continue;
      }
      if (!DEFAULT_EXTENSIONS.has(path.extname(current))) continue;
      unique.add(path.resolve(current));
    }
  }
  return Array.from(unique).sort();
};

const splitNamedSpecifiers = (content) => {
  return content
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
};

const rewriteNamedSpecifiers = (statement, renames) => {
  if (!Object.keys(renames).length) return statement;
  return statement.replace(/\{([\s\S]*?)\}/, (full, inner) => {
    const pieces = splitNamedSpecifiers(inner);
    if (!pieces.length) return full;
    const rewritten = pieces.map((piece) => {
      const match = piece.match(/^([A-Za-z0-9_$]+)(?:\s+as\s+([A-Za-z0-9_$]+))?$/);
      if (!match) return piece;
      const [, importedName, aliasName] = match;
      const replacement = renames[importedName];
      if (!replacement) return piece;
      const alias = aliasName || importedName;
      if (replacement === alias && !aliasName) return replacement;
      return `${replacement} as ${alias}`;
    });
    return `{ ${rewritten.join(', ')} }`;
  });
};

const rewriteStatement = (statement, recipe) => {
  if (!statement.includes(recipe.from)) return { text: statement, changed: false };
  const specifierPattern = new RegExp(`(['"])${recipe.from.replace(/[.*+?^${}()|[\\]\\\]/g, '\\$&')}\\1`);
  if (!specifierPattern.test(statement)) return { text: statement, changed: false };

  let rewritten = statement.replace(specifierPattern, (_match, quote) => `${quote}${recipe.to}${quote}`);
  rewritten = rewriteNamedSpecifiers(rewritten, recipe.renames);
  return { text: rewritten, changed: rewritten !== statement };
};

const applyRecipesToSource = (source, recipes) => {
  const statementPattern =
    /(^|\n)([ \t]*(?:import\b[\s\S]*?;|export\b[\s\S]*?from\s*['"][^'"]+['"]\s*;|import\s*['"][^'"]+['"]\s*;))/g;
  const applied = [];
  const rewritten = source.replace(statementPattern, (full, prefix, statement) => {
    let current = statement;
    for (const recipe of recipes) {
      const result = rewriteStatement(current, recipe);
      if (!result.changed) continue;
      current = result.text;
      applied.push(recipe.id);
    }
    return `${prefix}${current}`;
  });
  return {
    text: rewritten,
    appliedRecipeIds: Array.from(new Set(applied)).sort()
  };
};

export const runSharedModuleMigration = async ({
  rootDir = process.cwd(),
  recipeFile = path.join('docs', 'tooling', 'shared-module-migration-recipes.json'),
  recipeIds = [],
  write = false,
  check = false
} = {}) => {
  const recipePayload = normalizeRecipeFile(await readJsonFile(path.resolve(rootDir, recipeFile)));
  const selectedRecipes = recipeIds.length
    ? recipePayload.recipes.filter((recipe) => recipeIds.includes(recipe.id))
    : recipePayload.recipes;
  if (!selectedRecipes.length) {
    throw new Error('no matching recipes selected');
  }

  const scanRoots = Array.from(
    new Set(selectedRecipes.flatMap((recipe) => recipe.roots).concat(recipePayload.roots || []))
  );
  const files = await collectFiles(rootDir, scanRoots);
  const changes = [];

  for (const file of files) {
    const relativePath = normalizePath(path.relative(rootDir, file));
    const recipesForFile = selectedRecipes.filter((recipe) =>
      recipe.roots.some((root) => relativePath === root || relativePath.startsWith(`${root}/`))
    );
    if (!recipesForFile.length) continue;
    const before = await fsPromises.readFile(file, 'utf8');
    const result = applyRecipesToSource(before, recipesForFile);
    if (result.text === before) continue;
    changes.push({
      path: relativePath,
      recipeIds: result.appliedRecipeIds
    });
    if (write) {
      await fsPromises.writeFile(file, result.text, 'utf8');
    }
  }

  const summary = {
    rootDir: normalizePath(path.resolve(rootDir)),
    recipeFile: normalizePath(path.resolve(rootDir, recipeFile)),
    selectedRecipes: selectedRecipes.map((recipe) => recipe.id),
    filesScanned: files.length,
    filesChanged: changes.length,
    changes
  };

  if (check && changes.length) {
    const error = new Error(`shared-module migration check found ${changes.length} file(s) requiring updates`);
    error.summary = summary;
    throw error;
  }

  return summary;
};

const formatSummary = (summary) => {
  const lines = [
    `shared-module migration scan complete: ${summary.filesChanged} file(s) changed across ${summary.selectedRecipes.length} recipe(s)`
  ];
  for (const change of summary.changes) {
    lines.push(`- ${change.path}: ${change.recipeIds.join(', ')}`);
  }
  return lines.join('\n');
};

const cli = createCli({
  commandName: 'pairofcleats shared-module-migration',
  description: 'Apply shared-module import migrations from a recipe manifest.',
  options: {
    recipe: { type: 'string', default: 'docs/tooling/shared-module-migration-recipes.json' },
    only: { type: 'array', default: [] },
    write: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false }
  }
});

if (isDirectExecution(import.meta.url)) {
  const argv = cli.argv;
  try {
    const summary = await runSharedModuleMigration({
      recipeFile: argv.recipe,
      recipeIds: Array.isArray(argv.only) ? argv.only.map((value) => String(value)) : [],
      write: Boolean(argv.write),
      check: Boolean(argv.check)
    });
    if (argv.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(formatSummary(summary));
    }
  } catch (error) {
    if (argv.json && error?.summary) {
      console.log(JSON.stringify(error.summary, null, 2));
    } else if (error?.summary) {
      console.error(formatSummary(error.summary));
    }
    console.error(error?.message || String(error));
    process.exit(1);
  }
}

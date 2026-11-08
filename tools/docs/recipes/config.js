import { parseJsoncText } from '../../../src/shared/jsonc.js';
import { validateConfig } from '../../../src/config/validate.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { loadUserConfig } from '../../dict-utils/config.js';

/** In-memory canonical loader fixture: no config write, trust mutation, provider
 * activation, environment inheritance or live user-policy read is involved.
 */
export const validateAuthoredConfigRecipe = (recipe, { schema, repoRoot }) => {
  let config = parseJsoncText(recipe.content, `${recipe.sourcePath}:${recipe.line}`);
  if (recipe.enclosing) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*$/.test(recipe.enclosing)
      || recipe.enclosing.split('.').some(key => ['constructor', 'prototype', '__proto__'].includes(key))) throw new Error('Partial config has an invalid enclosing path.');
    for (const key of recipe.enclosing.split('.').reverse()) config = { [key]: config };
  }
  const validation = validateConfig(schema, config);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  let sources;
  const effective = loadUserConfig(repoRoot, { env: {}, repositoryConfig: config, onSources: value => { sources = value; } });
  const ignored = sources.discardedAuthorityPaths;
  if (recipe.authority === 'illustrates-discard') {
    if (!ignored.length) throw new Error('Config advertises an authority-discard example, but no declared setting was discarded.');
  } else if (recipe.authority !== 'effective') throw new Error('Unknown config authority expectation.');
  else if (ignored.length) throw new Error(`Advertised effective settings are ignored for an untrusted target: ${ignored.join(', ')}. Declare authority=illustrates-discard only for an explicit discard demonstration.`);
  const normalized = [];
  const compare = (value, prefix = []) => {
    for (const [key, entry] of Object.entries(value)) {
      const keys = [...prefix, key];
      const name = keys.join('.');
      if (ignored.some(path => name === path || name.startsWith(path + '.'))) continue;
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) compare(entry, keys);
      else if (stableStringify(keys.reduce((parent, field) => parent?.[field], effective)) !== stableStringify(entry)) normalized.push(name);
    }
  };
  compare(config);
  if (!['exact', 'documented'].includes(recipe.normalization)) throw new Error('Unknown config normalization expectation.');
  if (normalized.length && recipe.normalization !== 'documented') throw new Error('Advertised settings change during canonical normalization: ' + normalized.join(', '));
  return { structural: 'schema-and-effective-accepted', effective: 'canonical-untrusted-loader-fixture', ignored, normalized,
    fixture: { storageWrites: false, launchEnvironmentInherited: false, providerActivation: false, runtimeReadiness: 'not-probed' } };
};

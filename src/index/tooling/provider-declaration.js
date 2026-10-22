import { PROVIDER_DECLARATION_SCHEMA } from '../../contracts/schemas/provider-declaration.js';
import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { canonicalSemanticJson } from '../semantic/identity.js';

let validator;
const fail = message => Object.assign(new TypeError(message), { code: 'ERR_TOOLING_PROVIDER_DECLARATION' });
export const validateProviderDeclaration = declaration => {
  validator ||= compileSchema(createAjv({ allErrors: true, strict: true }), PROVIDER_DECLARATION_SCHEMA);
  if (!validator(declaration)) return { ok: false, errors: structuredClone(validator.errors) };
  const produced = new Set(declaration.facts.map(fact => fact.family));
  const errors = [];
  for (const consumer of declaration.consumers) {
    for (const family of consumer.families) if (!produced.has(family)) errors.push(`Consumer ${consumer.id} requires undeclared ${family}.`);
  }
  for (const fact of declaration.facts) {
    if (fact.evidence === 'presentation' && !['legacyTypes', 'symbolicTypes'].includes(fact.family)) errors.push(`Presentation text cannot establish ${fact.family}.`);
  }
  if (declaration.execution !== 'trusted-inprocess' && declaration.execution !== 'report'
    && !declaration.prerequisites.length) errors.push('An executable provider requires a discover/verify/provision/launch prerequisite.');
  if (declaration.execution !== 'trusted-inprocess' && declaration.execution !== 'report'
    && !declaration.contextRequirements.includes('execution-grant')) errors.push('An executable provider requires a host execution grant.');
  if (declaration.facts.some(fact => !['legacyTypes', 'symbolicTypes'].includes(fact.family))
    && !declaration.contextRequirements.includes('source-snapshot')) errors.push('Semantic facts require a pinned source snapshot.');
  if (new Set(declaration.languages.map(value => value.id + ':' + value.dialect)).size !== declaration.languages.length
    || new Set(declaration.prerequisites.map(value => value.id)).size !== declaration.prerequisites.length
    || produced.size !== declaration.facts.length) errors.push('Duplicate language, fact family or prerequisite identity.');
  return { ok: errors.length === 0, errors };
};
export const assertProviderDeclaration = declaration => {
  const validation = validateProviderDeclaration(declaration);
  if (!validation.ok) throw fail(JSON.stringify(validation.errors));
  canonicalSemanticJson(declaration);
  return declaration;
};

/** Selection-time recipe conformance resolves actual existing recipes. A label
 * alone cannot make a selected external prerequisite provisionable. */
export const checkProviderProvisioningConformance = ({ declaration, target, resolveRecipe }) => {
  assertProviderDeclaration(declaration);
  const requirements = declaration.prerequisites.map(requirement => {
    if (requirement.provision.kind === 'system-action') return { id: requirement.id, state: 'action-required', action: requirement.provision.action };
    if (!requirement.provision.supportedTargets.includes(target)) return { id: requirement.id, state: 'unsupported-target' };
    const recipe = resolveRecipe?.(requirement.provision.recipeId);
    const executable = recipe && typeof recipe.discover === 'function' && typeof recipe.verify === 'function'
      && typeof recipe.plan === 'function' && typeof recipe.install === 'function' && typeof recipe.resolveLaunch === 'function';
    return { id: requirement.id, state: executable ? 'recipe-admitted' : 'recipe-unavailable', recipeId: requirement.provision.recipeId };
  });
  return { providerId: declaration.providerId, target,
    complete: requirements.every(value => ['recipe-admitted', 'action-required'].includes(value.state)), requirements };
};

export const providerDeclarationSchema = () => structuredClone(PROVIDER_DECLARATION_SCHEMA);

/** Legacy metadata stays unqualified until an author declares executable and
 * consumer behavior. This adapter does not fabricate a complete declaration. */
export const migrateLegacyProviderDeclaration = provider => ({ schemaVersion: 1,
  providerId: String(provider?.id || ''), adapterVersion: String(provider?.version || ''),
  status: 'requires-declaration', languages: [...(provider?.languages || [])],
  missing: ['execution', 'fact-evidence', 'consumers', 'context-requirements', 'limits', 'provisioning'] });

import { classifyTypeIr, containsTypeIr } from '../index/tooling/typescript/type-ir/queries.js';
import { isRequiredToolingComputationError } from '../index/tooling/required-computation.js';
import { compareFiniteShapes, projectFiniteShapeFields } from '../index/semantic/types/finite-shapes.js';
import { validateSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';

/** Reuse the existing finite-string engine without conflating it with native assignability. */
export const queryFiniteStringType = ({ arena, root, world, operation, value, options = {} }) => {
  if (!world || world.contextKey !== arena?.contextKey || !validateSemanticEnvelope('generation', world.generation).ok
    || !['contains', 'classify'].includes(operation)) throw new TypeError('Pinned finite-string profile/context required.');
  const base = { profile: 'finite-string-language/v1', world: structuredClone(world), rootId: root?.id,
    operation, nativeAssignability: 'not-implied', sourceClosure: 'not-implied' };
  try {
    if (operation === 'contains') return { ...base, status: containsTypeIr(arena, root, value, options) ? 'proved' : 'refuted',
      predicate: 'finite-language-membership', value };
    return { ...base, status: 'complete-in-model', ...classifyTypeIr(arena, root, options) };
  } catch (error) {
    if (!isRequiredToolingComputationError(error) && error?.name !== 'AbortError') throw error;
    return { ...base, status: 'unknown', reason: error?.name === 'AbortError' ? 'cancelled' : error.reason };
  }
};

/** Compact semantic-detail consumer retains correlated alternatives and one checked counterexample. */
export const describeFiniteShapeCompatibility = ({ left, right, labels = [], maxWork = 512, signal = null }) => ({
  inclusion: compareFiniteShapes({ left, right, operation: 'inclusion', maxWork, signal }),
  disjointness: compareFiniteShapes({ left, right, operation: 'disjointness', maxWork, signal }),
  leftAlternatives: projectFiniteShapeFields({ type: left, labels, maxWork, signal }),
  interpretation: 'finite-model-compatibility', editAuthority: 'none'
});

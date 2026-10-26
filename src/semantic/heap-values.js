import { readFiniteHeapCellProjection } from '../index/semantic/heap/finite-versions.js';

/** Bounded presentation consumer: retained abstract values are never sliced into a negative proof. */
export const queryFiniteHeapValues = ({ version, property, offset = 0, limit = 64 }) => {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
    throw new TypeError('Invalid heap value page.');
  }
  const answer = readFiniteHeapCellProjection({ version, property });
  const values = answer.values.slice(offset, offset + limit);
  return { ...answer, values, dependencies: { ...answer.dependencies, wildcardEpochs: [...answer.dependencies.wildcardEpochs] }, totalValues: answer.values.length,
    nextOffset: offset + values.length < answer.values.length ? offset + values.length : null,
    responseComplete: offset === 0 && values.length === answer.values.length,
    concreteWitness: false, noFlow: false };
};

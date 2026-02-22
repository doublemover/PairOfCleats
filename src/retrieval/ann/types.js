/**
 * @typedef {object} AnnQueryParams
 * @property {object} idx
 * @property {'code'|'prose'|'records'|'extracted-prose'} mode
 * @property {ArrayLike<number>|null} embedding
 * @property {number} topN
 * @property {Set<number>|null} candidateSet
 * @property {object|null} [budget]
 * @property {string|null} [route]
 * @property {object|null} [features]
 */

/**
 * @typedef {object} AnnProviderAvailabilityParams
 * @property {object} idx
 * @property {'code'|'prose'|'records'|'extracted-prose'} mode
 * @property {ArrayLike<number>|null} embedding
 */

/**
 * @typedef {object} AnnProvider
 * @property {string} id
 * @property {(params: AnnProviderAvailabilityParams) => boolean} isAvailable
 * @property {(params: AnnQueryParams) => Promise<Array<{idx:number,sim:number}>>|Array<{idx:number,sim:number}>} query
 */

export const ANN_PROVIDER_IDS = Object.freeze({
  LANCEDB: 'lancedb',
  SQLITE_VECTOR: 'sqlite-vector',
  HNSW: 'hnsw',
  DENSE: 'js'
});

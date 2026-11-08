/** Valid numeric query containers. Availability still requires nonempty input;
 * this is not an arbitrary ArrayLike or a DataView/BigInt vector contract.
 * @typedef {ReadonlyArray<number>|Float32Array|Float64Array|Int8Array|Uint8Array|Uint8ClampedArray|Int16Array|Uint16Array|Int32Array|Uint32Array} AnnEmbedding
 */

/** Bitmap capabilities used by the common candidate owners, in addition to
 * ordinary sets/arrays. Membership, cardinality and enumeration are all needed.
 * @typedef {({has:(id:number)=>boolean}|{contains:(id:number)=>boolean}|{includes:(id:number)=>boolean}) & ({size:number|(()=>number)}|{getSize:()=>number}) & ({toArray:()=>number[]|Uint32Array}|{values:()=>IterableIterator<number>}|Iterable<number>)} AnnCandidateBitmap
 * @typedef {ReadonlySet<number>|ReadonlyArray<number>|AnnCandidateBitmap} AnnCandidateSet
 */

/**
 * @typedef {object} AnnQueryParams
 * @property {object} idx
 * @property {'code'|'prose'|'records'|'extracted-prose'} mode
 * @property {AnnEmbedding|null} embedding
 * @property {number} topN
 * @property {AnnCandidateSet|null} candidateSet
 * @property {AbortSignal|null} [signal]
 * @property {object|null} [budget]
 * @property {string|null} [route]
 * @property {object|null} [features]
 */

/**
 * @typedef {object} AnnProviderAvailabilityParams
 * @property {object} idx
 * @property {'code'|'prose'|'records'|'extracted-prose'} mode
 * @property {AnnEmbedding|null} embedding
 */

/**
 * @typedef {object} AnnProvider
 * @property {string} id
 * @property {{predicate:string,exhaustiveStored:boolean,progressiveEffort:boolean,cancellation:string,scoreSpace:string}} [capabilities]
 * @property {(params: AnnProviderAvailabilityParams) => boolean} isAvailable
 * @property {(params: AnnQueryParams) => Promise<Array<{idx:number,sim:number}>>|Array<{idx:number,sim:number}>} query
 */

export const ANN_PROVIDER_IDS = Object.freeze({
  LANCEDB: 'lancedb',
  SQLITE_VECTOR: 'sqlite-vector',
  HNSW: 'hnsw',
  DENSE: 'js'
});

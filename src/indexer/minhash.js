/**
 * Simple MinHash implementation for approximate similarity.
 */
export class SimpleMinHash {
  /**
   * @param {number} [numHashes]
   */
  constructor(numHashes = 128) {
    this.numHashes = numHashes;
    this.seeds = Array.from({ length: numHashes }, (_, i) => i + 1);
    this.hashValues = Array(numHashes).fill(Infinity);
  }

  /**
   * Hash a token with a given seed.
   * @param {string} str
   * @param {number} seed
   * @returns {number}
   */
  hash(str, seed) {
    let h = seed;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  /**
   * Update signature with a token.
   * @param {string} token
   */
  update(token) {
    this.seeds.forEach((seed, i) => {
      const hv = this.hash(token, seed);
      if (hv < this.hashValues[i]) {
        this.hashValues[i] = hv;
      }
    });
  }
}

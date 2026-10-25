/** Physical saved-claim admission is independent from response page sizing. */
export const RUNTIME_CLAIM_VERIFICATION_LIMITS = Object.freeze({ maxFamilies: 2, maxCitationRows: 128,
  maxHydratedBytes: 1048576, maxRawVerificationBytes: 128 * 1024 * 1024 });

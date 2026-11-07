// Kept dependency-free for metadata-only help/status and ordinary entry gates.
export const CHECKOUT_MUTATION_LOCK = '.tmp/checkout-bootstrap/mutation.lock';
export const BOOTSTRAP_RECEIPT = 'node_modules/.pairofcleats-bootstrap.json';
export const CHECKOUT_NATIVE_EVIDENCE_LIMITS = Object.freeze({ attempts: 384, bytes: 32 * 1024 * 1024,
  metadataBytes: 32 * 1024 });

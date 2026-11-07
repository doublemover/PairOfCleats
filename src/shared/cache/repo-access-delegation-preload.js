// The Node import gate deliberately runs before the requested entry module.
// Failure leaves the delegation fence retained and never imports cache readers.
import { admitDelegatedRepoCacheOwner } from './repo-access-delegation.js';
await admitDelegatedRepoCacheOwner();

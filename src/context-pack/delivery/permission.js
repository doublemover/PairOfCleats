import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { deliveryError } from './manifest.js';

/** Installed authority callbacks must positively confirm their actual decision.
 * A fulfilled resource-owning result is observed before denial/classification. */
export const confirmDeliveryPermission = async (decision, message) => {
  const value = await decision;
  if (value === true) return;
  if (value !== null && ['object', 'function'].includes(typeof value)) {
    observeStorageResource(value, { phase: 'evidence-permission-decision' }).requireSettled();
  }
  throw deliveryError('ScopeDenied', message);
};

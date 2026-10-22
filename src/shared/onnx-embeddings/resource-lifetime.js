/** Every acquired resource is attempted in reverse acquisition order. Failed
 * settlement retains real owners and does not release experimental capacity. */
export const releaseOnnxResources = async ({ session, tokenizer, qualificationSlot = null,
  qualificationLease = null, primaryError = null, owner = null }) => {
  const failures = [];
  try { await session?.release?.(); } catch (error) { failures.push(error); }
  try { await tokenizer?.dispose?.(); } catch (error) { failures.push(error); }
  if (failures.length || primaryError?.cacheOwnershipPending) {
    const error = primaryError || failures[0];
    error.cleanupErrors = [...(error.cleanupErrors || []), ...failures.filter(value => value !== error)];
    error.cleanupFailureCount = (error.cleanupFailureCount || 0) + failures.length;
    error.cacheOwnershipPending = true;
    error.qualificationLease = qualificationLease;
    error.onnxSessionOwner = owner || { session, tokenizer, qualificationSlot };
    return error;
  }
  qualificationSlot?.release();
  return primaryError;
};

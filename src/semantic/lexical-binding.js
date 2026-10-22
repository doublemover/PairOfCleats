import { validateSemanticRecord } from '../contracts/validators/semantic.js';
import { resolveLexicalBinding } from '../index/semantic/bindings/lexical.js';
import { stableStringify } from '../shared/stable-json.js';

/**
 * Consumer seam for admitted canonical semantic records. Closure and declaration
 * annotations come from a named profile adapter; syntax coverage alone is never
 * promoted to binding-model closure. No existing default provider is replaced.
 */
export const resolveCanonicalLexicalBinding = ({ partitions, closures, annotations, ...request }) => {
  if (!Array.isArray(partitions) || partitions.length > 128
    || !(closures instanceof Map) || !(annotations instanceof Map)) throw new TypeError('Bounded admitted partitions and profile maps required.');
  const scopes = [];
  const declarations = [];
  let rows = 0;
  for (const partition of partitions) {
    if (!/^(sy1|sa1):[a-f0-9]{64}$/.test(partition.partitionId) || !Array.isArray(partition.records)) {
      throw new TypeError('Canonical semantic partition required.');
    }
    for (const record of partition.records) {
      if (++rows > 65536) throw new TypeError('Canonical lexical projection exceeds its row allowance.');
      if (!['scope', 'declaration'].includes(record.kind)) continue;
      const validation = validateSemanticRecord('node', record);
      if (!validation.ok) throw new TypeError('Invalid canonical binding input: ' + validation.errors.join('; '));
      const ref = { partitionId: partition.partitionId, localId: record.id };
      if (record.kind === 'scope') {
        const closure = closures.get(stableStringify(ref));
        scopes.push({ ref, parent: record.data.parent,
          declarationsClosed: closure?.declarationsClosed === true,
          parentClosed: closure?.parentClosed === true,
          closureReceiptId: closure?.receiptId || null,
          unsupported: closure?.unsupported || [] });
      } else {
        const annotation = annotations.get(stableStringify(ref));
        if (!annotation || !record.scope) throw new TypeError('Canonical declaration requires an admitted namespace/datum/access annotation.');
        declarations.push({ ref, scope: record.scope, namespace: annotation.namespace,
          datumKey: annotation.datumKey, access: annotation.access });
      }
    }
  }
  return resolveLexicalBinding({ ...request, scopes, declarations });
};

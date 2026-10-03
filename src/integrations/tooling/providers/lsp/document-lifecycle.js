/** One owner for type and diagnostics-only document notification lifetimes. */
export const openOwnedLspDocument = ({ client, doc, uri, legacyUri, languageId, openDocs, registerDocument }) => {
  if (openDocs.has(doc.virtualPath)) return false;
  const version = 1;
  registerDocument?.(uri, version);
  if (legacyUri) registerDocument?.(legacyUri, version);
  openDocs.set(doc.virtualPath, { uri, legacyUri, version, lineIndex: null, text: doc.text || '', closed: false });
  client.notify('textDocument/didOpen', { textDocument: { uri, languageId, version, text: doc.text || '' } });
  return true;
};

export const closeOwnedLspDocument = ({ client, virtualPath, openDocs, unregisterDocument }) => {
  const entry = openDocs.get(virtualPath);
  if (!entry || entry.closed) return;
  entry.closed = true;
  unregisterDocument?.(entry.uri);
  if (entry.legacyUri) unregisterDocument?.(entry.legacyUri);
  try { client.notify('textDocument/didClose', { textDocument: { uri: entry.uri } }, { startIfNeeded: false }); } catch {}
};

export const closeOwnedLspDocuments = (input) => {
  for (const virtualPath of input.openDocs.keys()) closeOwnedLspDocument({ ...input, virtualPath });
  input.openDocs.clear();
};

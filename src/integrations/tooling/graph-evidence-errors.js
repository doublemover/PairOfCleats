export const classifyGraphEvidenceError = error => {
  const code = error?.code || 'ERR_GRAPH_EVIDENCE';
  const status = code === 'ERR_GRAPH_EVIDENCE_CONTRACT' || /_CURSOR_SCOPE$|_PAGE_BYTES$/.test(code) ? 400
    : /GENERATION/.test(code) ? 409 : /PAGING_UNAVAILABLE$/.test(code) || code === 'ENOENT' ? 404
      : code === 'ERR_UNSAFE_FILE_PATH' ? 403 : error?.name === 'AbortError' ? 499 : 500;
  return { status, code, message: error?.message || 'Graph evidence failed.' };
};

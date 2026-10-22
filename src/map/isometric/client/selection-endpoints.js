/** Explicitly distinguish file identity from member identity, including zero. */
export const endpointFile = (endpoint, fileByMember) => endpoint?.file
  ?? fileByMember?.get(endpoint?.member) ?? fileByMember?.get(String(endpoint?.member)) ?? null;

export const selectionEndpointMatcher = (info, { member = null, node = null, fileByMember = null } = {}) => {
  if (!info) return () => false;
  if (info.type === 'member' || (info.type !== 'file' && info.memberId != null)) {
    const id = member?.id ?? info.id ?? info.memberId;
    return endpoint => id != null && endpoint?.member != null && String(endpoint.member) === String(id);
  }
  const file = info.file ?? node?.path ?? node?.name ?? info.name;
  return endpoint => file != null && endpointFile(endpoint, fileByMember) === file;
};

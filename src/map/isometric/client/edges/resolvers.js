export const createEdgeResolvers = ({
  fileByMember,
  memberColorById,
  fileColorByPath,
  memberAnchors,
  fileAnchors,
  useMemberAnchors
}) => {
  const normalizeMemberId = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (value === 0) return '0';
    return String(value);
  };

  const resolveEdgeFile = (endpoint) => {
    if (!endpoint) return null;
    if (endpoint.file) return endpoint.file;
    const memberKey = normalizeMemberId(endpoint.member);
    if (memberKey) return fileByMember.get(memberKey) || fileByMember.get(endpoint.member) || null;
    return null;
  };

  const resolveEdgeColor = (endpoint) => {
    if (!endpoint) return null;
    const memberKey = normalizeMemberId(endpoint.member);
    if (memberKey && memberColorById.has(memberKey)) {
      return memberColorById.get(memberKey);
    }
    if (endpoint.member !== undefined && endpoint.member !== null && memberColorById.has(endpoint.member)) {
      return memberColorById.get(endpoint.member);
    }
    if (endpoint.file && fileColorByPath.has(endpoint.file)) {
      return fileColorByPath.get(endpoint.file);
    }
    const fileKey = resolveEdgeFile(endpoint);
    if (fileKey && fileColorByPath.has(fileKey)) {
      return fileColorByPath.get(fileKey);
    }
    return null;
  };

  const resolveAnchor = (endpoint, fileOverride) => {
    if (!endpoint) return null;
    if (useMemberAnchors) {
      const memberKey = normalizeMemberId(endpoint.member);
      if (memberKey && memberAnchors.has(memberKey)) return memberAnchors.get(memberKey);
      if (endpoint.member !== undefined && endpoint.member !== null && memberAnchors.has(endpoint.member)) {
        return memberAnchors.get(endpoint.member);
      }
    }
    if (endpoint.file && fileAnchors.has(endpoint.file)) return fileAnchors.get(endpoint.file);
    const fileKey = fileOverride || resolveEdgeFile(endpoint);
    if (fileKey && fileAnchors.has(fileKey)) return fileAnchors.get(fileKey);
    return null;
  };

  return {
    normalizeMemberId,
    resolveEdgeFile,
    resolveEdgeColor,
    resolveAnchor
  };
};

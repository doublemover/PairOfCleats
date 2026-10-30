import { lookupMemberIdentity } from '../data/member-identity.js';
export const createEdgeResolvers = ({
  fileByMember,
  memberColorById,
  fileColorByPath,
  memberAnchors,
  fileAnchors,
  useMemberAnchors,
  sourceIndex=null
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
    if (memberKey) return fileByMember.get(endpoint.member) || fileByMember.get(memberKey) || null;
    return null;
  };

  const resolveEdgeColor = (endpoint) => {
    if (!endpoint) return null;
    const memberColor=lookupMemberIdentity(memberColorById,endpoint.member,sourceIndex);
    if(memberColor)return memberColor;
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
      const memberAnchor=lookupMemberIdentity(memberAnchors,endpoint.member,sourceIndex);
      if(memberAnchor)return memberAnchor;
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

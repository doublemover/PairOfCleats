const stripGeneratedProtoBaseForMarker = (normalized, marker) => {
  if (typeof normalized !== 'string' || !normalized) return normalized;
  if (typeof marker !== 'string' || !marker) return normalized;
  const lower = normalized.toLowerCase();
  const lowerMarker = marker.toLowerCase();
  let cursor = normalized.length;
  while (cursor > 0) {
    const slash = normalized.lastIndexOf('/', cursor - 1);
    const dot = normalized.lastIndexOf('.', cursor - 1);
    if (dot <= slash || dot <= 0) break;
    cursor = dot;
    const markerStart = cursor - lowerMarker.length;
    if (markerStart < 0) continue;
    if (lower.slice(markerStart, cursor) === lowerMarker) {
      return normalized.slice(0, markerStart);
    }
  }
  return normalized;
};

export const stripGrpcPbGeneratedBase = (normalized) => (
  stripGeneratedProtoBaseForMarker(normalized, '.grpc.pb')
);

export const stripPbGeneratedBase = (normalized) => (
  stripGeneratedProtoBaseForMarker(normalized, '.pb')
);

const key = (type, value) => JSON.stringify([type, String(value)]);

// This indexes the available saved payload, independently of display/draw caps.
// It does not infer entities missing from that payload or fetch more evidence.
export const createSourceIndex = (map) => {
  const files = new Map(), members = new Map(), adjacency = new Map(), fileByMember = new Map();
  let memberCount=0;
  for (const file of Array.isArray(map?.nodes) ? map.nodes : []) {
    const path = file.path || file.name;
    if (!path) continue;
    files.set(path, file);
    for (const member of file.members || []) {
      memberCount++;
      if (member.id != null) {members.set(String(member.id), { file: path, member });fileByMember.set(String(member.id),path);}
    }
  }
  for (const edge of Array.isArray(map?.edges) ? map.edges : []) {
    const keys = new Set();
    for (const endpoint of [edge.from, edge.to]) {
      const owner = endpoint?.member != null ? members.get(String(endpoint.member))?.file : null;
      const file = endpoint?.file || owner;
      if (file) keys.add(key('file', file));
      if (endpoint?.member != null) keys.add(key('member', endpoint.member));
    }
    for (const value of keys) {
      if (!adjacency.has(value)) adjacency.set(value, []);
      adjacency.get(value).push(edge);
    }
  }
  return {
    snapshot: map,
    counts: { files:files.size,members:memberCount,edges:Array.isArray(map?.edges)?map.edges.length:0 },
    files,
    members,
    fileByMember,
    resolve(info) {
      if (!info) return null;
      if (info.type === 'member') {
        const found = members.get(String(info.id));
        if (!found || (info.file && info.file !== found.file)) return null;
        return { ...info, ...found.member, type: 'member', file: found.file };
      }
      const file = files.get(info.file || info.name);
      return file ? { ...info, type: 'file', file: file.path || file.name, name: file.name || file.path } : null;
    },
    relationships(info) {
      return info ? adjacency.get(key(info.type === 'member' ? 'member' : 'file', info.type === 'member' ? info.id : info.file)) || [] : [];
    }
  };
};

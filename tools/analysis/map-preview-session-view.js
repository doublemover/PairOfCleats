const frozenMetadata = new WeakSet();

/** Preview metadata is decoded local JSON. Freeze its existing read-only
 * identity tree without cloning the graph or eagerly copying pinned bytes. */
export const freezeMapPreviewMetadata = value => {
  const pending = [value], visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || visited.has(current) || frozenMetadata.has(current)) continue;
    visited.add(current);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(current))) {
      if (Object.hasOwn(descriptor, 'value')) pending.push(descriptor.value);
    }
    Object.freeze(current);
  }
  for (const current of visited) frozenMetadata.add(current);
  return value;
};

/** Ordinary inspection never exposes the mutable Map or serving buffers.
 * Copies are allocated only for bytes the caller explicitly requests. */
export const createMapPreviewSessionView = session => {
  const assets = session.assets;
  const copy = asset => asset ? Object.freeze({ bytes: Buffer.from(asset.bytes), sha256: asset.sha256, contentType: asset.contentType }) : undefined;
  const assetView = Object.freeze({
    get size() { return assets.size; },
    has: route => assets.has(route), get: route => copy(assets.get(route)),
    keys: () => assets.keys(),
    *values() { for (const asset of assets.values()) yield copy(asset); },
    *entries() { for (const [route, asset] of assets) yield [route, copy(asset)]; },
    *[Symbol.iterator]() { for (const [route, asset] of assets) yield [route, copy(asset)]; }
  });
  freezeMapPreviewMetadata(session.identity); freezeMapPreviewMetadata(session.unavailable);
  return Object.freeze({ assets: assetView, identity: session.identity, unavailable: session.unavailable,
    totalBytes: session.totalBytes, documentSha256: session.documentSha256, snapshotSha256: session.snapshotSha256,
    get html() { return Buffer.from(session.html); } });
};

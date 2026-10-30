import { admitOwnedSemanticSourceSnapshot } from '../../index/semantic/source-snapshot-admission.js';
import { semanticHash } from '../../index/semantic/identity.js';

/** package.json declarations only. Script strings are inert; versions are declarations, not resolved artifacts. */
export const projectPackageManifestFacet = ({ snapshot, worldRef }) => {
  const source = admitOwnedSemanticSourceSnapshot(snapshot, { maxBytes: 1024 * 1024 });
  if (source.manifest.path.split('/').at(-1) !== 'package.json') throw new TypeError('Bounded owned package.json snapshot required.');
  const value = JSON.parse(source.text.replace(/^\uFEFF/, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Package manifest object required.');
  const declarations = [];
  for (const section of ['scripts', 'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const values = value[section];
    if (values == null) continue;
    if (typeof values !== 'object' || Array.isArray(values)) throw new TypeError('Unsupported package declaration shape.');
    for (const name of Object.keys(values).sort()) {
      if (typeof values[name] !== 'string') throw new TypeError('Package declaration values must be strings.');
      declarations.push({ kind: section === 'scripts' ? 'declared-script' : 'declared-package-reference',
        section, name, value: values[name], jsonPointer: `/${section}/${name.replaceAll('~', '~0').replaceAll('/', '~1')}` });
    }
  }
  if (declarations.length > 4096) throw new RangeError('Package declaration allowance exceeded.');
  return { facetId: semanticHash('pairofcleats.package-declaration-facet.v1', { worldRef, sourceUnitId: snapshot.manifest.sourceUnitId }),
    kind: 'package-manifest', worldRef: structuredClone(worldRef), sourceRef: {
      sourceUnitId: snapshot.manifest.sourceUnitId, span: [0, source.text.length], coordinateUnit: 'utf16'
    }, declarations, qualification: { certainty: 'exact-source-declaration', execution: 'not-observed',
      testCoverage: 'not-established', resolvedDependencyVersion: 'not-established' } };
};

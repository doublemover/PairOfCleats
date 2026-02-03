const uniq = (values) => Array.from(new Set(values.filter(Boolean)));

const isSafeImportUrl = (value) => {
  if (typeof value !== 'string' || !value) return false;
  try {
    const resolved = new URL(value, window.location.href);
    return resolved.origin === window.location.origin;
  } catch {
    return false;
  }
};

const assertSafeImportUrl = (value, label) => {
  if (!isSafeImportUrl(value)) {
    throw new Error(`Unsafe module URL for ${label || 'module'}: ${value}`);
  }
};

const guessExamplesBases = (threeUrl) => {
  const bases = [];
  bases.push('/three/examples/jsm/');

  if (typeof threeUrl !== 'string' || !threeUrl) {
    return uniq(bases);
  }

  // Derive examples base from the configured threeUrl.
  try {
    const resolved = new URL(threeUrl, window.location.href);
    const path = resolved.pathname || '';

    // Typical: .../build/three.module.js
    let match = path.match(/^(.*)\/build\/[^/]+$/);
    if (match) {
      resolved.pathname = `${match[1]}/examples/jsm/`;
      resolved.search = '';
      resolved.hash = '';
      bases.push(resolved.toString());
      return uniq(bases);
    }

    // Some builds may omit the /build segment.
    match = path.match(/^(.*)\/three\.module(?:\.min)?\.js$/);
    if (match) {
      resolved.pathname = `${match[1]}/examples/jsm/`;
      resolved.search = '';
      resolved.hash = '';
      bases.push(resolved.toString());
      return uniq(bases);
    }
  } catch (err) {
    // Ignore; fall through to string heuristics.
  }

  const localMatch = threeUrl.match(/^(.*)\/build\/[^/]+$/);
  if (localMatch) {
    bases.push(`${localMatch[1]}/examples/jsm/`);
  }

  return uniq(bases);
};

const importFromBases = async (bases, relPath) => {
  const safeBases = bases.filter((base) => isSafeImportUrl(base));
  for (const base of safeBases) {
    try {
      return await import(`${base}${relPath}`);
    } catch (err) {
      // try next
    }
  }
  return null;
};

export const loadThreeModules = async (threeUrl) => {
  assertSafeImportUrl(threeUrl, 'three');
  const THREE = await import(threeUrl);
  let LineSegments2 = null;
  let LineSegmentsGeometry = null;
  let LineMaterial = null;

  const bases = guessExamplesBases(threeUrl);

  const modSegments2 = await importFromBases(bases, 'lines/LineSegments2.js');
  const modGeometry = await importFromBases(bases, 'lines/LineSegmentsGeometry.js');
  const modMaterial = await importFromBases(bases, 'lines/LineMaterial.js');

  LineSegments2 = modSegments2?.LineSegments2 || null;
  LineSegmentsGeometry = modGeometry?.LineSegmentsGeometry || null;
  LineMaterial = modMaterial?.LineMaterial || null;

  return { THREE, LineSegments2, LineSegmentsGeometry, LineMaterial };
};

export const loadRgbeLoader = async (url, threeUrl) => {
  if (url && isSafeImportUrl(url)) {
    try {
      const module = await import(url);
      return module.RGBELoader || null;
    } catch (err) {
      // fall through
    }
  }
  const bases = guessExamplesBases(threeUrl || url || '');
  const module = await importFromBases(bases, 'loaders/RGBELoader.js');
  return module?.RGBELoader || null;
};

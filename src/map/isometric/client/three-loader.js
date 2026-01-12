export const loadThreeModules = async (threeUrl) => {
  const THREE = await import(threeUrl);
  let LineSegments2 = null;
  let LineSegmentsGeometry = null;
  let LineMaterial = null;
  try {
    ({ LineSegments2 } = await import('/three/examples/jsm/lines/LineSegments2.js'));
    ({ LineSegmentsGeometry } = await import('/three/examples/jsm/lines/LineSegmentsGeometry.js'));
    ({ LineMaterial } = await import('/three/examples/jsm/lines/LineMaterial.js'));
  } catch (err) {
    LineSegments2 = null;
    LineSegmentsGeometry = null;
    LineMaterial = null;
  }
  return { THREE, LineSegments2, LineSegmentsGeometry, LineMaterial };
};

export const loadRgbeLoader = async (url) => {
  try {
    const module = await import(url || '/three/examples/jsm/loaders/RGBELoader.js');
    return module.RGBELoader || null;
  } catch (err) {
    return null;
  }
};

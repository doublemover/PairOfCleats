const buildLaneValues = (min, max, step) => {
  const values = [];
  if (!step || step <= 0) return values;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  for (let value = start; value <= end; value += step) {
    values.push(Number(value.toFixed(3)));
  }
  return values;
};

const segmentHitsObstacle = (x1, z1, x2, z2, obstacles, ignoreFiles) => {
  const dx = x2 - x1;
  const dz = z2 - z1;
  for (const obstacle of obstacles) {
    if (ignoreFiles && ignoreFiles.has(obstacle.file)) continue;
    const minX = obstacle.minX;
    const maxX = obstacle.maxX;
    const minZ = obstacle.minZ;
    const maxZ = obstacle.maxZ;
    const insideStart = x1 >= minX && x1 <= maxX && z1 >= minZ && z1 <= maxZ;
    const insideEnd = x2 >= minX && x2 <= maxX && z2 >= minZ && z2 <= maxZ;
    if (insideStart || insideEnd) return true;
    let t0 = 0;
    let t1 = 1;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };
    if (
      clip(-dx, x1 - minX)
      && clip(dx, maxX - x1)
      && clip(-dz, z1 - minZ)
      && clip(dz, maxZ - z1)
    ) {
      return true;
    }
  }
  return false;
};

const sqrt3 = Math.sqrt(3);
const toAxial = (point, size) => {
  const q = (sqrt3 / 3 * point.x - 1 / 3 * point.z) / size;
  const r = (2 / 3 * point.z) / size;
  return { q, r };
};
const axialToPoint = (axial, size) => ({
  x: size * sqrt3 * (axial.q + axial.r / 2),
  z: size * 1.5 * axial.r
});
const cubeRound = (cube) => {
  let rx = Math.round(cube.x);
  let ry = Math.round(cube.y);
  let rz = Math.round(cube.z);
  const dx = Math.abs(rx - cube.x);
  const dy = Math.abs(ry - cube.y);
  const dz = Math.abs(rz - cube.z);
  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }
  return { x: rx, y: ry, z: rz };
};
const axialToCube = (axial) => ({ x: axial.q, z: axial.r, y: -axial.q - axial.r });
const cubeToAxial = (cube) => ({ q: cube.x, r: cube.z });
const cubeLerp = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t
});
const cubeDistance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
const buildHexPath = (start, end, size) => {
  if (!size || size <= 0) return [start, end];
  const a = axialToCube(toAxial(start, size));
  const b = axialToCube(toAxial(end, size));
  const steps = Math.max(1, cubeDistance(a, b));
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    const cube = cubeRound(cubeLerp(a, b, t));
    points.push(axialToPoint(cubeToAxial(cube), size));
  }
  return points;
};

export const createRoutingHelpers = ({
  useRouting,
  layoutStyle,
  routingStep,
  layoutMetrics,
  routingPadding,
  obstacles,
  bounds
}) => {
  const useHexRouting = useRouting && layoutStyle === 'hex';
  const hexSize = Math.max(routingStep, (layoutMetrics.baseSize || 1) * 0.6);
  const minX = bounds?.minX ?? 0;
  const maxX = bounds?.maxX ?? 0;
  const minZ = bounds?.minZ ?? 0;
  const maxZ = bounds?.maxZ ?? 0;

  const findRoute = (start, end, ignoreFiles) => {
    if (!useRouting) return [start, end];
    let bestPoints = null;
    let bestDistance = Infinity;
    const tryPath = (points) => {
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        if (segmentHitsObstacle(a.x, a.z, b.x, b.z, obstacles, ignoreFiles)) return false;
      }
      let distance = 0;
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        distance += Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
      }
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPoints = points;
      }
      return true;
    };

    if (useHexRouting) {
      const hexPoints = buildHexPath(start, end, hexSize);
      let hits = false;
      for (let i = 0; i < hexPoints.length - 1; i += 1) {
        if (segmentHitsObstacle(hexPoints[i].x, hexPoints[i].z, hexPoints[i + 1].x, hexPoints[i + 1].z, obstacles, ignoreFiles)) {
          hits = true;
          break;
        }
      }
      if (!hits) return hexPoints;
    }

    const directA = [start, { x: end.x, z: start.z }, end];
    const directB = [start, { x: start.x, z: end.z }, end];
    const directAOk = tryPath(directA);
    const directBOk = tryPath(directB);
    if (directAOk || directBOk) {
      return bestPoints || directA;
    }

    const laneZ = buildLaneValues(minZ - routingPadding, maxZ + routingPadding, routingStep);
    for (const z of laneZ) {
      tryPath([start, { x: start.x, z }, { x: end.x, z }, end]);
    }
    const laneX = buildLaneValues(minX - routingPadding, maxX + routingPadding, routingStep);
    for (const x of laneX) {
      tryPath([start, { x, z: start.z }, { x, z: end.z }, end]);
    }
    return bestPoints || directA;
  };

  return {
    findRoute
  };
};

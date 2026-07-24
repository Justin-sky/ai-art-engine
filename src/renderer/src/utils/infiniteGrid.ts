import * as THREE from 'three'

export interface InfiniteGridOptions {
  cellSize?: number
  minorColor?: THREE.ColorRepresentation
  majorColor?: THREE.ColorRepresentation
  fadeDistance?: number
  /** 可视平面半径（米），实际为 2× 该值的正方形 */
  planeRadius?: number
}

export interface InfiniteGridHandle {
  mesh: THREE.Mesh
  setCellSize: (size: number) => void
  getCellSize: () => number
  setOffsetY: (y: number) => void
  updateCamera: (camera: THREE.Camera) => void
  disposeGrid: () => void
}

const vertexShader = /* glsl */ `
varying vec3 vWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`

const fragmentShader = /* glsl */ `
uniform float uCellSize;
uniform vec3 uMinorColor;
uniform vec3 uMajorColor;
uniform vec3 uCameraPosition;
uniform float uFadeNear;
uniform float uFadeFar;

varying vec3 vWorldPosition;

float gridLine(vec2 coord, float scale) {
  vec2 c = coord / scale;
  vec2 derivative = fwidth(c);
  vec2 grid = abs(fract(c - 0.5) - 0.5) / derivative;
  return 1.0 - min(min(grid.x, grid.y), 1.0);
}

void main() {
  vec2 coord = vWorldPosition.xz;
  float minor = gridLine(coord, uCellSize);
  float major = gridLine(coord, uCellSize * 10.0);
  float alpha = max(minor * 0.85, major);
  vec3 color = mix(uMinorColor, uMajorColor, major);

  float dist = length(vWorldPosition.xz - uCameraPosition.xz);
  alpha *= 1.0 - smoothstep(uFadeNear, uFadeFar, dist);

  if (alpha < 0.015) discard;
  gl_FragColor = vec4(color, alpha);
}
`

export function clampGridCellSize(size: number): number {
  if (!Number.isFinite(size)) return 1
  return Math.min(8, Math.max(0.5, Math.round(size * 4) / 4))
}

export function createInfiniteGrid(options: InfiniteGridOptions = {}): InfiniteGridHandle {
  const cellSize = options.cellSize ?? 1
  const planeRadius = options.planeRadius ?? 400
  let offsetY = 0

  const uniforms = {
    uCellSize: { value: cellSize },
    uMinorColor: { value: new THREE.Color(options.minorColor ?? 0x4a5568) },
    uMajorColor: { value: new THREE.Color(options.majorColor ?? 0x6b7f96) },
    uCameraPosition: { value: new THREE.Vector3() },
    uFadeNear: { value: planeRadius * 0.45 },
    uFadeFar: { value: options.fadeDistance ?? planeRadius * 0.95 }
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide
  })

  const size = planeRadius * 2
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.frustumCulled = false
  mesh.renderOrder = 1

  return {
    mesh,
    setCellSize: (size: number): void => {
      uniforms.uCellSize.value = size
    },
    getCellSize: (): number => uniforms.uCellSize.value,
    setOffsetY: (y: number): void => {
      offsetY = y
      mesh.position.y = y
    },
    updateCamera: (camera: THREE.Camera): void => {
      uniforms.uCameraPosition.value.copy(camera.position)
      mesh.position.x = camera.position.x
      mesh.position.z = camera.position.z
      mesh.position.y = offsetY
    },
    disposeGrid: (): void => {
      mesh.geometry.dispose()
      material.dispose()
    }
  }
}

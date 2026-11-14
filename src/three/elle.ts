import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** The downloaded parts share one skin and bind matrix; keep one GPU bone palette. */
export function prepareElle(root: THREE.Object3D) {
  const meshes: THREE.SkinnedMesh[] = []
  root.traverse((object) => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(object as THREE.SkinnedMesh)
  })
  const first = meshes[0]
  if (!first) throw new Error('Elle has no skinned meshes')
  const materials = meshes.map((mesh) => mesh.material as THREE.MeshStandardMaterial)
  const geometry = mergeGeometries(
    meshes.map((mesh) => mesh.geometry),
    true
  )
  if (!geometry) throw new Error('Elle mesh attributes cannot be merged')
  const body = new THREE.SkinnedMesh(geometry, materials)
  body.name = 'CharacterSurface'
  body.position.copy(first.position)
  body.quaternion.copy(first.quaternion)
  body.scale.copy(first.scale)
  body.bind(first.skeleton, first.bindMatrix)
  first.parent!.add(body)
  for (const mesh of meshes) {
    mesh.removeFromParent()
    mesh.geometry.dispose()
  }
  for (const material of materials) {
    const name = material.name
    material.metalness = Math.min(material.metalness, 0.15)
    material.roughness = Math.max(material.roughness, 0.65)
    if (name.includes('HAIR') || name.includes('FaceBrow')) material.userData.elleTone = 'silver'
    else if (name.includes('EyeIris')) {
      material.userData.elleTone = 'iris'
      material.emissive.setHex(0x116078)
      material.emissiveIntensity = 0.35
    } else if (name.includes('CLOTH_02') || name.includes('Accessory_Tie')) {
      material.userData.elleTone = 'cyan'
    }
  }
}

/** Shader treatment preserves the author's texture detail and UVs. Applied after
 * cloning because Three.js deliberately does not copy onBeforeCompile callbacks. */
export function styleElleMaterial(material: THREE.Material) {
  const tone = material.userData.elleTone
  if (!tone) return
  material.customProgramCacheKey = () => `elle-${tone}-1`
  material.onBeforeCompile = (shader) => {
    const replacement =
      tone === 'silver'
        ? 'diffuseColor.rgb = mix(vec3(0.12, 0.16, 0.23), vec3(0.88, 0.94, 1.0), pow(clamp(elleLuma * 3.0, 0.0, 1.0), 0.45));'
        : tone === 'iris'
          ? 'diffuseColor.rgb = vec3(0.06, 0.72, 0.95) * pow(elleLuma, 0.35);'
          : 'diffuseColor.rgb = vec3(0.15, 0.64, 0.82) * min(1.0, elleLuma * 1.8);'
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      #include <map_fragment>
      float elleLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      ${replacement}
    `
    )
  }
}

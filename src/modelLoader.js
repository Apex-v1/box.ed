// ============================================================================
// modelLoader.js — GLB model loading & caching for box.ed
// ============================================================================
//
// HOW THIS FITS INTO THE PROJECT:
//
//   1. Drop your .glb files into /public/models/ in your project.
//      Recommended naming: cd.glb, cassette.glb, floppy.glb, photo.glb,
//      postit.glb, manila.glb, box.glb. (Match the keys in MODEL_REGISTRY below.)
//
//   2. In your main entry point (index.js, main.jsx, or App.jsx — wherever
//      your app first mounts), import and call preloadModels() once on
//      startup. It returns a Promise that resolves when all models are loaded:
//
//        import { preloadModels } from './modelLoader.js';
//
//        preloadModels().then(() => {
//          // Now safe to render — getModel() will return cloned instances
//        });
//
//      You can also start rendering immediately and the maker functions will
//      fall back to procedural geometry until preloading finishes.
//
//   3. In your maker functions in box_ed_flow_prototype.jsx, check getModel()
//      and use the real model if available. Pattern:
//
//        function makeCD(color, title) {
//          const model = getModel('cd');
//          if (model) return applyCDTitle(model, color, title);
//          return makeProceduralCD(color, title); // existing code as fallback
//        }
//
// ----------------------------------------------------------------------------
// REAL-WORLD SIZING (added in v0.8)
// ----------------------------------------------------------------------------
// 3D models from different sources come in random scales — one might be in
// meters, another in centimeters, another in arbitrary "modeling units."
// We can't trust the file's intrinsic size.
//
// Instead, each entry in MODEL_REGISTRY declares a targetSize in scene units,
// based on real-world physical dimensions. After loading, we compute the
// model's bounding box and scale it so its largest dimension matches the
// target. This way the box and all items stay proportional regardless of
// how each modeler exported their file.
//
// SCENE UNIT CONVENTION:
//   1 scene unit ≈ 10 cm (so a 12 cm CD has targetSize 1.2)
//   This matches the procedural item sizes in box_ed_flow_prototype.jsx,
//   where boxSize for a medium box is ~3.1 units wide ≈ 31 cm.
// ============================================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ----------------------------------------------------------------------------
// MODEL_REGISTRY — files + target real-world sizes.
// Each entry: { path, targetSize }
//   path:       URL to the GLB file (served from /public/models/)
//   targetSize: scene units the model's longest dimension should occupy
//               (1 scene unit = 10 cm). See the table below for real-world refs.
//
// Real-world reference dimensions (longest side):
//   CD               12 cm   → 1.2
//   Cassette         10 cm   → 1.0
//   Floppy 3.5"       9.5 cm → 0.95
//   Photo (4×6)      15 cm   → 1.5
//   Photo (5×7)      18 cm   → 1.8
//   Post-it (3×3)     7.6 cm → 0.76
//   Manila folder    30 cm   → 3.0
//   VHS              18.7 cm → 1.87
//   USB stick         5 cm   → 0.5
//   Game cartridge    9 cm   → 0.9
//   Standard box     45 cm   → 4.5
// ----------------------------------------------------------------------------
const MODEL_REGISTRY = {
  cd:       { path: '/models/cd.glb',       targetSize: 1.2 },
  cassette: { path: '/models/cassette.glb', targetSize: 1.0 },
  floppy:   { path: '/models/floppy.glb',   targetSize: 0.95 },
  photo:    { path: '/models/photo.glb',    targetSize: 1.5 },
  postit:   { path: '/models/postit.glb',   targetSize: 0.76 },
  manila:   { path: '/models/manila.glb',   targetSize: 3.0 },
  box:      { path: '/models/box.glb',      targetSize: 4.5 },
  // Future additions:
  // vhs:      { path: '/models/vhs.glb',         targetSize: 1.87 },
  // 'cd-case':   { path: '/models/cd-case.glb',  targetSize: 1.4 },
  // 'dvd-case':  { path: '/models/dvd-case.glb', targetSize: 1.9 },
  // usb:      { path: '/models/usb.glb',         targetSize: 0.5 },
  // gameboy:  { path: '/models/gameboy-cart.glb', targetSize: 0.9 },
};

// ----------------------------------------------------------------------------
// Internal cache: id → loaded GLTF scene (THREE.Group), pre-scaled to target size.
// Calling getModel(id) returns a cloned instance, never the original.
// ----------------------------------------------------------------------------
const modelCache = new Map();
let preloadPromise = null;

/**
 * Normalize a loaded model: scale so its largest dimension matches the target,
 * recenter horizontally so its center sits at x=0, z=0, and place its bottom
 * at y=0 so it rests on the floor cleanly.
 *
 * Doing this once on the cached scene means every clone returned by getModel()
 * inherits the correct size and pivot.
 */
function normalizeModelSize(scene, targetSize, id) {
  // Compute bounding box in the model's native scale
  const bbox = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const largestDim = Math.max(size.x, size.y, size.z);
  if (largestDim === 0) {
    console.warn(`[modelLoader] ${id} has zero-size bounding box — skipping normalize`);
    return;
  }

  // Scale uniformly so the largest dimension equals targetSize
  const scaleFactor = targetSize / largestDim;
  scene.scale.setScalar(scaleFactor);

  // Recompute bounding box in post-scale units, then center horizontally and
  // rest the bottom at y=0. (Must recompute because scaling changed everything.)
  scene.updateMatrixWorld(true);
  const scaledBbox = new THREE.Box3().setFromObject(scene);
  const scaledCenter = new THREE.Vector3();
  scaledBbox.getCenter(scaledCenter);
  scene.position.x -= scaledCenter.x;
  scene.position.z -= scaledCenter.z;
  scene.position.y -= scaledBbox.min.y;

  console.log(`[modelLoader] ${id} normalized: native ${largestDim.toFixed(2)} → target ${targetSize} (×${scaleFactor.toFixed(3)})`);
}

/**
 * Preload all models declared in MODEL_REGISTRY in parallel.
 * Safe to call multiple times — returns the same Promise on subsequent calls.
 * Models that fail to load (e.g. missing file) are skipped silently and the
 * corresponding getModel() call will return null, triggering procedural fallback.
 *
 * @returns {Promise<void>} resolves when all models have loaded (or failed)
 */
export function preloadModels() {
  if (preloadPromise) return preloadPromise;

  const loader = new GLTFLoader();
  // Optional: add Draco compression support for smaller files.
  // const draco = new DRACOLoader();
  // draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
  // loader.setDRACOLoader(draco);

  const tasks = Object.entries(MODEL_REGISTRY).map(([id, entry]) =>
    loader.loadAsync(entry.path)
      .then((gltf) => {
        const scene = gltf.scene;
        // Walk the model and prepare meshes for shadows
        scene.traverse((obj) => {
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
        // Normalize the model to its target real-world size
        normalizeModelSize(scene, entry.targetSize, id);
        modelCache.set(id, scene);
        console.log(`[modelLoader] loaded ${id}`);
      })
      .catch((err) => {
        console.warn(`[modelLoader] couldn't load ${id} from ${entry.path} — falling back to procedural`, err.message);
      })
  );

  preloadPromise = Promise.all(tasks).then(() => undefined);
  return preloadPromise;
}

/**
 * Get a cloned instance of a loaded model, pre-scaled to its target real-world size.
 * Returns null if the model isn't loaded yet (or failed to load) — callers should
 * fall back to procedural geometry in that case.
 *
 * @param {string} id — entry from MODEL_REGISTRY, e.g. 'cd', 'cassette'
 * @returns {THREE.Group|null} a fresh clone of the model, or null
 */
export function getModel(id) {
  const cached = modelCache.get(id);
  if (!cached) return null;
  // Use SkeletonUtils.clone() if your models have skinned meshes / animations.
  // For static props, .clone(true) is enough.
  return cached.clone(true);
}

/**
 * Find a named mesh inside a model. Useful for applying labels to specific
 * surfaces (e.g. the disc face of a CD, the label panel of a cassette).
 *
 * In your modeling tool, name the relevant mesh (e.g. "CD_Face", "Cassette_Label",
 * "Box_FrontWall", "Box_Label_Plane") and you'll be able to target it here.
 *
 * @param {THREE.Object3D} root — the cloned model returned by getModel()
 * @param {string} meshName — the name set in the modeling tool
 * @returns {THREE.Mesh|null}
 */
export function findMeshByName(root, meshName) {
  return root.getObjectByName(meshName) || null;
}

/**
 * Apply a label texture to a named mesh inside a model.
 * The label texture comes from one of the texture maker functions
 * (makeCDFaceTexture, makeCassetteLabelTexture, etc.)
 *
 * @param {THREE.Object3D} root — the cloned model
 * @param {string} meshName — name of the surface to label
 * @param {THREE.Texture} texture — the canvas texture to apply
 * @param {object} matOptions — optional material overrides (metalness, roughness, etc.)
 */
export function applyLabelToMesh(root, meshName, texture, matOptions = {}) {
  const mesh = findMeshByName(root, meshName);
  if (!mesh) {
    console.warn(`[modelLoader] no mesh named "${meshName}" found — label not applied`);
    return false;
  }
  mesh.material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.5,
    metalness: 0.2,
    ...matOptions,
  });
  return true;
}

/**
 * Convenience: returns true if a model is loaded for the given id.
 * Useful for conditional logic outside the maker functions.
 */
export function hasModel(id) {
  return modelCache.has(id);
}

/**
 * Get the target size for a given item type. Useful for the maker functions
 * to know the canonical size if they need it (e.g. for positioning).
 *
 * @returns {number|null} target size in scene units, or null if not registered
 */
export function getTargetSize(id) {
  return MODEL_REGISTRY[id]?.targetSize ?? null;
}

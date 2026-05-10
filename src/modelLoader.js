// ============================================================================
// modelLoader.js — GLB model loading & caching for box.ed
// ============================================================================
//
// HOW THIS FITS INTO THE PROJECT:
//
//   1. Drop your .glb files into /public/models/ in your project.
//      Recommended naming: cd.glb, cassette.glb, floppy.glb, photo.glb,
//      postit.glb, manila.glb, box.glb. (Match the names in MODEL_PATHS below.)
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
// ============================================================================
// IMPORTANT: This file uses GLTFLoader from three's examples folder. In your
// real project (not the artifact sandbox) the imports below will work because
// the full three package is installed.
// ============================================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ----------------------------------------------------------------------------
// MODEL_PATHS — registry of which item types map to which files.
// Add or remove entries as you acquire models.
// Items NOT listed here will fall back to procedural geometry forever.
// ----------------------------------------------------------------------------
const MODEL_PATHS = {
  cd:       '/models/cd.glb',
  cassette: '/models/cassette.glb',
  floppy:   '/models/floppy.glb',
  photo:    '/models/photo.glb',
  postit:   '/models/postit.glb',
  manila:   '/models/manila.glb',
  box:      '/models/box.glb',
  // Future additions:
  // 'cd-case':   '/models/cd-case.glb',
  // 'dvd-case':  '/models/dvd-case.glb',
  // 'vhs':       '/models/vhs.glb',
  // 'usb':       '/models/usb.glb',
  // 'gameboy':   '/models/gameboy-cart.glb',
  // ...
};

// ----------------------------------------------------------------------------
// Internal cache: id → loaded GLTF scene (THREE.Group).
// Calling getModel(id) returns a cloned instance, never the original.
// ----------------------------------------------------------------------------
const modelCache = new Map();
let preloadPromise = null;

/**
 * Preload all models declared in MODEL_PATHS in parallel.
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

  const tasks = Object.entries(MODEL_PATHS).map(([id, path]) =>
    loader.loadAsync(path)
      .then((gltf) => {
        modelCache.set(id, gltf.scene);
        // Walk the model and prepare meshes for shadows
        gltf.scene.traverse((obj) => {
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
        console.log(`[modelLoader] loaded ${id}`);
      })
      .catch((err) => {
        console.warn(`[modelLoader] couldn't load ${id} from ${path} — falling back to procedural`, err.message);
      })
  );

  preloadPromise = Promise.all(tasks).then(() => undefined);
  return preloadPromise;
}

/**
 * Get a cloned instance of a loaded model. Returns null if the model isn't
 * loaded yet (or failed to load) — callers should fall back to procedural
 * geometry in that case.
 *
 * @param {string} id — entry from MODEL_PATHS, e.g. 'cd', 'cassette'
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

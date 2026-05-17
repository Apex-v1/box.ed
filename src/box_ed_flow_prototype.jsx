import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { preloadModels, getModel, applyLabelToMesh } from './modelLoader.js';

// ============================================================================
// box.ed prototype — v0.7
// ============================================================================
//
// FILE STRUCTURE (top to bottom):
//
//   1. App component (BoxedFlowPrototype)
//        — owns the boxes[] data model, view state, and popup state
//        — passes data + handlers down to scene components
//
//   2. WindowedOverlay
//        — mac-style window chrome that contains Office Biz / BizBay popups
//
//   3. FloorScene + initFloorScene
//        — the persistent 3D background; boxes lying on a concrete floor
//        — handles drag-to-move, delivery animations, and click-to-open
//
//   4. OpenBox + initOpenBoxScene
//        — the inside-of-a-box view (orthographic isometric camera)
//        — handles item drag with dangle physics, right-click context menu,
//          box-side label editing, and the close (break-down) animation
//
//   5. OfficeBizStore + product list
//        — the Office Depot knockoff that lets you "buy" a new box
//
//   6. BizBayStore + BizBayLinkEntry + mockScrape
//        — the eBay knockoff that lets you "buy" item types and paste URLs
//
//   7. Geometry makers (makeFloorBox, makeOpenBox, makeCD, makeCassette, ...)
//        — procedural Three.js geometry for the prototype
//
//   8. Texture makers (makeCardboardTexture, makeCDFaceTexture, ...)
//        — canvas-based procedural textures for cardboard, marker scrawl, etc.
//
// ============================================================================
// HOW TO REPLACE PROCEDURAL GEOMETRY WITH REAL 3D MODELS (e.g. from Meshy)
// ============================================================================
//
// The prototype builds every 3D object out of primitives (boxes, cylinders,
// planes). When you want to swap in proper modelled assets, the pattern is:
//
//   1. THE LOADER. Three.js ships a loader for glTF / GLB files in its
//      /examples/jsm/loaders/ folder. The class is named GLTFLoader. In a
//      Vite, Next.js, or CRA project you would add it to this file's import
//      block at the top. (We don't import it here because this prototype
//      runs in a sandbox that only allows the core "three" package.) For
//      compressed assets there is also a DRACOLoader (same folder).
//
//   2. FILE LOCATION. Drop your .glb / .gltf exports into /public/models/
//      (Vite, Next.js, Vercel) or whatever your host's static-asset folder is.
//
//   3. PRELOAD + CACHE. Don't load every render — load once at app startup
//      and cache the result. Pseudo-code:
//
//        // at module top, after imports:
//        // const loader = new GLTFLoader();
//        // const cdModelPromise = loader.loadAsync('/models/cd.glb');
//
//        // in a top-level useEffect:
//        // cdModelPromise.then(g => { window._cdModel = g; });
//
//      (In real code put this in a context provider or a useRef on App,
//      not on window — this is just to show the shape.)
//
//   4. SWAP THE MAKER. In each geometry function below (makeCD, makeCassette,
//      etc.), clone the loaded scene instead of building primitives, then
//      apply the marker label as a separate textured plane. Sketch:
//
//        function makeCD(color, title) {
//          const instance = cdModel.scene.clone();
//          // Find the disc face by mesh name (set this in your 3D tool):
//          const face = instance.getObjectByName('CD_Face');
//          if (face) {
//            face.material = new THREE.MeshStandardMaterial({
//              map: makeCDFaceTexture(color, title),
//              metalness: 0.6,
//              roughness: 0.32,
//            });
//          }
//          return instance;
//        }
//
//      The label texture function (makeCDFaceTexture, etc.) stays the same —
//      it's just applied to a different mesh than the procedural one.
//
// MESHY EXPORT TIPS:
//   - Export as GLB (binary glTF) — single file, embedded textures, smaller.
//   - Name important meshes in the modelling tool ("CD_Face", "Cassette_Label",
//     "Box_FrontFace") so getObjectByName() works.
//   - Keep meshes upright (Y-up) and centered at origin so they drop in place.
//   - For text labels, use blank plane meshes (no baked text) and apply our
//     canvas textures at runtime — Meshy's text rendering is unreliable.
//   - For production, look into the Draco compression loader and KTX2 textures
//     for big size wins. Both ship in the Three.js examples folder.
//
// ============================================================================

const BG_COLOR = '#f0ece5';

// ============================================================
// App — coordinates the two 3D views and the two popups
// ============================================================
export default function BoxedFlowPrototype() {
  // ----- View / popup state -----
  const [view, setView] = useState('floor');         // 'floor' | 'openbox'
  const [popup, setPopup] = useState(null);           // null | 'storefront' | 'additem'
  const [bizbayUrl, setBizbayUrl] = useState('bizbay.biz/all-categories');

  // ----- Per-box data model -----
  // The single source of truth: every box on the floor (and its contents) lives
  // in this array. The active open box is identified by activeBoxId.
  const [boxes, setBoxes] = useState(() => DEFAULT_BOXES);
  const [activeBoxId, setActiveBoxId] = useState(null);

  // Derived state — convenient to pass into OpenBox below
  const activeBox = boxes.find((b) => b.id === activeBoxId) || null;

  // ----- Font preload -----
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Anton&family=Permanent+Marker&family=Kalam:wght@400;700&display=swap';
    document.head.appendChild(link);
    return () => { if (link.parentNode) link.parentNode.removeChild(link); };
  }, []);

  // Preload 3D models in the background. Until each model loads, the maker
  // functions fall back to procedural geometry, so the app is fully usable
  // immediately. As real models become available they'll appear on next render
  // (e.g. next time you open a box, the items inside use the real geometry).
  useEffect(() => {
    preloadModels().then(() => {
      console.log('[box.ed] all available models loaded');
    });
  }, []);

  // ===== Box-level handlers =====

  // Called from FloorScene when the user clicks a box on the floor
  const handleOpenBox = (boxId) => {
    setActiveBoxId(boxId);
    setView('openbox');
  };

  // Called from OpenBox when the close animation finishes
  const handleClosedBox = () => {
    setView('floor');
    // Keep activeBoxId so the floor scene knows which box just closed (in case
    // we want to highlight or center on it later). Cleared on next selection.
  };

  // Buying a box from Office Biz adds a new closed box to the floor with a
  // delivery-from-above animation. We DON'T immediately open it — landing on
  // the floor first lets the user feel the lifecycle: arrive → click → open.
  const handleBuyBox = (product) => {
    const newId = 'box_' + Date.now();
    setBoxes((prev) => [
      ...prev,
      {
        id: newId,
        styleId: product.id,
        name: product.name,
        aspect: product.aspect,
        label: '',                              // user fills in later via box-side label edit
        items: [],
        floorPos: pickFreeFloorSpot(prev),      // doesn't overlap existing boxes
        isNew: true,                            // FloorScene consumes this for delivery anim
      },
    ]);
    setPopup(null);
  };

  // Update label on the active box
  const handleSetActiveBoxLabel = (label) => {
    if (!activeBoxId) return;
    setBoxes((prev) => prev.map((b) => (b.id === activeBoxId ? { ...b, label } : b)));
  };

  // ===== Item-level handlers (operate on the active box) =====

  const handleAddItem = (newItem) => {
    if (!activeBox) return;
    const itemWithIdAndPos = {
      ...newItem,
      id: 'item_' + Date.now(),
      position: pickFreeSpot(activeBox.items, activeBox),
    };
    setBoxes((prev) =>
      prev.map((b) =>
        b.id === activeBoxId ? { ...b, items: [...b.items, itemWithIdAndPos] } : b
      )
    );
    setPopup(null);
    setBizbayUrl('bizbay.biz/all-categories');
  };

  const handleDeleteItem = (itemId) => {
    if (!activeBoxId) return;
    setBoxes((prev) =>
      prev.map((b) =>
        b.id === activeBoxId ? { ...b, items: b.items.filter((it) => it.id !== itemId) } : b
      )
    );
  };

  const handleEditItemTitle = (itemId, newTitle) => {
    if (!activeBoxId) return;
    setBoxes((prev) =>
      prev.map((b) =>
        b.id === activeBoxId
          ? {
              ...b,
              items: b.items.map((it) =>
                it.id === itemId
                  // Bump _version so the scene knows to re-render this item's mesh
                  ? { ...it, title: newTitle, _version: (it._version || 0) + 1 }
                  : it
              ),
            }
          : b
      )
    );
  };

  // Called from FloorScene after a box's delivery-from-above animation completes,
  // so we can clear the isNew flag and the next render won't try to animate it again.
  const handleDeliveryComplete = (boxId) => {
    setBoxes((prev) => prev.map((b) => (b.id === boxId ? { ...b, isNew: false } : b)));
  };

  // ----- Render -----
  return (
    <div style={{ width: '100%', height: '100vh', overflow: 'hidden', background: BG_COLOR, position: 'relative' }}>
      {view === 'floor' && (
        <FloorScene
          boxes={boxes}
          onSelectBox={() => setPopup('storefront')}
          onOpenBox={handleOpenBox}
          onDeliveryComplete={handleDeliveryComplete}
        />
      )}
      {view === 'openbox' && activeBox && (
        <OpenBox
          boxStyle={{ name: activeBox.name, aspect: activeBox.aspect, capacity: 50 }}
          items={activeBox.items}
          boxLabel={activeBox.label}
          onClose={handleClosedBox}
          onAdd={() => setPopup('additem')}
          onDeleteItem={handleDeleteItem}
          onEditItemTitle={handleEditItemTitle}
          onBoxLabelChange={handleSetActiveBoxLabel}
        />
      )}

      {popup === 'storefront' && (
        <WindowedOverlay url="office-biz.biz/moving-boxes" onClose={() => setPopup(null)}>
          <OfficeBizStore onSelect={handleBuyBox} />
        </WindowedOverlay>
      )}
      {popup === 'additem' && (
        <WindowedOverlay url={bizbayUrl} onClose={() => { setPopup(null); setBizbayUrl('bizbay.biz/all-categories'); }}>
          <BizBayStore onComplete={handleAddItem} onUrlChange={setBizbayUrl} />
        </WindowedOverlay>
      )}
    </div>
  );
}

// Pick a non-overlapping spot inside the open box for a newly-added item (best-effort).
// Tries 30 random positions, falls back to a possibly-overlapping spot if all fail.
function pickFreeSpot(existingItems, box) {
  const aspect = box?.aspect || { w: 1.55, h: 1.0, d: 1.2 };
  const ix = (2.0 * aspect.w) * 0.5 - 0.2;
  const iz = (2.0 * aspect.d) * 0.5 - 0.2;
  for (let attempt = 0; attempt < 30; attempt++) {
    const x = (Math.random() - 0.5) * 2 * ix;
    const z = (Math.random() - 0.5) * 2 * iz;
    let ok = true;
    for (const it of existingItems) {
      const dx = it.position.x - x;
      const dz = it.position.z - z;
      if (dx * dx + dz * dz < 0.18) { ok = false; break; }
    }
    if (ok) return { x, y: 0.05 + Math.random() * 0.06, z };
  }
  return { x: (Math.random() - 0.5) * ix, y: 0.14, z: (Math.random() - 0.5) * iz };
}

// Pick a non-overlapping floor position for a newly-delivered box.
// The floor is roughly 26x26 world units; we keep boxes in the central 16x16
// area and try to avoid stacking on top of existing boxes' bounding regions.
function pickFreeFloorSpot(existingBoxes) {
  const range = 6;          // half-width of the central placement zone
  const minSep = 2.6;       // minimum center-to-center distance
  for (let attempt = 0; attempt < 40; attempt++) {
    const x = (Math.random() - 0.5) * 2 * range;
    const z = (Math.random() - 0.5) * 2 * range;
    let ok = true;
    for (const b of existingBoxes) {
      const dx = b.floorPos.x - x;
      const dz = b.floorPos.z - z;
      if (dx * dx + dz * dz < minSep * minSep) { ok = false; break; }
    }
    if (ok) return { x, z };
  }
  // Couldn't find a clear spot — pick a ring around origin
  const angle = Math.random() * Math.PI * 2;
  return { x: Math.cos(angle) * (range - 1), z: Math.sin(angle) * (range - 1) };
}

// ============================================================
// DEFAULT_BOXES — the three starter boxes the user sees on first load.
// Each box is a self-contained record: style/aspect for 3D rendering,
// label text, position on the floor, and the items inside.
// ============================================================
const DEFAULT_BOXES = [
  {
    id: 'box_taxes',
    styleId: 'cube-s',
    name: 'Standard Cube',
    aspect: { w: 1.0, h: 1.0, d: 1.0 },
    label: 'TAX RETURNS',
    floorPos: { x: -4.0, z: -1.2 },
    items: [
      { id: 't1', type: 'floppy', color: '#3a3a44', title: 'TAXES 2019', position: { x: -0.20, y: 0.05, z: -0.10 }, rotation:  0.2 },
      { id: 't2', type: 'floppy', color: '#3a3a44', title: 'TAXES 2020', position: { x:  0.15, y: 0.05, z:  0.05 }, rotation: -0.3 },
      { id: 't3', type: 'floppy', color: '#3a3a44', title: 'TAXES 2021', position: { x: -0.05, y: 0.10, z:  0.20 }, rotation:  0.5 },
      { id: 't4', type: 'manila', color: '#dcc88c', title: 'receipts',    position: { x:  0.10, y: 0.05, z: -0.15 }, rotation:  0.1 },
      { id: 't5', type: 'postit', color: '#f6e572', title: 'CALL CPA',   position: { x: -0.20, y: 0.05, z:  0.30 }, rotation: -0.2 },
    ],
  },
  {
    id: 'box_mom',
    styleId: 'std-m',
    name: 'Move-It Standard, Medium',
    aspect: { w: 1.55, h: 1.0, d: 1.2 },
    label: "MOM'S HOUSE",
    floorPos: { x: -0.2, z: -3.0 },
    items: [
      { id: 's1',  type: 'cd',       color: '#3088c8', title: 'SUMMER 07',   position: { x: -0.55, y: 0.05, z:  0.30 }, rotation:  0.3 },
      { id: 's2',  type: 'cd',       color: '#d04848', title: 'ROAD TRIP 4', position: { x:  0.18, y: 0.05, z:  0.55 }, rotation: -0.5 },
      { id: 's3',  type: 'cd',       color: '#e8c038', title: "MOM'S MIX",   position: { x:  0.55, y: 0.05, z: -0.10 }, rotation:  0.9 },
      { id: 's4',  type: 'photo',    color: '#e89868', title: 'beach 2019',  position: { x: -0.20, y: 0.04, z: -0.50 }, rotation: -0.4 },
      { id: 's5',  type: 'photo',    color: '#88a8c8', title: 'mtn hike',    position: { x:  0.45, y: 0.10, z:  0.05 }, rotation:  0.7 },
      { id: 's6',  type: 'cassette', color: '#202024', title: 'DEMO TAPE',   position: { x: -0.55, y: 0.07, z: -0.10 }, rotation:  0.2 },
      { id: 's7',  type: 'floppy',   color: '#3a3a44', title: 'taxes.xls',   position: { x:  0.05, y: 0.06, z: -0.20 }, rotation: -0.9 },
      { id: 's8',  type: 'floppy',   color: '#d04888', title: 'design',      position: { x: -0.10, y: 0.13, z:  0.10 }, rotation:  0.4 },
      { id: 's9',  type: 'postit',   color: '#f6e572', title: 'remind me',   position: { x:  0.30, y: 0.04, z: -0.45 }, rotation: -0.2 },
      { id: 's10', type: 'manila',   color: '#dcc88c', title: 'old work',    position: { x: -0.30, y: 0.05, z:  0.50 }, rotation:  0.2 },
    ],
  },
  {
    id: 'box_college',
    styleId: 'std-l',
    name: 'Move-It Standard, Large',
    aspect: { w: 1.7, h: 1.4, d: 1.55 },
    label: 'COLLEGE',
    floorPos: { x: 3.7, z: -0.9 },
    items: [
      { id: 'c1', type: 'cd',       color: '#3088c8', title: 'DORM MIX',     position: { x: -0.50, y: 0.05, z:  0.40 }, rotation:  0.2 },
      { id: 'c2', type: 'cd',       color: '#86b817', title: 'STUDY BEATS', position: { x:  0.55, y: 0.05, z: -0.30 }, rotation: -0.4 },
      { id: 'c3', type: 'cd',       color: '#d04848', title: 'PARTY 09',     position: { x:  0.20, y: 0.10, z:  0.10 }, rotation:  0.8 },
      { id: 'c4', type: 'photo',    color: '#88a8c8', title: 'roomies',      position: { x:  0.05, y: 0.04, z:  0.65 }, rotation:  0.6 },
      { id: 'c5', type: 'photo',    color: '#e89868', title: 'graduation',  position: { x:  0.50, y: 0.10, z:  0.50 }, rotation: -0.3 },
      { id: 'c6', type: 'cassette', color: '#202024', title: 'DEMO 04',      position: { x: -0.60, y: 0.07, z: -0.40 }, rotation:  0.3 },
      { id: 'c7', type: 'manila',   color: '#dcc88c', title: 'thesis',       position: { x:  0.20, y: 0.05, z: -0.60 }, rotation:  0.0 },
      { id: 'c8', type: 'postit',   color: '#a8d8ec', title: 'remember!',   position: { x: -0.65, y: 0.05, z:  0.55 }, rotation: -0.5 },
    ],
  },
];

// ============================================================
// Window chrome wrapper — popup with macOS-style chrome over scene
// ============================================================
function WindowedOverlay({ url, onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(20, 18, 14, 0.42)',
        backdropFilter: 'blur(1px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '92%',
          maxWidth: 1120,
          height: '90%',
          maxHeight: 820,
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 24px 64px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.2)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            background: 'linear-gradient(to bottom, #ecebe6, #dcd9d1)',
            padding: '9px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            borderBottom: '1px solid #c8c5be',
          }}
        >
          <div style={{ display: 'flex', gap: 7 }}>
            <div onClick={onClose} title="close" style={{ width: 13, height: 13, borderRadius: '50%', background: '#ff5f57', cursor: 'pointer', border: '1px solid rgba(0,0,0,0.1)' }} />
            <div style={{ width: 13, height: 13, borderRadius: '50%', background: '#ffbd2e', border: '1px solid rgba(0,0,0,0.1)' }} />
            <div style={{ width: 13, height: 13, borderRadius: '50%', background: '#28c941', border: '1px solid rgba(0,0,0,0.1)' }} />
          </div>
          <div
            style={{
              flex: 1,
              background: '#fff',
              padding: '5px 12px',
              borderRadius: 5,
              border: '1px solid #c5c1ba',
              fontSize: 12,
              color: '#666',
              fontFamily: 'Helvetica, Arial, sans-serif',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              maxWidth: 540,
              margin: '0 auto',
            }}
          >
            <span style={{ color: '#28a05a', fontSize: 11 }}>🔒</span>
            {url}
          </div>
          <div style={{ width: 50 }} />
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

// ============================================================
// Floor scene — persistent 3D background
// ============================================================
// FloorScene — the persistent floor view. Reads `boxes` from React state and
// keeps the 3D scene in sync via a setBoxes API. New boxes (isNew=true) get
// a delivery-from-above animation; the scene calls onDeliveryComplete when
// the animation finishes so the App can clear the isNew flag.
function FloorScene({ boxes, onSelectBox, onOpenBox, onDeliveryComplete }) {
  const mountRef = useRef(null);
  const sceneApiRef = useRef(null);

  // Refs so the scene callbacks always see the latest data without re-init
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const onOpenRef = useRef(onOpenBox);
  onOpenRef.current = onOpenBox;
  const onDeliveryRef = useRef(onDeliveryComplete);
  onDeliveryRef.current = onDeliveryComplete;

  // Init scene once on mount. Subsequent box list changes flow through setBoxes.
  useEffect(() => {
    if (!mountRef.current) return;
    let cancelled = false;
    Promise.all([
      document.fonts.load('400 200px "Permanent Marker"'),
      document.fonts.load('400 70px "Permanent Marker"'),
      document.fonts.load('400 14px "Kalam"'),
    ]).then(() => {
      if (!cancelled) {
        sceneApiRef.current = initFloorScene(mountRef.current, {
          onOpenBox: (id) => onOpenRef.current?.(id),
          onDeliveryComplete: (id) => onDeliveryRef.current?.(id),
        });
        // Push the initial box list into the scene
        sceneApiRef.current?.setBoxes(boxesRef.current);
      }
    });
    return () => {
      cancelled = true;
      sceneApiRef.current?.cleanup();
      sceneApiRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When boxes change (new box bought, label edited, items added), sync the scene
  useEffect(() => {
    sceneApiRef.current?.setBoxes(boxes);
  }, [boxes]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: BG_COLOR }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      <div
        onClick={onSelectBox}
        style={{
          position: 'absolute',
          top: 28,
          left: '50%',
          transform: 'translateX(-50%) rotate(-1.5deg)',
          background: 'linear-gradient(to bottom, #ecdca8, #d4c07c)',
          padding: '12px 36px',
          fontFamily: '"Permanent Marker", cursive',
          fontSize: 22,
          letterSpacing: 1,
          color: '#1d1410',
          cursor: 'pointer',
          boxShadow: '0 3px 8px rgba(0,0,0,0.14)',
          border: '1px solid rgba(0,0,0,0.05)',
          userSelect: 'none',
        }}
      >
        Select Box
      </div>

      <div
        style={{
          position: 'absolute',
          top: 24,
          left: 26,
          fontFamily: '"Kalam", cursive',
          color: '#5a4f42',
          fontSize: 13,
          opacity: 0.78,
          pointerEvents: 'none',
          lineHeight: 1.5,
          maxWidth: 280,
        }}
      >
        {boxes.length} box{boxes.length === 1 ? '' : 'es'} on the floor
        <br />
        click a box to open · drag to move · scroll to zoom
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 22,
          right: 26,
          fontFamily: '"Kalam", cursive',
          color: '#9a8d78',
          fontSize: 12,
          opacity: 0.55,
          pointerEvents: 'none',
        }}
      >
        prototype · v0.7
      </div>
    </div>
  );
}

// ============================================================
// OpenBox — top-down 3D view of an opened box
// ============================================================
function OpenBox({ boxStyle, items, boxLabel, onClose, onAdd, onDeleteItem, onEditItemTitle, onBoxLabelChange }) {
  const mountRef = useRef(null);
  const sceneApiRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Context menu position + which item it's for
  const [contextMenu, setContextMenu] = useState(null); // { x, y, itemId } | null
  // Inline title editor for editing an item
  const [editingItem, setEditingItem] = useState(null); // { id, title, x, y } | null
  // Inline box label editor
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(boxLabel || '');
  // Closing animation in progress — disables interactions while flaps fold
  const [closing, setClosing] = useState(false);

  // Keep label draft in sync when the prop changes
  useEffect(() => { setLabelDraft(boxLabel || ''); }, [boxLabel]);

  // Init the scene once per boxStyle (re-init only when box changes)
  useEffect(() => {
    if (!mountRef.current) return;
    let cancelled = false;
    Promise.all([
      document.fonts.load('400 70px "Permanent Marker"'),
      document.fonts.load('400 60px "Permanent Marker"'),
      document.fonts.load('400 14px "Kalam"'),
    ]).then(() => {
      if (!cancelled) {
        sceneApiRef.current = initOpenBoxScene(mountRef.current, boxStyle, itemsRef.current, boxLabel || '', {
          onItemContextMenu: (itemId, screenX, screenY) => {
            setContextMenu({ x: screenX, y: screenY, itemId });
          },
          onBoxClick: () => {
            // Open box-label editor when user clicks on the box body (not on items)
            setEditingLabel(true);
          },
        });
      }
    });
    return () => {
      cancelled = true;
      sceneApiRef.current?.cleanup();
      sceneApiRef.current = null;
    };
  // We deliberately exclude boxLabel from deps — label updates flow via setBoxLabel below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxStyle]);

  // Live updates: items / box label
  useEffect(() => { sceneApiRef.current?.setItems(items); }, [items]);
  useEffect(() => { sceneApiRef.current?.setBoxLabel(boxLabel || ''); }, [boxLabel]);

  // Close the context menu on any click outside it
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [contextMenu]);

  const handleEditFromMenu = () => {
    const item = items.find((it) => it.id === contextMenu.itemId);
    if (item) {
      setEditingItem({ id: item.id, title: item.title || '', x: contextMenu.x, y: contextMenu.y });
    }
    setContextMenu(null);
  };
  const handleDeleteFromMenu = () => {
    if (contextMenu) onDeleteItem(contextMenu.itemId);
    setContextMenu(null);
  };

  const submitTitleEdit = () => {
    if (editingItem) {
      onEditItemTitle(editingItem.id, editingItem.title.toUpperCase().slice(0, 18));
    }
    setEditingItem(null);
  };
  const cancelTitleEdit = () => setEditingItem(null);

  const submitLabelEdit = () => {
    onBoxLabelChange((labelDraft || '').slice(0, 24));
    setEditingLabel(false);
  };
  const cancelLabelEdit = () => {
    setLabelDraft(boxLabel || '');
    setEditingLabel(false);
  };

  // Close button: trigger the scene's break-down animation, then return to floor.
  // Total animation duration matches the scene's CLOSE_DURATION_MS below (~700ms).
  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    sceneApiRef.current?.startCloseAnimation?.();
    // After animation, transition back to floor view
    setTimeout(() => {
      onClose();
    }, 720);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: BG_COLOR }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      <div
        style={{
          position: 'absolute',
          top: 22,
          left: 26,
          fontFamily: '"Kalam", cursive',
          color: '#5a4f42',
          fontSize: 14,
          opacity: 0.78,
          pointerEvents: 'none',
          maxWidth: 320,
          lineHeight: 1.4,
        }}
      >
        viewing: <span style={{ fontWeight: 700 }}>{boxStyle ? boxStyle.name : 'box'}{boxLabel ? ` — "${boxLabel}"` : ''}</span>
        <br />
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {items.length} item{items.length === 1 ? '' : 's'} · drag items to move them · right-click for options · click box to label
        </span>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <TapeButton label="Add" tone="tape" rotate={-1.5} onClick={closing ? undefined : onAdd} />
        <TapeButton label="Close" tone="tape" rotate={0.7} onClick={handleClose} />
        <TapeButton label="Share" tone="mailing-label" rotate={-0.5} onClick={() => {}} />
        <TapeButton label="Break Down" tone="box-cutter" rotate={1.2} onClick={() => {}} />
      </div>

      {/* Right-click context menu on items */}
      {contextMenu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: contextMenu.y,
            left: contextMenu.x,
            background: '#fafaf5',
            border: '1px solid rgba(0,0,0,0.18)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.22), 0 1px 3px rgba(0,0,0,0.1)',
            borderRadius: 4,
            padding: '4px 0',
            minWidth: 168,
            fontFamily: '"Kalam", cursive',
            fontSize: 14,
            color: '#1d1410',
            zIndex: 200,
            overflow: 'hidden',
          }}
        >
          <ContextMenuItem onClick={handleEditFromMenu}>✎ Edit label</ContextMenuItem>
          <ContextMenuItem onClick={() => setContextMenu(null)}>↗ Open link</ContextMenuItem>
          <div style={{ height: 1, background: 'rgba(0,0,0,0.1)', margin: '4px 0' }} />
          <ContextMenuItem onClick={handleDeleteFromMenu} danger>✗ Delete</ContextMenuItem>
        </div>
      )}

      {/* Inline title editor (for "Edit label" action) */}
      {editingItem && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: editingItem.y,
            left: editingItem.x,
            background: '#fafaf5',
            border: '1px solid rgba(0,0,0,0.2)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.22)',
            borderRadius: 4,
            padding: 12,
            zIndex: 200,
            minWidth: 240,
          }}
        >
          <div style={{ fontSize: 11, fontFamily: '"Kalam", cursive', color: '#5a4f42', marginBottom: 5 }}>
            Edit label (max 18 chars)
          </div>
          <input
            type="text"
            value={editingItem.title}
            autoFocus
            onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value.slice(0, 18) })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitTitleEdit();
              if (e.key === 'Escape') cancelTitleEdit();
            }}
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 16,
              fontFamily: '"Permanent Marker", cursive',
              border: '1px solid #c5c1ba',
              boxSizing: 'border-box',
              letterSpacing: 0.5,
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
            <button onClick={cancelTitleEdit} style={editorBtn(false)}>Cancel</button>
            <button onClick={submitTitleEdit} style={editorBtn(true)}>Save</button>
          </div>
        </div>
      )}

      {/* Box-side label editor (centered overlay) */}
      {editingLabel && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#fafaf5',
            border: '1px solid rgba(0,0,0,0.2)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
            borderRadius: 4,
            padding: 18,
            zIndex: 200,
            minWidth: 320,
          }}
        >
          <div style={{ fontFamily: '"Kalam", cursive', color: '#5a4f42', fontSize: 13, marginBottom: 8 }}>
            What's on this box?
          </div>
          <input
            type="text"
            value={labelDraft}
            autoFocus
            placeholder="e.g. Mom's House, College, Childhood..."
            onChange={(e) => setLabelDraft(e.target.value.slice(0, 24))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitLabelEdit();
              if (e.key === 'Escape') cancelLabelEdit();
            }}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 22,
              fontFamily: '"Permanent Marker", cursive',
              border: '1px solid #c5c1ba',
              boxSizing: 'border-box',
              letterSpacing: 0.5,
            }}
          />
          <div style={{ fontSize: 10, color: '#888', marginTop: 4, fontFamily: '"Kalam", cursive' }}>
            Written in marker on the side of the box. {labelDraft.length}/24
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
            <button onClick={cancelLabelEdit} style={editorBtn(false)}>Cancel</button>
            <button onClick={submitLabelEdit} style={editorBtn(true)}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ContextMenuItem({ children, onClick, danger }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        padding: '7px 14px',
        cursor: 'pointer',
        background: hover ? (danger ? '#e8c4c4' : '#ecdca8') : 'transparent',
        color: danger ? '#a02a2a' : '#1d1410',
        fontFamily: '"Kalam", cursive',
        fontSize: 14,
        userSelect: 'none',
      }}
    >
      {children}
    </div>
  );
}

function editorBtn(primary) {
  return {
    padding: '6px 14px',
    background: primary ? '#1d1410' : '#fafaf5',
    color: primary ? '#fafaf5' : '#1d1410',
    border: primary ? '1px solid #1d1410' : '1px solid #c5c1ba',
    fontFamily: '"Kalam", cursive',
    fontSize: 13,
    cursor: 'pointer',
    borderRadius: 3,
  };
}

function TapeButton({ label, tone, rotate, onClick }) {
  const styles = {
    tape: { background: 'linear-gradient(to bottom, #ecdca8, #d4c07c)', border: '1px solid rgba(0,0,0,0.04)', color: '#1d1410' },
    'mailing-label': { background: '#fafaf5', border: '2px solid #c14040', color: '#1d1410' },
    'box-cutter': { background: 'linear-gradient(to bottom, #6a6a72, #3d3d44)', border: '1px solid #1d1d22', color: '#f5f1e0' },
  }[tone];

  return (
    <button
      onClick={onClick}
      style={{
        ...styles,
        fontFamily: '"Permanent Marker", cursive',
        fontSize: 18,
        padding: '10px 22px',
        cursor: 'pointer',
        transform: `rotate(${rotate}deg)`,
        letterSpacing: 0.5,
        boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
      }}
    >
      {label}
    </button>
  );
}

// ============================================================
// Office Biz storefront (windowed)
// ============================================================
const PRODUCTS = [
  { id: 'cube-s', name: 'Cube Box, Small',          desc: 'Compact storage cube.',                dims: '12 × 12 × 12 in', capacity: 15, price: 4.99,  aspect: { w: 1.0, h: 1.0, d: 1.0 } },
  { id: 'std-m',  name: 'Move-It Standard, Medium', desc: 'Most popular all-purpose carton.',     dims: '18 × 14 × 12 in', capacity: 25, price: 6.49,  aspect: { w: 1.55, h: 1.0, d: 1.2 } },
  { id: 'std-l',  name: 'Move-It Standard, Large',  desc: 'Big and sturdy. Holds plenty.',        dims: '20 × 18 × 16 in', capacity: 35, price: 8.99,  aspect: { w: 1.7, h: 1.4, d: 1.55 } },
  { id: 'tall',   name: 'Tall Wardrope Box',         desc: 'Vertical orientation, lots of depth.', dims: '16 × 16 × 32 in', capacity: 40, price: 11.49, aspect: { w: 1.1, h: 2.4, d: 1.1 } },
  { id: 'flat',   name: 'Picture Frame Flat',        desc: 'Shallow profile for flat items.',      dims: '24 × 18 × 6 in',  capacity: 12, price: 7.49,  aspect: { w: 1.95, h: 0.55, d: 1.45 } },
  { id: 'wide',   name: 'Extra-Wide Carton',         desc: 'Wider than standard. Lots of room.',   dims: '24 × 24 × 12 in', capacity: 30, price: 9.99,  aspect: { w: 1.95, h: 1.0, d: 1.95 } },
];

function OfficeBizStore({ onSelect }) {
  return (
    <div style={{ background: '#f4f5f7', fontFamily: '"Helvetica Neue", Arial, sans-serif', color: '#333' }}>
      <div style={{ background: '#0c4d4f', color: '#fff', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: 'Anton, Impact, sans-serif', fontSize: 28, letterSpacing: 1, color: '#ffe9c2' }}>OFFICE</span>
          <span style={{ fontFamily: 'Anton, Impact, sans-serif', fontSize: 28, letterSpacing: 1.5, color: '#ff7a1a' }}>BIZ</span>
          <span style={{ fontSize: 11, color: '#9bcecf', marginLeft: 6 }}>.biz</span>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 13 }}>
          <span style={{ opacity: 0.85 }}>Sign In</span>
          <span style={{ opacity: 0.85 }}>My Orders</span>
          <span style={{ background: '#ff7a1a', padding: '6px 14px', borderRadius: 2, fontWeight: 700, color: '#fff', letterSpacing: 0.5 }}>CART (0)</span>
        </div>
      </div>

      <div style={{ background: '#0a3d3f', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="text" defaultValue="moving boxes" style={{ flex: 1, padding: '8px 12px', fontSize: 14, border: '1px solid #ccc', maxWidth: 540 }} />
        <button style={{ background: '#ff7a1a', color: '#fff', border: 'none', padding: '8px 22px', fontSize: 13, fontWeight: 700, letterSpacing: 1, cursor: 'pointer' }}>SEARCH</button>
      </div>

      <div style={{ background: '#fff', borderBottom: '1px solid #d5d8dc', padding: '0 24px', display: 'flex', gap: 22, fontSize: 11, color: '#555', letterSpacing: 0.6 }}>
        {['BOXES & MAILERS', 'PACKING SUPPLIES', 'TAPE & ADHESIVES', 'PRINTERS', 'FURNITURE', 'OFFICE ESSENTIALS'].map((t, i) => (
          <span key={t} style={{ padding: '12px 0', borderBottom: i === 0 ? '3px solid #ff7a1a' : '3px solid transparent', fontWeight: i === 0 ? 700 : 400, color: i === 0 ? '#0c4d4f' : '#555' }}>{t}</span>
        ))}
      </div>

      <div style={{ padding: '10px 24px', fontSize: 12, color: '#888' }}>
        Home › Boxes &amp; Mailers › <span style={{ color: '#333' }}>Moving Boxes</span>
      </div>

      <div style={{ padding: '0 24px 14px', borderBottom: '1px solid #e0e3e7' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#0c4d4f' }}>Moving Boxes</h1>
        <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Find the right box for your stuff. Free shipping on orders over $35*.</div>
      </div>

      <div style={{ display: 'flex', padding: '20px 24px', gap: 22 }}>
        <aside style={{ width: 200, flexShrink: 0, fontSize: 12 }}>
          <FilterGroup title="Box Type" options={['Standard', 'Heavy Duty', 'Specialty', 'Wardrope']} />
          <FilterGroup title="Size" options={['Small', 'Medium', 'Large', 'Extra Large']} />
          <FilterGroup title="Shape" options={['Cube', 'Rectangle', 'Tall', 'Flat']} />
          <FilterGroup title="Item Capacity" options={['1–15 items', '16–30 items', '31+ items']} />
        </aside>

        <main style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, fontSize: 12, color: '#666' }}>
            <span>Showing 1–6 of 6 results</span>
            <span>Sort by: <select style={{ marginLeft: 6, padding: '3px 8px', fontSize: 12 }}><option>Best Match</option><option>Price: Low to High</option><option>Capacity</option></select></span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
            {PRODUCTS.map((p) => (
              <ProductCard key={p.id} product={p} onSelect={() => onSelect(p)} />
            ))}
          </div>
        </main>
      </div>

      <div style={{ background: '#0c4d4f', color: '#9bcecf', marginTop: 30, padding: '20px 24px', fontSize: 11, lineHeight: 1.7 }}>
        <div style={{ display: 'flex', gap: 36, flexWrap: 'wrap' }}>
          <div><div style={{ color: '#ffe9c2', fontWeight: 700, marginBottom: 4 }}>CUSTOMER SERVICE</div>Help · Track Order · Returns · Shipping</div>
          <div><div style={{ color: '#ffe9c2', fontWeight: 700, marginBottom: 4 }}>ABOUT US</div>Our Story · Stores · Careers</div>
          <div><div style={{ color: '#ffe9c2', fontWeight: 700, marginBottom: 4 }}>BUSINESS</div>Bulk Orders · Tax Exemption</div>
        </div>
        <div style={{ borderTop: '1px solid #1c5e60', marginTop: 14, paddingTop: 12, opacity: 0.7 }}>
          © 2018 OFFICE BIZ INC. ALL RIGHTS RESREVED. *Free shipping subject to terms.
        </div>
      </div>
    </div>
  );
}

function FilterGroup({ title, options }) {
  return (
    <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #e0e3e7' }}>
      <div style={{ fontWeight: 700, fontSize: 12, color: '#0c4d4f', marginBottom: 6, letterSpacing: 0.4 }}>{title}</div>
      {options.map((o) => (
        <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, color: '#555', fontSize: 12 }}>
          <input type="checkbox" />
          <span>{o}</span>
        </label>
      ))}
    </div>
  );
}

function ProductCard({ product, onSelect }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: '#fff',
        border: '1px solid',
        borderColor: hover ? '#ff7a1a' : '#d5d8dc',
        boxShadow: hover ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9f6f0' }}>
        <BoxIllustration aspect={product.aspect} />
      </div>
      <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: '#0c4d4f', minHeight: 36, lineHeight: 1.3 }}>{product.name}</div>
      <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>{product.dims}</div>
      <div style={{ fontSize: 11, color: '#777' }}>Holds up to {product.capacity} items</div>
      <div style={{ fontSize: 10, color: '#999', marginTop: 4, fontStyle: 'italic' }}>{product.desc}</div>
      <div style={{ marginTop: 8, fontSize: 20, color: '#cc1f1f', fontWeight: 700 }}>${product.price.toFixed(2)}</div>
      <button
        onClick={onSelect}
        style={{
          marginTop: 8,
          background: '#ff7a1a',
          color: '#fff',
          border: 'none',
          padding: '9px 0',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 1,
          cursor: 'pointer',
        }}
      >
        ADD TO CART
      </button>
    </div>
  );
}

function BoxIllustration({ aspect }) {
  const baseW = 60, baseH = 60;
  const w = baseW * aspect.w;
  const h = baseH * aspect.h;
  const d = baseW * aspect.d * 0.5;
  const ox = 50, oy = 100;
  const fbl = [ox, oy], fbr = [ox + w, oy], ftr = [ox + w, oy - h], ftl = [ox, oy - h];
  const btl = [ox + d, oy - h - d * 0.7], btr = [ox + w + d, oy - h - d * 0.7], bbr = [ox + w + d, oy - d * 0.7];
  const pts = (arr) => arr.map((p) => p.join(',')).join(' ');

  return (
    <svg viewBox="0 0 200 130" width={150} height={110} style={{ overflow: 'visible' }}>
      <ellipse cx={ox + w / 2 + d / 2} cy={oy + 5} rx={w * 0.55} ry={5} fill="rgba(0,0,0,0.13)" />
      <polygon points={pts([fbr, ftr, btr, bbr])} fill="#a07e54" stroke="#6e5638" strokeWidth="1" strokeLinejoin="round" />
      <polygon points={pts([ftl, ftr, btr, btl])} fill="#d8b78a" stroke="#6e5638" strokeWidth="1" strokeLinejoin="round" />
      <polygon points={pts([fbl, fbr, ftr, ftl])} fill="#c69b6a" stroke="#6e5638" strokeWidth="1" strokeLinejoin="round" />
      <polygon points={pts([
        [ftl[0] + (ftr[0] - ftl[0]) * 0.42, ftl[1]],
        [ftl[0] + (ftr[0] - ftl[0]) * 0.58, ftl[1]],
        [btl[0] + (btr[0] - btl[0]) * 0.58, btl[1]],
        [btl[0] + (btr[0] - btl[0]) * 0.42, btl[1]],
      ])} fill="#a07640" opacity="0.7" />
    </svg>
  );
}

// ============================================================
// BizBay (eBay knockoff) — windowed item picker
// ============================================================
const BIZBAY_CATEGORIES = [
  { name: 'Music',         active: true },
  { name: 'Video' },
  { name: 'Images' },
  { name: 'Files' },
  { name: 'Games' },
  { name: 'Notes & Misc' },
];

const BIZBAY_ITEMS = [
  { id: 'cd-jewel',  name: 'CD in Jewel Case',         cat: 'Music',         price: 1.49, kind: 'cd-case',    color: '#3088c8', desc: 'Hard plastic case, color insert' },
  { id: 'cd-bare',   name: 'Bare CD (no case)',        cat: 'Music',         price: 0.49, kind: 'cd-bare',    color: '#dadada', desc: 'Loose disc, name in sharpie' },
  { id: 'cd-color',  name: 'CD w/ Translucent Case',   cat: 'Music',         price: 1.79, kind: 'cd-case',    color: '#d04848', desc: 'Cheap colored snap case' },
  { id: 'cassette',  name: 'Cassette Tape',            cat: 'Music',         price: 0.99, kind: 'cassette',   color: '#1c1c20', desc: 'Audio cassette, label' },
  { id: 'dvd',       name: 'DVD with Case',            cat: 'Video',         price: 1.99, kind: 'dvd-case',   color: '#1a1a1a', desc: 'Plastic DVD case w/ insert' },
  { id: 'bluray',    name: 'Blu-Ray Case',             cat: 'Video',         price: 2.49, kind: 'dvd-case',   color: '#0a4fa8', desc: 'Blue case, slimmer than DVD' },
  { id: 'vhs',       name: 'VHS Cassette',             cat: 'Video',         price: 1.29, kind: 'vhs',        color: '#202020', desc: 'Old-school videotape' },
  { id: 'disc-vid',  name: 'Free-Floating Disc',       cat: 'Video',         price: 0.49, kind: 'cd-bare',    color: '#c8c8c8', desc: 'Like a CD but for video' },
  { id: 'photo',     name: '5×7 Glossy Print',         cat: 'Images',        price: 0.69, kind: 'photo',      color: '#88a8c8', desc: 'Photo paper, white border' },
  { id: 'manila',    name: 'Manila Folder + Sticky',   cat: 'Files',         price: 0.99, kind: 'manila',     color: '#dcc88c', desc: 'Folder w/ paper inside' },
  { id: 'usb',       name: 'USB Flash Drive',          cat: 'Files',         price: 1.49, kind: 'usb',        color: '#2a2a32', desc: 'Generic USB stick' },
  { id: 'floppy',    name: 'Floppy Disk 3.5"',         cat: 'Files',         price: 0.59, kind: 'floppy',     color: '#3a3a44', desc: 'Vintage disk' },
  { id: 'ps2',       name: 'PS2 Game Case',            cat: 'Games',         price: 2.49, kind: 'dvd-case',   color: '#0a0a14', desc: 'Black case, mem card slot' },
  { id: 'gameboy',   name: 'Gameboy Cartridge',        cat: 'Games',         price: 1.99, kind: 'cart',       color: '#888884', desc: 'Standard GB cart' },
  { id: 'nes',       name: 'NES Cartridge',            cat: 'Games',         price: 1.99, kind: 'cart',       color: '#9c948c', desc: 'Big gray Nintendo cart' },
  { id: 'postit-y',  name: 'Yellow Post-It',           cat: 'Notes & Misc',  price: 0.19, kind: 'postit',     color: '#f6e572', desc: 'Standard yellow' },
  { id: 'postit-b',  name: 'Light Blue Post-It',       cat: 'Notes & Misc',  price: 0.19, kind: 'postit',     color: '#a8d8ec', desc: 'Pastel blue' },
  { id: 'postit-g',  name: 'Light Green Post-It',      cat: 'Notes & Misc',  price: 0.19, kind: 'postit',     color: '#bce0a8', desc: 'Pastel green' },
  { id: 'paper',     name: 'Lined Paper + Paperclip',  cat: 'Notes & Misc',  price: 0.29, kind: 'paper',      color: '#fafaf0', desc: 'For random links' },
];

function BizBayStore({ onComplete, onUrlChange }) {
  const [step, setStep] = useState('browse'); // 'browse' | 'linkentry'
  const [chosenKind, setChosenKind] = useState(null);
  const [activeCat, setActiveCat] = useState('All');
  const items = activeCat === 'All' ? BIZBAY_ITEMS : BIZBAY_ITEMS.filter((i) => i.cat === activeCat);

  const handleSelect = (item) => {
    setChosenKind(item);
    setStep('linkentry');
    onUrlChange?.(`bizbay.biz/buy/${item.id}`);
  };

  const handleBack = () => {
    setStep('browse');
    setChosenKind(null);
    onUrlChange?.('bizbay.biz/all-categories');
  };

  if (step === 'linkentry') {
    return <BizBayLinkEntry chosenKind={chosenKind} onBack={handleBack} onComplete={onComplete} />;
  }

  return (
    <div style={{ background: '#f7f7f7', fontFamily: '"Helvetica Neue", Arial, sans-serif', color: '#333' }}>
      <div style={{ background: '#fff', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 18, borderBottom: '1px solid #e0e0e0' }}>
        <BizBayLogo />
        <div style={{ flex: 1, display: 'flex', alignItems: 'stretch', maxWidth: 640 }}>
          <select style={{ padding: '8px 10px', border: '1.5px solid #2c2c2c', borderRight: 'none', fontSize: 13, background: '#fff' }}>
            <option>All Categories</option>
            {BIZBAY_CATEGORIES.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
          <input type="text" defaultValue="" placeholder="Search for anything" style={{ flex: 1, padding: '8px 12px', border: '1.5px solid #2c2c2c', borderLeft: 'none', borderRight: 'none', fontSize: 13 }} />
          <button style={{ background: '#0e6cc1', color: '#fff', border: '1.5px solid #2c2c2c', borderLeft: 'none', padding: '0 26px', fontSize: 13, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer' }}>Search</button>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12, color: '#555' }}>
          <span>Watchlist</span>
          <span>My BizBay</span>
          <span style={{ fontSize: 18 }}>🛒</span>
        </div>
      </div>

      <div style={{ background: '#fff', borderBottom: '1px solid #e0e0e0', padding: '0 24px', display: 'flex', gap: 24, fontSize: 12, color: '#555', letterSpacing: 0.4 }}>
        <span
          onClick={() => setActiveCat('All')}
          style={{ padding: '10px 0', borderBottom: activeCat === 'All' ? '3px solid #f1c111' : '3px solid transparent', fontWeight: activeCat === 'All' ? 700 : 400, color: activeCat === 'All' ? '#0a0a0a' : '#555', cursor: 'pointer' }}
        >
          ALL
        </span>
        {BIZBAY_CATEGORIES.map((c) => (
          <span
            key={c.name}
            onClick={() => setActiveCat(c.name)}
            style={{
              padding: '10px 0',
              borderBottom: activeCat === c.name ? '3px solid #f1c111' : '3px solid transparent',
              fontWeight: activeCat === c.name ? 700 : 400,
              color: activeCat === c.name ? '#0a0a0a' : '#555',
              cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >
            {c.name}
          </span>
        ))}
      </div>

      <div style={{ padding: '10px 24px', fontSize: 12, color: '#888' }}>
        BizBay › <span style={{ color: '#333' }}>{activeCat === 'All' ? 'All Categories' : activeCat}</span>
      </div>

      <div style={{ padding: '0 24px 14px' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: '#0a0a0a' }}>What kind of thing?</h1>
        <div style={{ fontSize: 12, color: '#666', marginTop: 3 }}>Choose the physical item your link should live as. ★ Free 7-day return on all items.</div>
      </div>

      <div style={{ display: 'flex', padding: '8px 24px 24px', gap: 22 }}>
        <aside style={{ width: 180, flexShrink: 0, fontSize: 12 }}>
          <FilterGroupBay title="Condition" options={['New', 'Used', 'Vintage']} />
          <FilterGroupBay title="Price" options={['Under $1', '$1 to $2', 'Over $2']} />
          <FilterGroupBay title="Shipping" options={['Free', 'Local Pickup']} />
          <FilterGroupBay title="Seller" options={['Top Rated', 'Verified']} />
        </aside>

        <main style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, fontSize: 12, color: '#666' }}>
            <span>{items.length} results</span>
            <span>Sort: <select style={{ marginLeft: 6, padding: '3px 8px', fontSize: 12 }}><option>Best Match</option><option>Price: Low to High</option></select></span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
            {items.map((item) => (
              <BizBayCard key={item.id} item={item} onSelect={() => handleSelect(item)} />
            ))}
          </div>
        </main>
      </div>

      <div style={{ background: '#fafafa', borderTop: '1px solid #e0e0e0', padding: '20px 24px', fontSize: 11, color: '#888', lineHeight: 1.7 }}>
        © 2019 BIZBAY INC. — Bidd, Buy, Box. <span style={{ color: '#0e6cc1' }}>Seller Protection</span> · <span style={{ color: '#0e6cc1' }}>Help &amp; Contact</span> · <span style={{ color: '#0e6cc1' }}>Site Map</span>
      </div>
    </div>
  );
}

// ============================================================
// BizBay link entry — shown after picking an item kind
// ============================================================
function BizBayLinkEntry({ chosenKind, onBack, onComplete }) {
  const [url, setUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scraped, setScraped] = useState(null); // { title, image, domain }
  const [editedTitle, setEditedTitle] = useState('');

  const triggerScrape = (currentUrl) => {
    if (!currentUrl || !/^https?:\/\/.+\..+/i.test(currentUrl)) {
      setScraped(null);
      return;
    }
    setScraping(true);
    setScraped(null);
    // Simulated network latency for the OG fetch
    setTimeout(() => {
      const result = mockScrape(currentUrl);
      setScraped(result);
      setEditedTitle(result.title);
      setScraping(false);
    }, 280);
  };

  const handleAdd = () => {
    if (!scraped) return;
    onComplete({
      type: chosenKind.kind === 'cd-case' || chosenKind.kind === 'cd-bare' ? 'cd'
           : chosenKind.kind === 'cd-bare' ? 'cd'
           : chosenKind.kind === 'dvd-case' ? 'cd'  // we don't have a 3D DVD-case mesh yet, fall back to CD
           : chosenKind.kind === 'vhs' ? 'cassette'  // ditto VHS
           : chosenKind.kind === 'cart' ? 'cassette' // ditto cartridge
           : chosenKind.kind === 'usb' ? 'floppy'    // ditto USB
           : chosenKind.kind === 'paper' ? 'manila'  // ditto paper
           : chosenKind.kind, // 'cd', 'cassette', 'floppy', 'photo', 'postit', 'manila'
      color: scraped.image,
      title: editedTitle.toUpperCase().slice(0, 18),
      url,
      domain: scraped.domain,
      rotation: (Math.random() - 0.5) * 1.6,
    });
  };

  return (
    <div style={{ background: '#f7f7f7', fontFamily: '"Helvetica Neue", Arial, sans-serif', color: '#333', minHeight: '100%' }}>
      <div style={{ background: '#fff', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 18, borderBottom: '1px solid #e0e0e0' }}>
        <BizBayLogo />
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12, color: '#555' }}>
          <span>Watchlist</span>
          <span>My BizBay</span>
          <span style={{ fontSize: 18 }}>🛒</span>
        </div>
      </div>

      <div style={{ padding: '10px 24px', fontSize: 12, color: '#888' }}>
        BizBay › <span style={{ color: '#0e6cc1', cursor: 'pointer' }} onClick={onBack}>All Categories</span> › <span style={{ color: '#333' }}>{chosenKind?.name}</span>
      </div>

      <div style={{ padding: '0 24px 16px' }}>
        <span onClick={onBack} style={{ color: '#0e6cc1', fontSize: 12, cursor: 'pointer' }}>‹ Back to results</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', padding: '0 24px 24px', gap: 28 }}>
        {/* Left: chosen item */}
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', padding: 16 }}>
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa' }}>
            {chosenKind && <ItemIllustration kind={chosenKind.kind} color={chosenKind.color} />}
          </div>
          <div style={{ marginTop: 10, fontSize: 14, fontWeight: 600, color: '#0a0a0a' }}>{chosenKind?.name}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 3, fontStyle: 'italic' }}>{chosenKind?.desc}</div>
          <div style={{ marginTop: 10, fontSize: 18, color: '#222', fontWeight: 700 }}>${chosenKind?.price.toFixed(2)}</div>
          <div style={{ fontSize: 10, color: '#86b817', fontWeight: 700 }}>FREE shipping</div>
          <div style={{ marginTop: 14, padding: 10, background: '#fff8e1', border: '1px solid #f5d27a', fontSize: 11, color: '#665022', lineHeight: 1.5 }}>
            <strong>★ Top Rated Seller</strong><br />
            box.ed_official · 99.8% positive · ships from your floor
          </div>
        </div>

        {/* Right: URL entry & preview */}
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', padding: 22 }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, color: '#0a0a0a' }}>What's it a link to?</h2>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            Paste the URL of the video, song, photo, file, or page you want this {chosenKind?.kind === 'cd-case' || chosenKind?.kind === 'cd-bare' ? 'CD' : chosenKind?.kind === 'cassette' ? 'cassette' : 'item'} to represent.
          </div>

          <div style={{ marginTop: 18 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#444', letterSpacing: 0.5 }}>URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); triggerScrape(e.target.value); }}
              placeholder="https://..."
              autoFocus
              style={{ display: 'block', width: '100%', marginTop: 5, padding: '10px 12px', border: '1.5px solid #2c2c2c', fontSize: 14, fontFamily: 'monospace', boxSizing: 'border-box' }}
            />
            <div style={{ fontSize: 11, color: '#888', marginTop: 5 }}>
              Try: https://youtube.com/watch?v=... &nbsp;·&nbsp; https://open.spotify.com/track/... &nbsp;·&nbsp; or any URL
            </div>
          </div>

          {/* Preview area */}
          <div style={{ marginTop: 22, padding: 16, background: '#f7f7f7', border: '1px solid #e0e0e0', minHeight: 130 }}>
            {!url && (
              <div style={{ color: '#aaa', fontSize: 13, fontStyle: 'italic' }}>Preview will appear here once you paste a link.</div>
            )}
            {scraping && (
              <div style={{ color: '#666', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #ccc', borderTopColor: '#0e6cc1', borderRadius: '50%', animation: 'bizbay-spin 0.8s linear infinite' }} />
                <span>Fetching link metadata...</span>
                <style>{`@keyframes bizbay-spin{to{transform:rotate(360deg)}}`}</style>
              </div>
            )}
            {scraped && !scraping && (
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 90,
                    height: 90,
                    flexShrink: 0,
                    background: scraped.image,
                    border: '1px solid #ccc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontFamily: 'Anton, Impact, sans-serif',
                    fontSize: 22,
                    letterSpacing: 1,
                  }}
                >
                  {scraped.domain[0]?.toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: '#0e6cc1', fontWeight: 700, letterSpacing: 0.4 }}>{scraped.domain.toUpperCase()}</div>
                  <div style={{ fontSize: 13, color: '#0a0a0a', marginTop: 4, fontWeight: 600 }}>{scraped.title}</div>
                  <div style={{ marginTop: 10 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: '#444', letterSpacing: 0.5 }}>LABEL ON ITEM (max 18 chars)</label>
                    <input
                      type="text"
                      value={editedTitle}
                      onChange={(e) => setEditedTitle(e.target.value.slice(0, 18))}
                      style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 8px', border: '1px solid #ccc', fontSize: 12, fontFamily: '"Permanent Marker", cursive', boxSizing: 'border-box', letterSpacing: 0.5 }}
                    />
                    <div style={{ fontSize: 10, color: '#888', marginTop: 3, fontStyle: 'italic' }}>This is what gets scrawled on the {chosenKind?.kind === 'cd-case' || chosenKind?.kind === 'cd-bare' ? 'disc' : 'item'} in marker.</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 22, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onBack} style={{ padding: '10px 20px', background: '#fff', border: '1px solid #aaa', fontSize: 13, color: '#444', cursor: 'pointer', borderRadius: 18 }}>Cancel</button>
            <button
              onClick={handleAdd}
              disabled={!scraped || scraping || !editedTitle.trim()}
              style={{
                padding: '10px 24px',
                background: (!scraped || scraping || !editedTitle.trim()) ? '#e0e0e0' : '#f5af02',
                color: (!scraped || scraping || !editedTitle.trim()) ? '#aaa' : '#0a0a0a',
                border: '1px solid',
                borderColor: (!scraped || scraping || !editedTitle.trim()) ? '#ccc' : '#d99c02',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: 0.6,
                cursor: (!scraped || scraping || !editedTitle.trim()) ? 'not-allowed' : 'pointer',
                borderRadius: 18,
              }}
            >
              ADD TO BOX
            </button>
          </div>
        </div>
      </div>

      <div style={{ background: '#fafafa', borderTop: '1px solid #e0e0e0', padding: '20px 24px', fontSize: 11, color: '#888', lineHeight: 1.7 }}>
        © 2019 BIZBAY INC. — Bidd, Buy, Box. <span style={{ color: '#0e6cc1' }}>Seller Protection</span> · <span style={{ color: '#0e6cc1' }}>Help &amp; Contact</span>
      </div>
    </div>
  );
}

// Mock OG-scraping responses for the prototype
const SCRAPE_PATTERNS = [
  { test: /youtube\.com|youtu\.be/i,    title: 'How to Solve a Rubik\'s Cube',          image: '#cc0000', domain: 'YouTube' },
  { test: /spotify\.com/i,              title: 'Discover Weekly · 30 songs',           image: '#1db954', domain: 'Spotify' },
  { test: /soundcloud\.com/i,           title: 'Saturday Set 2024',                    image: '#ff7700', domain: 'SoundCloud' },
  { test: /vimeo\.com/i,                title: 'Short Film — Untitled',                image: '#1ab7ea', domain: 'Vimeo' },
  { test: /github\.com/i,               title: 'awesome-project · README',             image: '#24292f', domain: 'GitHub' },
  { test: /twitch\.tv/i,                title: 'VOD: Wednesday Stream',                image: '#9146ff', domain: 'Twitch' },
  { test: /netflix\.com/i,              title: 'A Movie You Saved',                    image: '#e50914', domain: 'Netflix' },
  { test: /\.(jpg|jpeg|png|gif|webp)/i, title: 'Image',                                image: '#88a8c8', domain: 'Photo' },
  { test: /\.(mp3|wav|ogg|flac)/i,      title: 'Audio File',                           image: '#3088c8', domain: 'Audio' },
  { test: /\.(mp4|mov|webm)/i,          title: 'Video File',                           image: '#cc4444', domain: 'Video' },
  { test: /\.(pdf)/i,                   title: 'Document.pdf',                         image: '#dccc8c', domain: 'PDF' },
  { test: /docs\.google\.com/i,         title: 'Untitled document',                    image: '#4285f4', domain: 'Google Docs' },
  { test: /medium\.com/i,               title: 'An Article Worth Saving',              image: '#0a0a0a', domain: 'Medium' },
  { test: /reddit\.com/i,               title: 'r/somesub · A discussion',             image: '#ff4500', domain: 'Reddit' },
  { test: /twitter\.com|x\.com/i,       title: 'A tweet you saved',                    image: '#1d9bf0', domain: 'Twitter' },
];
function mockScrape(url) {
  for (const p of SCRAPE_PATTERNS) {
    if (p.test.test(url)) return { title: p.title, image: p.image, domain: p.domain };
  }
  // Fallback: derive a domain
  let domain = 'Link';
  try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
  return { title: 'Saved page', image: '#888888', domain };
}

function BizBayLogo() {
  // Multicolor letters, clearly riffing on eBay's iconic logo
  const letters = [
    { c: 'B', col: '#e53238' },
    { c: 'i', col: '#0064d2' },
    { c: 'z', col: '#f5af02' },
    { c: 'B', col: '#86b817' },
    { c: 'a', col: '#e53238' },
    { c: 'y', col: '#0064d2' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'baseline' }}>
      {letters.map((l, i) => (
        <span key={i} style={{ fontFamily: 'Anton, Impact, sans-serif', fontSize: 36, letterSpacing: -1, color: l.col, lineHeight: 1 }}>{l.c}</span>
      ))}
      <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>.biz</span>
    </div>
  );
}

function FilterGroupBay({ title, options }) {
  return (
    <div style={{ marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #e0e0e0' }}>
      <div style={{ fontWeight: 700, fontSize: 12, color: '#0a0a0a', marginBottom: 6 }}>{title}</div>
      {options.map((o) => (
        <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, color: '#555', fontSize: 12 }}>
          <input type="checkbox" />
          <span>{o}</span>
        </label>
      ))}
    </div>
  );
}

function BizBayCard({ item, onSelect }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: '#fff',
        border: '1px solid',
        borderColor: hover ? '#0e6cc1' : '#e0e0e0',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: hover ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa' }}>
        <ItemIllustration kind={item.kind} color={item.color} />
      </div>
      <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: '#0a0a0a', lineHeight: 1.3, minHeight: 32 }}>{item.name}</div>
      <div style={{ fontSize: 10, color: '#888', marginTop: 2, fontStyle: 'italic', minHeight: 14 }}>{item.desc}</div>
      <div style={{ marginTop: 6, fontSize: 16, color: '#222', fontWeight: 700 }}>${item.price.toFixed(2)}</div>
      <div style={{ fontSize: 10, color: '#86b817', fontWeight: 700, marginTop: 1 }}>FREE shipping</div>
      <button
        onClick={onSelect}
        style={{
          marginTop: 8,
          background: '#f5af02',
          color: '#0a0a0a',
          border: '1px solid #d99c02',
          padding: '7px 0',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.7,
          cursor: 'pointer',
          borderRadius: 18,
        }}
      >
        BUY IT NOW
      </button>
    </div>
  );
}

function ItemIllustration({ kind, color }) {
  const W = 110, H = 80;
  switch (kind) {
    case 'cd-case':
      return (
        <svg viewBox="0 0 110 80" width={W} height={H}>
          <rect x="14" y="10" width="82" height="62" fill="#e8e8ec" stroke="#aaa" strokeWidth="1" rx="2" />
          <rect x="20" y="14" width="70" height="54" fill={color} opacity="0.78" />
          <circle cx="55" cy="41" r="20" fill="#d0d0d8" stroke="#888" strokeWidth="0.6" />
          <circle cx="55" cy="41" r="4" fill="#fafafa" stroke="#666" strokeWidth="0.4" />
        </svg>
      );
    case 'cd-bare':
      return (
        <svg viewBox="0 0 110 80" width={W} height={H}>
          <ellipse cx="60" cy="42" rx="3" ry="1" fill="rgba(0,0,0,0.12)" />
          <circle cx="55" cy="40" r="28" fill={color || '#dcdce4'} stroke="#888" strokeWidth="0.6" />
          <circle cx="55" cy="40" r="22" fill={color || '#cccccc'} opacity="0.6" />
          <circle cx="55" cy="40" r="5" fill="#1a1a1a" />
          <circle cx="55" cy="40" r="2" fill="#fafafa" />
        </svg>
      );
    case 'cassette':
      return (
        <svg viewBox="0 0 110 80" width={W} height={H}>
          <rect x="12" y="24" width="86" height="40" fill={color} stroke="#000" strokeWidth="0.6" rx="2" />
          <rect x="22" y="30" width="66" height="14" fill="#f0e9d0" />
          <circle cx="35" cy="54" r="5" fill="#9a8c70" />
          <circle cx="75" cy="54" r="5" fill="#9a8c70" />
          <circle cx="35" cy="54" r="1.5" fill="#222" />
          <circle cx="75" cy="54" r="1.5" fill="#222" />
        </svg>
      );
    case 'floppy':
      return (
        <svg viewBox="0 0 110 80" width={W} height={H}>
          <rect x="22" y="10" width="62" height="60" fill={color} stroke="#000" strokeWidth="0.6" rx="2" />
          <rect x="32" y="14" width="42" height="14" fill="#bcc0c8" />
          <rect x="36" y="36" width="34" height="28" fill="#f5f1e6" stroke="#999" strokeWidth="0.4" />
        </svg>
      );
    case 'photo':
      return (
        <svg viewBox="0 0 110 80" width={W} height={H}>
          <rect x="18" y="14" width="74" height="52" fill="#f5f1e6" stroke="#aaa" strokeWidth="0.6" />
          <rect x="22" y="18" width="66" height="44" fill={color} />
          <circle cx="36" cy="32" r="6" fill={shadeHex(color, -25)} opacity="0.6" />
          <circle cx="60" cy="48" r="9" fill={shadeHex(color, -15)} opacity="0.5" />
        </svg>
      );
    case 'manila':
      return (
        <svg viewBox="0 0 110 80" width={W} height={H}>
          <rect x="34" y="12" width="22" height="6" fill="#cdba78" stroke="#9d8c5a" strokeWidth="0.5" />
          <rect x="14" y="18" width="84" height="50" fill={color} stroke="#9d8c5a" strokeWidth="0.6" />
          <rect x="64" y="26" width="22" height="22" fill="#f6e572" transform="rotate(-3 75 37)" stroke="#d4ca52" strokeWidth="0.4" />
        </svg>
      );
    case 'usb':
      return (
        <svg viewBox="0 0 110 80" width={W} height={H}>
          <rect x="20" y="32" width="48" height="16" fill={color} stroke="#000" strokeWidth="0.5" rx="1.5" />
          <rect x="68" y="36" width="20" height="8" fill="#bcc0c8" stroke="#888" strokeWidth="0.4" />
          <rect x="73" y="38" width="3" height="4" fill="#222" />
          <rect x="79" y="38" width="3" height="4" fill="#222" />
        </svg>
      );
    case 'dvd-case':
      return (
        <svg viewBox="0 0 110 80" width={W} height={H}>
          <rect x="28" y="8" width="54" height="64" fill={color} stroke="#000" strokeWidth="0.6" rx="2" />
          <rect x="32" y="12" width="46" height="48" fill="#fafafa" opacity="0.85" />
          <text x="55" y="40" textAnchor="middle" fontSize="9" fill={shadeHex(color, -15)} fontFamily="Helvetica" fontWeight="700">MOVIE</text>
        </svg>
      );
    case 'vhs':
      return (
        <svg viewBox="0 0 110 80" width={W} height={H}>
          <rect x="14" y="22" width="82" height="42" fill={color} stroke="#000" strokeWidth="0.6" rx="2" />
          <rect x="20" y="28" width="70" height="20" fill="#fafaf2" />
          <rect x="28" y="50" width="20" height="10" fill="#222" stroke="#000" strokeWidth="0.3" />
          <rect x="62" y="50" width="20" height="10" fill="#222" stroke="#000" strokeWidth="0.3" />
        </svg>
      );
    case 'cart':
      return (
        <svg viewBox="0 0 110 80" width={W} height={H}>
          <rect x="22" y="14" width="66" height="52" fill={color} stroke="#000" strokeWidth="0.6" rx="3" />
          <rect x="34" y="14" width="42" height="6" fill={shadeHex(color, -30)} />
          <rect x="32" y="26" width="46" height="22" fill="#fafaf2" stroke="#888" strokeWidth="0.4" />
        </svg>
      );
    case 'postit':
      return (
        <svg viewBox="0 0 110 80" width={W} height={H}>
          <rect x="22" y="10" width="66" height="60" fill={color} stroke={shadeHex(color, -20)} strokeWidth="0.5" />
          <path d="M 22 65 L 22 70 L 27 70 Z" fill={shadeHex(color, -20)} opacity="0.4" />
        </svg>
      );
    case 'paper':
      return (
        <svg viewBox="0 0 110 80" width={W} height={H}>
          <rect x="22" y="8" width="62" height="60" fill={color} stroke="#aaa" strokeWidth="0.5" />
          {[16, 22, 28, 34, 40, 46, 52, 58].map((y) => (
            <line key={y} x1="26" y1={y} x2="80" y2={y} stroke="#a8d0e8" strokeWidth="0.4" />
          ))}
          <line x1="32" y1="8" x2="32" y2="68" stroke="#e8a8a8" strokeWidth="0.4" />
          <path d="M 70 4 Q 76 8 70 14 Q 64 18 70 22" fill="none" stroke="#888" strokeWidth="1.4" />
        </svg>
      );
    default:
      return <div style={{ width: W, height: H, background: '#f0f0f0' }} />;
  }
}

function shadeHex(hex, delta) {
  const h = hex.replace('#', '');
  const r = clamp(parseInt(h.slice(0, 2), 16) + delta);
  const g = clamp(parseInt(h.slice(2, 4), 16) + delta);
  const b = clamp(parseInt(h.slice(4, 6), 16) + delta);
  return `rgb(${r},${g},${b})`;
}

// ============================================================
// 3D INIT — floor scene
// ============================================================
// ============================================================
// initFloorScene — sets up the warehouse-floor 3D scene.
//
// Data flow: React owns the boxes[] array. We expose setBoxes() so React can
// push the latest box list into the scene whenever it changes (new box
// delivered, label edited, items added). The scene maintains its own physics
// state per box (position, velocity, mass) keyed by box id.
//
// New boxes (with isNew=true) get a delivery-from-above animation; we fire
// callbacks.onDeliveryComplete(id) when the bounce settles so React can clear
// the flag.
// ============================================================
function initFloorScene(mount, callbacks) {
  const w = mount.clientWidth;
  const h = mount.clientHeight;

  // ----- Scene setup -----
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);
  scene.fog = new THREE.Fog(BG_COLOR, 22, 46);

  const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
  const target = new THREE.Vector3(0, 0.4, 0);
  // Spherical orbit camera: theta=around-Y, phi=from-vertical
  const cam = { radius: 15.5, theta: 0, phi: Math.PI * 0.32 };
  function updateCamera() {
    const r = cam.radius;
    camera.position.x = target.x + r * Math.sin(cam.phi) * Math.sin(cam.theta);
    camera.position.y = target.y + r * Math.cos(cam.phi);
    camera.position.z = target.z + r * Math.sin(cam.phi) * Math.cos(cam.theta);
    camera.lookAt(target);
  }
  updateCamera();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';

  // ----- Lights -----
  scene.add(new THREE.HemisphereLight('#fff8eb', '#a39685', 0.7));
  scene.add(new THREE.AmbientLight('#fff5e0', 0.12));
  const key = new THREE.DirectionalLight('#fff4dd', 1.0);
  key.position.set(6, 13, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1; key.shadow.camera.far = 32;
  key.shadow.camera.left = -14; key.shadow.camera.right = 14;
  key.shadow.camera.top = 14; key.shadow.camera.bottom = -14;
  key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
  key.shadow.radius = 6;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#a8b0c2', 0.18);
  fill.position.set(-7, 9, -5);
  scene.add(fill);

  // ----- Floor surface + logo -----
  scene.add(makeFloorWithFade());
  scene.add(makeFloorLogo());

  // ============================================================
  // Box state — keyed by box id. Each entry holds:
  //   - data: the React box record (cached so we can compare on update)
  //   - group, body: Three.js objects for picking and disposal
  //   - position, velocity: physics state
  //   - size, mass: derived from item count
  //   - delivery: optional animation state for new boxes
  //   - labelMaterial, labelTextureRef: for live label edits
  //   - tapeMaterial: for live item-count updates
  // ============================================================
  const boxStates = new Map(); // id -> entry

  function disposeBox(entry) {
    scene.remove(entry.group);
    entry.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => { m.map?.dispose(); m.dispose(); });
      }
    });
  }

  // Diff React state into the scene. Called on init and on every boxes change.
  function setBoxes(boxes) {
    const incoming = new Map(boxes.map((b) => [b.id, b]));

    // Remove boxes no longer present
    for (const [id, entry] of boxStates) {
      if (!incoming.has(id)) {
        disposeBox(entry);
        boxStates.delete(id);
      }
    }

    // Add or update boxes
    boxes.forEach((box, i) => {
      const seed = hashStr(box.id) || i + 1;
      const existing = boxStates.get(box.id);

      if (!existing) {
        // ---- New box: build geometry + state ----
        const built = makeFloorBox({
          items: box.items.length,
          pos: new THREE.Vector3(box.floorPos.x, 0, box.floorPos.z),
          aspect: box.aspect,
          name: box.name,
          label: box.label,
          seed,
        });
        scene.add(built.group);

        const mass = 1 + (box.items.length / 50) * 4;
        const entry = {
          id: box.id,
          data: box,
          group: built.group,
          body: built.cube,
          position: built.position.clone(),
          velocity: new THREE.Vector3(),
          size: built.size,
          mass,
          itemCount: box.items.length,
          tapeMaterial: built.tapeMaterial,
          labelMaterial: built.labelMaterial,
        };

        // Delivery-from-above animation for boxes flagged isNew
        if (box.isNew) {
          entry.delivery = { t: 0, duration: 0.85, startY: 9 };
          built.group.position.y = 9; // start high in the air
        }

        boxStates.set(box.id, entry);
      } else {
        // ---- Existing box: update mutable fields ----
        existing.data = box;
        // If item count changed, refresh the tape label texture
        if (existing.itemCount !== box.items.length) {
          existing.itemCount = box.items.length;
          const newTape = makeTapeLabelTexture(`${box.items.length} items`);
          existing.tapeMaterial.map?.dispose();
          existing.tapeMaterial.map = newTape;
          existing.tapeMaterial.needsUpdate = true;
          existing.mass = 1 + (box.items.length / 50) * 4;
        }
        // If label changed, refresh the side label texture
        if (existing.labelMaterial && (existing._lastLabel !== box.label)) {
          existing._lastLabel = box.label;
          const newLabelTex = makeBoxSideLabelTexture(box.label || '');
          existing.labelMaterial.map?.dispose();
          existing.labelMaterial.map = newLabelTex;
          existing.labelMaterial.needsUpdate = true;
        }
      }
    });
  }

  // ============================================================
  // Pointer interaction — drag to move boxes, click to open one,
  // drag empty space to orbit camera, scroll to zoom.
  // ============================================================
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  let dragging = null;        // entry being dragged
  let orbiting = false;
  const dragOffset = new THREE.Vector3();
  const mouseTarget = new THREE.Vector3();
  let hovered = null;
  let lastX = 0, lastY = 0;
  let downX = 0, downY = 0, downTime = 0;

  function setNDC(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }
  function pickBoxEntry() {
    raycaster.setFromCamera(ndc, camera);
    const meshes = [];
    for (const entry of boxStates.values()) meshes.push(entry.body);
    const hits = raycaster.intersectObjects(meshes);
    if (hits.length === 0) return null;
    for (const entry of boxStates.values()) {
      if (entry.body === hits[0].object) return entry;
    }
    return null;
  }

  function onPointerDown(e) {
    setNDC(e);
    downX = e.clientX; downY = e.clientY; downTime = Date.now();
    const entry = pickBoxEntry();
    if (entry) {
      // Don't allow dragging a box that's mid-delivery
      if (entry.delivery) {
        return;
      }
      dragging = entry;
      raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      raycaster.ray.intersectPlane(groundPlane, hit);
      dragOffset.copy(hit).sub(entry.position);
      dragOffset.y = 0;
      mouseTarget.copy(entry.position);
      renderer.domElement.setPointerCapture(e.pointerId);
      mount.style.cursor = 'grabbing';
    } else {
      orbiting = true;
      lastX = e.clientX; lastY = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
      mount.style.cursor = 'grabbing';
    }
  }
  function onPointerMove(e) {
    setNDC(e);
    if (dragging) {
      raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(groundPlane, hit)) {
        mouseTarget.copy(hit).sub(dragOffset);
        mouseTarget.y = 0;
      }
    } else if (orbiting) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      cam.theta -= dx * 0.005;
      cam.phi -= dy * 0.005;
      cam.phi = Math.max(0.18, Math.min(Math.PI / 2 - 0.06, cam.phi));
      lastX = e.clientX; lastY = e.clientY;
      updateCamera();
    } else {
      const entry = pickBoxEntry();
      hovered = entry;
      mount.style.cursor = entry ? 'grab' : 'default';
    }
  }
  function onPointerUp(e) {
    // Click vs drag detection: small movement + short time = click
    if (dragging) {
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dt = Date.now() - downTime;
      if (dist < 5 && dt < 350) {
        callbacks?.onOpenBox?.(dragging.id);
      }
    }
    dragging = null;
    orbiting = false;
    mount.style.cursor = hovered ? 'grab' : 'default';
  }
  function onWheel(e) {
    e.preventDefault();
    cam.radius *= 1 + e.deltaY * 0.0009;
    cam.radius = Math.max(7, Math.min(28, cam.radius));
    updateCamera();
  }
  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('pointercancel', onPointerUp);
  dom.addEventListener('wheel', onWheel, { passive: false });

  function onResize() {
    const W = mount.clientWidth, H = mount.clientHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
  }
  window.addEventListener('resize', onResize);

  // ============================================================
  // Animation loop — runs physics for all boxes + delivery animation.
  // ============================================================
  const clock = new THREE.Clock();
  let raf;
  function step() {
    const dt = Math.min(clock.getDelta(), 0.05);

    // Update each box's physics
    for (const entry of boxStates.values()) {
      // Delivery animation: box falls from above with ease-out + bounce
      if (entry.delivery) {
        const d = entry.delivery;
        d.t += dt;
        const k = Math.min(1, d.t / d.duration);
        // Ease-in (gravity-ish) — fast at end
        const eased = k < 0.85
          ? Math.pow(k / 0.85, 2.2)
          : 1 + Math.sin((k - 0.85) / 0.15 * Math.PI) * 0.04; // tiny settle bounce
        const targetY = entry.size.y / 2;
        entry.group.position.y = d.startY + (targetY - d.startY) * eased;
        // Update internal position so when delivery ends, the box settles cleanly
        entry.position.y = targetY;
        if (k >= 1) {
          entry.group.position.y = targetY;
          delete entry.delivery;
          callbacks?.onDeliveryComplete?.(entry.id);
        }
        continue; // skip physics while delivering
      }

      // Drag spring: pull box toward cursor target
      if (entry === dragging) {
        const delta = new THREE.Vector3().subVectors(mouseTarget, entry.position);
        delta.y = 0;
        const stiffness = 75 / entry.mass;
        entry.velocity.addScaledVector(delta, stiffness * dt);
      }
      // Damping scales with item count → heavy boxes feel sluggish
      const damping = 5.5 + entry.itemCount * 0.07;
      entry.velocity.multiplyScalar(Math.exp(-damping * dt));
      const speed = entry.velocity.length();
      if (speed > 28) entry.velocity.multiplyScalar(28 / speed);
      entry.position.addScaledVector(entry.velocity, dt);

      // Floor bounds — keep boxes inside a 26x26 area
      const half = 13;
      const hx = entry.size.x / 2, hz = entry.size.z / 2;
      if (entry.position.x < -half + hx) { entry.position.x = -half + hx; entry.velocity.x = Math.max(0, entry.velocity.x) * 0.3; }
      else if (entry.position.x > half - hx) { entry.position.x = half - hx; entry.velocity.x = Math.min(0, entry.velocity.x) * 0.3; }
      if (entry.position.z < -half + hz) { entry.position.z = -half + hz; entry.velocity.z = Math.max(0, entry.velocity.z) * 0.3; }
      else if (entry.position.z > half - hz) { entry.position.z = half - hz; entry.velocity.z = Math.min(0, entry.velocity.z) * 0.3; }
      entry.position.y = entry.size.y / 2;
    }

    // Resolve box-vs-box collisions (simple AABB push)
    const entries = Array.from(boxStates.values()).filter((e) => !e.delivery);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        resolveCollision(entries[i], entries[j]);
      }
    }
    // Sync mesh transform from physics state (skip Y if delivery is animating it)
    for (const entry of boxStates.values()) {
      if (entry.delivery) {
        entry.group.position.x = entry.position.x;
        entry.group.position.z = entry.position.z;
      } else {
        entry.group.position.copy(entry.position);
      }
    }

    renderer.render(scene, camera);
    raf = requestAnimationFrame(step);
  }
  step();

  return {
    setBoxes,
    cleanup: () => {
      cancelAnimationFrame(raf);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      for (const entry of boxStates.values()) disposeBox(entry);
      boxStates.clear();
      renderer.dispose();
      if (mount.contains(dom)) mount.removeChild(dom);
    },
  };
}

// Tiny string hash → small int, used to seed cardboard textures so each
// box has a slightly different look (different blob/scuff distribution).
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 1000;
}

// ============================================================
// 3D INIT — open box scene (top-down)
// ============================================================
function initOpenBoxScene(mount, boxStyle, initialItems, initialLabel, callbacks) {
  const w = mount.clientWidth, h = mount.clientHeight;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);
  // Lighter fog with orthographic since distance-fog doesn't apply the same way
  scene.fog = new THREE.Fog(BG_COLOR, 14, 30);

  // ---------- Orthographic isometric camera ----------
  // Classic iso: phi from vertical = atan(sqrt(2)) ≈ 0.9553 rad.
  // We allow the user to orbit but clamp to a limited range so it stays iso-ish.
  const ISO_PHI = Math.atan(Math.SQRT2); // ~0.9553 = ~54.74° from vertical
  const target = new THREE.Vector3(0, 0.4, 0);
  const cam = {
    frustumSize: 6.0,         // world units across the smaller viewport dim
    theta: Math.PI / 4,       // 45° around vertical, classic iso
    phi: ISO_PHI,
    distance: 14,             // far enough to not clip; arbitrary for ortho
  };

  const aspect = w / h;
  const camera = new THREE.OrthographicCamera(
    -cam.frustumSize * aspect / 2, cam.frustumSize * aspect / 2,
     cam.frustumSize / 2, -cam.frustumSize / 2,
     0.1, 100,
  );
  function updateCamera() {
    camera.position.x = target.x + cam.distance * Math.sin(cam.phi) * Math.sin(cam.theta);
    camera.position.y = target.y + cam.distance * Math.cos(cam.phi);
    camera.position.z = target.z + cam.distance * Math.sin(cam.phi) * Math.cos(cam.theta);
    camera.lookAt(target);
  }
  function updateOrthoFrustum() {
    const a = mount.clientWidth / mount.clientHeight;
    camera.left = -cam.frustumSize * a / 2;
    camera.right =  cam.frustumSize * a / 2;
    camera.top =    cam.frustumSize / 2;
    camera.bottom = -cam.frustumSize / 2;
    camera.updateProjectionMatrix();
  }
  updateCamera();
  updateOrthoFrustum();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';

  scene.add(new THREE.HemisphereLight('#fff8eb', '#a39685', 0.7));
  scene.add(new THREE.AmbientLight('#fff5e0', 0.18));
  const key = new THREE.DirectionalLight('#fff4dd', 1.05);
  key.position.set(4, 8, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 20;
  key.shadow.camera.left = -8; key.shadow.camera.right = 8;
  key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
  key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
  key.shadow.radius = 6;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#a8b0c2', 0.25);
  fill.position.set(-4, 5, -3);
  scene.add(fill);

  scene.add(makeSmallFloor());

  const aspectBox = boxStyle?.aspect || { w: 1.55, h: 1.0, d: 1.2 };
  const boxSize = { x: 3.05 * aspectBox.w, y: 3.05 * aspectBox.h, z: 3.05 * aspectBox.d };
  const boxBundle = makeOpenBox(boxSize, initialLabel);
  scene.add(boxBundle.group);
  // Pickable surfaces for click detection (box body, not flaps, not items)
  const boxPickables = boxBundle.pickables;

  // Items state — id → { mesh, version }
  const meshById = new Map();
  const dropIns = new Map(); // id -> { startY, targetY, t, duration }

  function disposeMesh(mesh) {
    boxBundle.group.remove(mesh);
    mesh.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => { m.map?.dispose(); m.dispose(); });
      }
    });
  }

  function setItems(items) {
    const incoming = new Map(items.map((i) => [i.id, i]));
    // Remove items no longer present, OR whose version changed (for edits)
    for (const [id, entry] of meshById) {
      const next = incoming.get(id);
      if (!next || (next._version || 0) !== entry.version) {
        // Save the existing position/rotation so re-created mesh stays where it was
        if (next) {
          next._inheritedPos = entry.mesh.position.clone();
          next._inheritedRotY = entry.mesh.rotation.y;
        }
        disposeMesh(entry.mesh);
        meshById.delete(id);
        dropIns.delete(id);
      }
    }
    // Add new items, animate drop-in unless we have an inherited position (edit case)
    items.forEach((item) => {
      if (meshById.has(item.id)) return;
      const mesh = createItemMesh(item);
      mesh.userData.itemId = item.id;
      mesh.traverse((c) => { c.userData.itemId = item.id; });
      const targetY = item.position.y;
      if (item._inheritedPos) {
        mesh.position.copy(item._inheritedPos);
        mesh.rotation.y = item._inheritedRotY || 0;
      } else {
        mesh.rotation.y = item.rotation || 0;
        mesh.position.set(item.position.x, targetY + 1.2, item.position.z);
        dropIns.set(item.id, { startY: targetY + 1.2, targetY, t: 0, duration: 0.55 });
      }
      boxBundle.group.add(mesh);
      meshById.set(item.id, { mesh, version: item._version || 0 });
    });
  }

  setItems(initialItems);

  target.set(0, boxSize.y * 0.4, 0);
  updateCamera();

  // ---------- Pointer interaction ----------
  // Three modes: orbit (empty space drag), itemDrag, none
  // Right-click on item → context menu (handled separately via 'contextmenu' event)
  // Plain click on box body (no drag) → label edit

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  // World plane the cursor projects onto while dragging an item (above the box)
  const liftHeight = boxSize.y + 0.7;
  const liftPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -liftHeight);
  // Plane at the box bottom for resting positions on release
  const restPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  let mode = 'none'; // 'none' | 'orbit' | 'itemDrag' | 'pendingClick'
  let orbitLastX = 0, orbitLastY = 0;
  let pendingDownInfo = null; // { x, y, time, targetType, targetId? } for click-vs-drag detection
  let activeDrag = null;

  // Close (break-down) animation state — null when not animating, otherwise:
  //   { t, duration, fromAngle }
  // During the animation, all 4 flap hinges rotate from fromAngle → 0
  // (closed/horizontal), then a tape strip scales from 0 → 1 across the seam.
  let closeAnim = null;
  function startCloseAnimation() {
    if (closeAnim) return;
    closeAnim = { t: 0, duration: 0.7, fromAngle: boxBundle.flapAngle };
    // Show the tape strip mesh; it'll scale up during the second half of the anim
    boxBundle.tapeStrip.visible = true;
    // Disable user interaction during close
    mode = 'none';
    activeDrag = null;
  }

  function setNDC(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pickItem() {
    raycaster.setFromCamera(ndc, camera);
    const meshes = [];
    for (const { mesh } of meshById.values()) meshes.push(mesh);
    const hits = raycaster.intersectObjects(meshes, true);
    if (hits.length === 0) return null;
    const hit = hits[0];
    let id = hit.object.userData.itemId;
    let n = hit.object;
    while (!id && n.parent) { n = n.parent; id = n.userData.itemId; }
    if (!id) return null;
    return { id, point: hit.point.clone() };
  }
  function pickBoxBody() {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(boxPickables, false);
    return hits.length > 0;
  }

  function startItemDrag(id, hitPoint) {
    const entry = meshById.get(id);
    if (!entry) return;
    const mesh = entry.mesh;
    dropIns.delete(id);

    // grabLocal: position on the item where the cursor "pinched"
    mesh.updateMatrixWorld();
    const grabLocal = mesh.worldToLocal(hitPoint.clone());

    // Equilibrium: rotate item so grab point points in the world-up direction.
    // For flat items grabbed near center, fully aligning the grab to up would tip
    // the item nearly 90° — which is exactly the "dangle from edge" behavior we want
    // when the grab is near the edge, but feels wrong near the center. So we slerp
    // from identity by a factor proportional to how off-center the grab is.
    const horizR = Math.hypot(grabLocal.x, grabLocal.z);
    const maxR = 0.40; // typical item half-size
    const tiltFactor = Math.min(1, horizR / maxR);
    const equilibriumQuat = new THREE.Quaternion();
    if (horizR > 0.005) {
      const grabHoriz = new THREE.Vector3(grabLocal.x, 0, grabLocal.z).normalize();
      const fullEq = new THREE.Quaternion().setFromUnitVectors(grabHoriz, new THREE.Vector3(0, 1, 0));
      equilibriumQuat.slerpQuaternions(new THREE.Quaternion(), fullEq, tiltFactor);
    }
    // Note: grabLocal was computed via worldToLocal so it already accounts for the item's
    // existing Y rotation. The equilibrium above is therefore the absolute target world
    // rotation; we don't multiply by the existing yQuat (would double-apply it).

    activeDrag = {
      id,
      mesh,
      grabLocal,
      equilibriumQuat,
      // Accumulated swing offsets (Euler around X and Z) on top of equilibrium
      swingX: 0, swingZ: 0,
      swingVelX: 0, swingVelZ: 0,
      // Smooth cursor velocity for impulses
      cursorWorld: null,
      cursorVel: new THREE.Vector3(),
      // Position spring state
      currentPos: mesh.position.clone(),
      currentVel: new THREE.Vector3(),
      // Rotation spring state — start at item's current orientation, lerp toward target
      // so grabbing doesn't visually pop the item to its dangling pose instantly.
      currentQuat: mesh.quaternion.clone(),
    };
    mode = 'itemDrag';
    mount.style.cursor = 'grabbing';
  }

  function endItemDrag() {
    if (!activeDrag) return;
    const { id, mesh, currentPos } = activeDrag;
    // Drop the item back to floor: keep XZ where it is, animate Y down to bottom of box.
    // Reset rotation to flat (just keep Y rot from current Y-axis component).
    const cx = currentPos.x;
    const cz = currentPos.z;
    // Clamp into box interior
    const ix = boxSize.x * 0.5 - 0.18;
    const iz = boxSize.z * 0.5 - 0.18;
    const restX = Math.max(-ix, Math.min(ix, cx));
    const restZ = Math.max(-iz, Math.min(iz, cz));
    const restY = 0.05 + Math.random() * 0.04;
    // Extract a Y rotation from current quat for natural drop orientation
    const eul = new THREE.Euler().setFromQuaternion(mesh.quaternion, 'YXZ');
    mesh.quaternion.identity();
    mesh.rotation.y = eul.y;
    // Place at current world XYZ, then drop animation handles the y descent
    mesh.position.set(restX, currentPos.y, restZ);
    dropIns.set(id, { startY: currentPos.y, targetY: restY, t: 0, duration: 0.4 });
    activeDrag = null;
    mode = 'none';
    mount.style.cursor = 'default';
  }

  function onPointerDown(e) {
    if (e.button === 2) return; // right click handled by contextmenu
    if (closeAnim) return;       // ignore input while box is folding shut
    setNDC(e);
    pendingDownInfo = { x: e.clientX, y: e.clientY, time: Date.now() };

    const itemHit = pickItem();
    if (itemHit) {
      pendingDownInfo.targetType = 'item';
      pendingDownInfo.targetId = itemHit.id;
      startItemDrag(itemHit.id, itemHit.point);
      renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    if (pickBoxBody()) {
      pendingDownInfo.targetType = 'box';
      // Don't start anything — wait for pointerup to detect short click
      mode = 'pendingClick';
      renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    // Empty space → orbit
    pendingDownInfo.targetType = 'empty';
    mode = 'orbit';
    orbitLastX = e.clientX; orbitLastY = e.clientY;
    renderer.domElement.setPointerCapture(e.pointerId);
    mount.style.cursor = 'grabbing';
  }

  function onPointerMove(e) {
    setNDC(e);
    if (mode === 'itemDrag' && activeDrag) {
      raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(liftPlane, hit)) {
        // Smooth cursor velocity (used as torque on swing)
        if (activeDrag.cursorWorld) {
          activeDrag.cursorVel.copy(hit).sub(activeDrag.cursorWorld);
        }
        activeDrag.cursorWorld = hit;
      }
      return;
    }
    if (mode === 'orbit') {
      const dx = e.clientX - orbitLastX, dy = e.clientY - orbitLastY;
      cam.theta -= dx * 0.005;
      cam.phi -= dy * 0.004;
      // Keep close to iso — allow some wiggle but not full top/side
      cam.phi = Math.max(ISO_PHI - 0.45, Math.min(ISO_PHI + 0.30, cam.phi));
      orbitLastX = e.clientX; orbitLastY = e.clientY;
      updateCamera();
    } else if (mode === 'pendingClick') {
      // Detect drag away from box click — promote to orbit
      if (pendingDownInfo) {
        const moved = Math.hypot(e.clientX - pendingDownInfo.x, e.clientY - pendingDownInfo.y);
        if (moved > 6) {
          mode = 'orbit';
          orbitLastX = e.clientX;
          orbitLastY = e.clientY;
          mount.style.cursor = 'grabbing';
        }
      }
    }
  }

  function onPointerUp(e) {
    if (mode === 'itemDrag') {
      endItemDrag();
    } else if (mode === 'pendingClick') {
      // Was a short click on the box body → trigger label edit
      const dt = Date.now() - (pendingDownInfo?.time || 0);
      const moved = Math.hypot(e.clientX - (pendingDownInfo?.x || 0), e.clientY - (pendingDownInfo?.y || 0));
      if (dt < 350 && moved < 6) {
        callbacks?.onBoxClick?.();
      }
    }
    mode = 'none';
    pendingDownInfo = null;
    mount.style.cursor = 'default';
  }

  function onWheel(e) {
    e.preventDefault();
    cam.frustumSize *= 1 + e.deltaY * 0.0011;
    cam.frustumSize = Math.max(2.5, Math.min(12, cam.frustumSize));
    updateOrthoFrustum();
  }

  function onContextMenu(e) {
    e.preventDefault();
    if (closeAnim) return;
    setNDC(e);
    const itemHit = pickItem();
    if (itemHit && callbacks?.onItemContextMenu) {
      const rect = renderer.domElement.getBoundingClientRect();
      // Anchor the menu in the OpenBox container coords (not the canvas)
      callbacks.onItemContextMenu(itemHit.id, e.clientX - rect.left, e.clientY - rect.top);
    }
  }

  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('pointercancel', onPointerUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('contextmenu', onContextMenu);

  function onResize() {
    const W = mount.clientWidth, H = mount.clientHeight;
    renderer.setSize(W, H);
    updateOrthoFrustum();
  }
  window.addEventListener('resize', onResize);

  const clock = new THREE.Clock();
  let raf;
  function step() {
    const dt = Math.min(clock.getDelta(), 0.05);

    // ---------- Active item drag (dangle physics) ----------
    if (activeDrag && activeDrag.cursorWorld) {
      const d = activeDrag;

      // Cursor velocity creates impulse on swing (X swing around Z axis, Z swing around X axis)
      // Negate Z because forward push (positive z motion) should tilt the item backward (-X tilt).
      const impulseScale = 18;
      d.swingVelZ += -d.cursorVel.x * impulseScale * dt;
      d.swingVelX +=  d.cursorVel.z * impulseScale * dt;

      // Spring back towards equilibrium (swing = 0)
      const stiffness = 36;
      d.swingVelX += -d.swingX * stiffness * dt;
      d.swingVelZ += -d.swingZ * stiffness * dt;

      // Damping
      const damping = Math.exp(-3.5 * dt);
      d.swingVelX *= damping;
      d.swingVelZ *= damping;

      // Integrate
      d.swingX += d.swingVelX * dt;
      d.swingZ += d.swingVelZ * dt;

      // Clamp swing to ±60° to keep it from going wild
      const maxSwing = Math.PI / 3;
      d.swingX = Math.max(-maxSwing, Math.min(maxSwing, d.swingX));
      d.swingZ = Math.max(-maxSwing, Math.min(maxSwing, d.swingZ));

      // Compose target rotation: equilibrium · swing
      const swingQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(d.swingX, 0, d.swingZ, 'XYZ'));
      const targetQuat = swingQuat.clone().multiply(d.equilibriumQuat);

      // Spring rotation toward target (smooth instead of snap)
      d.currentQuat.slerp(targetQuat, Math.min(1, dt * 12));

      // Item position so grab point ends up at cursor (uses current rotation, not target,
      // so the grab point stays at the cursor while the item rotates into pose).
      const grabWorld = d.grabLocal.clone().applyQuaternion(d.currentQuat);
      const desired = d.cursorWorld.clone().sub(grabWorld);

      // Spring position toward desired with weight
      const posDelta = desired.clone().sub(d.currentPos);
      const posStiff = 70;
      d.currentVel.addScaledVector(posDelta, posStiff * dt);
      d.currentVel.multiplyScalar(Math.exp(-9 * dt));
      d.currentPos.addScaledVector(d.currentVel, dt);

      d.mesh.position.copy(d.currentPos);
      d.mesh.quaternion.copy(d.currentQuat);

      // Decay cursorVel each frame so it represents instantaneous motion
      d.cursorVel.multiplyScalar(Math.exp(-12 * dt));
    }

    // ---------- Drop-ins ----------
    for (const [id, d] of dropIns) {
      d.t += dt;
      const k = Math.min(1, d.t / d.duration);
      const eased = 1 - Math.pow(1 - k, 3);
      const entry = meshById.get(id);
      if (entry) {
        let y = d.startY + (d.targetY - d.startY) * eased;
        if (k > 0.85) {
          const settleK = (k - 0.85) / 0.15;
          y += Math.sin(settleK * Math.PI) * 0.02;
        }
        entry.mesh.position.y = y;
      }
      if (k >= 1) dropIns.delete(id);
    }

    // ---------- Close (break-down) animation ----------
    // Phase 1 (0–0.65 of duration): all four flaps rotate from open angle → 0.
    // Phase 2 (0.55–1.0): tape strip scales from 0 → 1 across the seam.
    // (Phases overlap by 0.10 so the tape starts as flaps finish meeting.)
    if (closeAnim) {
      closeAnim.t += dt;
      const k = Math.min(1, closeAnim.t / closeAnim.duration);

      // Flap fold-in
      const flapK = Math.min(1, k / 0.65);
      const flapEased = 1 - Math.pow(1 - flapK, 2.2); // ease-out quad
      const ang = closeAnim.fromAngle * (1 - flapEased);
      // Front (+Z) and Back (-Z) rotate around X, opposite signs.
      // Right (+X) and Left (-X) rotate around Z, opposite signs.
      boxBundle.hinges.front.rotation.x =  ang;
      boxBundle.hinges.back.rotation.x  = -ang;
      boxBundle.hinges.right.rotation.z =  ang;
      boxBundle.hinges.left.rotation.z  = -ang;

      // Tape strip grow
      if (k > 0.55) {
        const tapeK = Math.min(1, (k - 0.55) / 0.45);
        const tapeEased = 1 - Math.pow(1 - tapeK, 2);
        boxBundle.tapeStrip.scale.x = tapeEased;
      }
    }

    renderer.render(scene, camera);
    raf = requestAnimationFrame(step);
  }
  step();

  return {
    setItems,
    setBoxLabel: (label) => boxBundle.setLabel(label),
    startCloseAnimation,
    cleanup: () => {
      cancelAnimationFrame(raf);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('resize', onResize);
      for (const { mesh } of meshById.values()) disposeMesh(mesh);
      meshById.clear();
      renderer.dispose();
      if (mount.contains(dom)) mount.removeChild(dom);
    },
  };
}

// Dispatch on item.type — returns a Group ready to be positioned & rotated
function createItemMesh(item) {
  switch (item.type) {
    case 'cd':       return makeCD(item.color, item.title);
    case 'cassette': return makeCassette(item.title);
    case 'photo':    return makePhoto(item.color);
    case 'floppy':   return makeFloppy(item.color, item.title);
    case 'postit':   return makePostIt(item.color, item.title);
    case 'manila':   return makeManila(item.title);
    default:         return makeCD(item.color || '#888', item.title);
  }
}

// ============================================================
// Floor box (closed, on the warehouse floor)
// ============================================================
// makeFloorBox — builds a closed cardboard box for the floor scene.
// Returns { group, cube, position, size, items, tapeMaterial, labelMaterial }
// where tapeMaterial holds the on-top tape strip (item count) and
// labelMaterial holds the side-of-box marker label (user-set name).
// The scene swaps the textures on these materials when state changes,
// so we don't have to rebuild the geometry just to update text.
function makeFloorBox({ items, pos, aspect, name, label, seed }) {
  const size = { x: 1.5 * aspect.w, y: 1.2 * aspect.h, z: 1.3 * aspect.d };
  const group = new THREE.Group();

  // Body — single cardboard cube with tonal-blob procedural texture.
  // (To swap in a Meshy model: load the GLB once, then clone its scene here
  // instead of building a BoxGeometry; see top-of-file model integration guide.)
  const tex = makeCardboardTexture(seed);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 });
  const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
  const cube = new THREE.Mesh(geo, mat);
  cube.castShadow = true; cube.receiveShadow = true;
  group.add(cube);

  // Tape strip across the top center (where the flap seam would be)
  const tapeStripMat = new THREE.MeshStandardMaterial({ color: '#a07640', roughness: 0.55, metalness: 0.05, transparent: true, opacity: 0.92 });
  const tapeStrip = new THREE.Mesh(new THREE.PlaneGeometry(0.24, size.z * 0.96), tapeStripMat);
  tapeStrip.rotation.x = -Math.PI / 2;
  tapeStrip.position.y = size.y / 2 + 0.005;
  group.add(tapeStrip);

  // Tape *label* sticker on top — shows item count, like "5 items".
  // tapeMaterial is exposed so the scene can swap the texture on item changes.
  const tapeLabelTex = makeTapeLabelTexture(`${items} item${items === 1 ? '' : 's'}`);
  const tapeMaterial = new THREE.MeshStandardMaterial({ map: tapeLabelTex, transparent: true, roughness: 0.7, metalness: 0 });
  const tapeLabel = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 0.7, size.y * 0.30), tapeMaterial);
  tapeLabel.rotation.x = -Math.PI / 2;
  tapeLabel.position.y = size.y / 2 + 0.007;
  tapeLabel.position.z = size.z * 0.05;
  tapeLabel.rotation.z = (rand(seed * 13.7) - 0.5) * 0.07;
  group.add(tapeLabel);

  // Side label on +Z face — same marker-scrawl style as the open box.
  // labelMaterial exposed so the scene can swap textures on label edit.
  const labelW = size.x * 0.85;
  const labelH = size.y * 0.50;
  const sideLabelTex = makeBoxSideLabelTexture(label || '');
  const labelMaterial = new THREE.MeshStandardMaterial({
    map: sideLabelTex,
    transparent: true,
    roughness: 0.9,
    depthWrite: false,
  });
  const sideLabel = new THREE.Mesh(new THREE.PlaneGeometry(labelW, labelH), labelMaterial);
  sideLabel.position.set(0, 0, size.z / 2 + 0.003);
  group.add(sideLabel);

  return {
    group,
    cube,
    position: pos.clone().setY(size.y / 2),
    size,
    items,
    style: { name, aspect, capacity: items },
    tapeMaterial,    // ← material whose .map can be swapped to update tape text
    labelMaterial,   // ← material whose .map can be swapped to update side label
  };
}

function resolveCollision(a, b) {
  const dx = b.position.x - a.position.x;
  const dz = b.position.z - a.position.z;
  const overlapX = (a.size.x + b.size.x) / 2 - Math.abs(dx);
  const overlapZ = (a.size.z + b.size.z) / 2 - Math.abs(dz);
  if (overlapX <= 0 || overlapZ <= 0) return;
  const totalInvMass = 1 / a.mass + 1 / b.mass;
  if (overlapX < overlapZ) {
    const sign = dx >= 0 ? 1 : -1;
    a.position.x -= sign * overlapX * (1 / a.mass) / totalInvMass;
    b.position.x += sign * overlapX * (1 / b.mass) / totalInvMass;
    const v = (a.velocity.x / a.mass + b.velocity.x / b.mass) / totalInvMass;
    a.velocity.x = v * 0.35; b.velocity.x = v * 0.35;
  } else {
    const sign = dz >= 0 ? 1 : -1;
    a.position.z -= sign * overlapZ * (1 / a.mass) / totalInvMass;
    b.position.z += sign * overlapZ * (1 / b.mass) / totalInvMass;
    const v = (a.velocity.z / a.mass + b.velocity.z / b.mass) / totalInvMass;
    a.velocity.z = v * 0.35; b.velocity.z = v * 0.35;
  }
}

// ============================================================
// Open box geometry (body + 4 flaps splayed outward)
// ============================================================
function makeOpenBox(size, initialLabel) {
  const group = new THREE.Group();
  const outerTex = makeCardboardTexture(7);
  const innerTex = makeCardboardTexture(11);
  const outerMat = new THREE.MeshStandardMaterial({ map: outerTex, roughness: 0.96, metalness: 0 });
  const innerMat = new THREE.MeshStandardMaterial({ map: innerTex, roughness: 0.98, metalness: 0, color: '#b58a5e' });

  const halfX = size.x / 2;
  const halfZ = size.z / 2;
  const wallThickness = 0.04;

  // Surfaces that count as "the box body" for click detection
  const pickables = [];

  function addWall({ axis, sign, length, height }) {
    const wallGeo = new THREE.BoxGeometry(
      axis === 'x' ? wallThickness : length, height, axis === 'x' ? length : wallThickness
    );
    const wall = new THREE.Mesh(wallGeo, outerMat);
    wall.castShadow = true; wall.receiveShadow = true;
    if (axis === 'x') wall.position.x = sign * halfX; else wall.position.z = sign * halfZ;
    wall.position.y = height / 2;
    group.add(wall);
    pickables.push(wall);
    return wall;
  }
  addWall({ axis: 'x', sign: -1, length: size.z, height: size.y });
  addWall({ axis: 'x', sign:  1, length: size.z, height: size.y });
  addWall({ axis: 'z', sign: -1, length: size.x, height: size.y });
  const frontWall = addWall({ axis: 'z', sign: 1, length: size.x, height: size.y });

  const bottom = new THREE.Mesh(
    new THREE.BoxGeometry(size.x - wallThickness * 2, wallThickness, size.z - wallThickness * 2),
    innerMat
  );
  bottom.position.y = wallThickness / 2;
  bottom.receiveShadow = true;
  group.add(bottom);
  pickables.push(bottom);

  // ---------- Side label on the front wall (+Z) ----------
  // Plane parented to the front wall, offset slightly outward, showing the label in marker.
  const labelW = (size.x - wallThickness * 2) * 0.85;
  const labelH = size.y * 0.40;
  const labelTex = makeBoxSideLabelTexture(initialLabel || '');
  const labelMat = new THREE.MeshStandardMaterial({
    map: labelTex,
    transparent: true,
    roughness: 0.9,
    depthWrite: false,
  });
  const labelGeo = new THREE.PlaneGeometry(labelW, labelH);
  const labelPlane = new THREE.Mesh(labelGeo, labelMat);
  // Place on the +Z face, slightly forward (away from the wall) so it doesn't z-fight
  labelPlane.position.set(0, 0, halfZ + wallThickness / 2 + 0.002);
  labelPlane.rotation.y = 0; // facing +Z
  group.add(labelPlane);

  function setLabel(text) {
    const newTex = makeBoxSideLabelTexture(text || '');
    labelMat.map?.dispose();
    labelMat.map = newTex;
    labelMat.needsUpdate = true;
  }

  // ---------- Flaps ----------
  // Each flap is a thin box parented to a "hinge" group whose origin lies at the
  // top edge of the wall. We rotate the hinge to open/close the flap.
  // Open angle: flapAngle (~101°), splayed outward.
  // Closed angle: 0 (flap horizontal across the box top).
  const flapDepth = size.z * 0.46;
  const flapWidth = size.x * 0.46;
  const flapAngle = Math.PI * 0.56;

  // Front flap (+Z) — has the "3.7/5 mb" scrawl on its inner face
  const hingeFront = new THREE.Group();
  hingeFront.position.set(0, size.y, halfZ - wallThickness / 2);
  group.add(hingeFront);
  {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(size.x - wallThickness * 2, wallThickness, flapDepth), outerMat);
    flap.castShadow = true; flap.receiveShadow = true;
    flap.position.set(0, 0, -flapDepth / 2);
    hingeFront.add(flap);

    const scrawlTex = makeFlapInsideTexture('3.7 / 5 mb');
    const scrawlMat = new THREE.MeshStandardMaterial({ map: scrawlTex, transparent: true, roughness: 0.95, depthWrite: false });
    const scrawl = new THREE.Mesh(new THREE.PlaneGeometry((size.x - wallThickness * 2) * 0.92, flapDepth * 0.78), scrawlMat);
    scrawl.rotation.x = Math.PI / 2;
    scrawl.position.set(0, -wallThickness / 2 - 0.001, -flapDepth / 2);
    hingeFront.add(scrawl);

    hingeFront.rotation.x = flapAngle;
  }

  // Back flap (-Z)
  const hingeBack = new THREE.Group();
  hingeBack.position.set(0, size.y, -halfZ + wallThickness / 2);
  group.add(hingeBack);
  {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(size.x - wallThickness * 2, wallThickness, flapDepth), outerMat);
    flap.castShadow = true; flap.receiveShadow = true;
    flap.position.set(0, 0, flapDepth / 2);
    hingeBack.add(flap);
    hingeBack.rotation.x = -flapAngle;
  }

  // Right flap (+X)
  const hingeRight = new THREE.Group();
  hingeRight.position.set(halfX - wallThickness / 2, size.y, 0);
  group.add(hingeRight);
  {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(flapWidth, wallThickness, size.z - wallThickness * 2), outerMat);
    flap.castShadow = true; flap.receiveShadow = true;
    flap.position.set(-flapWidth / 2, 0, 0);
    hingeRight.add(flap);
    hingeRight.rotation.z = flapAngle;
  }

  // Left flap (-X)
  const hingeLeft = new THREE.Group();
  hingeLeft.position.set(-halfX + wallThickness / 2, size.y, 0);
  group.add(hingeLeft);
  {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(flapWidth, wallThickness, size.z - wallThickness * 2), outerMat);
    flap.castShadow = true; flap.receiveShadow = true;
    flap.position.set(flapWidth / 2, 0, 0);
    hingeLeft.add(flap);
    hingeLeft.rotation.z = -flapAngle;
  }

  // Tape strip — hidden by default, drawn out across the seam during the
  // close animation. Lies flat across the closed-flaps top, scaling from 0
  // to full width. Uses the same tan-gradient as the other tape labels.
  const tapeStripGeo = new THREE.PlaneGeometry(size.x * 0.9, 0.22);
  const tapeStripMat = new THREE.MeshStandardMaterial({
    color: '#c9a566',
    roughness: 0.55,
    metalness: 0.05,
    transparent: true,
    opacity: 0.94,
  });
  const tapeStrip = new THREE.Mesh(tapeStripGeo, tapeStripMat);
  tapeStrip.rotation.x = -Math.PI / 2;
  tapeStrip.position.y = size.y + 0.005;
  tapeStrip.scale.x = 0; // start invisible
  tapeStrip.visible = false;
  group.add(tapeStrip);

  return {
    group,
    pickables,
    setLabel,
    flapAngle,             // the "fully open" angle, used by close animation as the start
    hinges: { front: hingeFront, back: hingeBack, left: hingeLeft, right: hingeRight },
    tapeStrip,             // mesh to grow across the seam during close
  };
}

// Marker-style label scrawled on the side of a box.
// Transparent background so the cardboard texture shows through.
function makeBoxSideLabelTexture(text) {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  if (!text) return new THREE.CanvasTexture(c);

  // Marker stroke — slight tilt, offset shadow first for sharpie smudge
  g.save();
  g.translate(W / 2, H / 2);
  g.rotate(-0.025);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Size scales down with text length
  const baseSize = Math.min(180, Math.max(96, 1100 / Math.max(text.length, 4)));
  g.font = `400 ${baseSize}px "Permanent Marker", cursive`;

  // Shadow / smudge layer
  g.fillStyle = 'rgba(20, 14, 12, 0.30)';
  g.fillText(text, 4, 4);

  // Main marker layer
  g.fillStyle = 'rgba(20, 14, 12, 0.92)';
  g.fillText(text, 0, 0);
  g.restore();

  // A few "ink-broke" gaps to suggest a worn marker tip
  for (let i = 0; i < 60; i++) {
    g.clearRect(
      W * 0.18 + Math.random() * W * 0.64,
      H * 0.32 + Math.random() * H * 0.36,
      2 + Math.random() * 6,
      1 + Math.random() * 4
    );
  }

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

// ============================================================
// Sample items inside the open box
// ============================================================
// (createSampleItems removed — items live on each box record in the App's
// boxes[] array, instantiated via createItemMesh below)

// makeCD — tries to use a real GLB model from /public/models/cd.glb if available.
// If loaded, it applies the marker-scrawl title to a mesh named "CD_Face" inside
// the model (you set this name in Blender). If no model is available, falls back
// to the procedural disc geometry below.
function makeCD(color, title) {
  const model = getModel('cd');
  if (model) {
    const labelTex = makeCDFaceTexture(color, title);
    applyLabelToMesh(model, 'CD_Face', labelTex, { metalness: 0.6, roughness: 0.32 });
    return model;
  }
  return makeProceduralCD(color, title);
}

function makeProceduralCD(color, title) {
  const g = new THREE.Group();
  const labelTex = makeCDFaceTexture(color, title);
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 0.018, 48),
    [
      // CD has 3 BufferGeometry groups for cylinder: side, top, bottom
      new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.35 }),
      new THREE.MeshStandardMaterial({ map: labelTex, metalness: 0.4, roughness: 0.45 }),
      new THREE.MeshStandardMaterial({ color: '#cccccc', metalness: 0.85, roughness: 0.25 }),
    ]
  );
  disc.castShadow = true; disc.receiveShadow = true;
  g.add(disc);
  // Center hole
  const hole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.022, 24),
    new THREE.MeshStandardMaterial({ color: '#1a1410', metalness: 0.3, roughness: 0.7 })
  );
  g.add(hole);
  return g;
}

// makePhoto — uses /public/models/photo.glb if available; mesh "Photo_Front" gets the photo texture.
function makePhoto(color) {
  const model = getModel('photo');
  if (model) {
    const photoTex = makePhotoTexture(color);
    applyLabelToMesh(model, 'Photo_Front', photoTex, { roughness: 0.5 });
    return model;
  }
  return makeProceduralPhoto(color);
}

function makeProceduralPhoto(color) {
  const g = new THREE.Group();
  const w = 0.7, h = 0.018, d = 0.5;
  const photoTex = makePhotoTexture(color);
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [
    new THREE.MeshStandardMaterial({ color: '#f5f1e6' }),
    new THREE.MeshStandardMaterial({ color: '#f5f1e6' }),
    new THREE.MeshStandardMaterial({ map: photoTex, roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ color: '#f5f1e6' }),
    new THREE.MeshStandardMaterial({ color: '#f5f1e6' }),
    new THREE.MeshStandardMaterial({ color: '#f5f1e6' }),
  ]);
  top.castShadow = true; top.receiveShadow = true;
  g.add(top);
  return g;
}

// makeCassette — uses /public/models/cassette.glb if available; mesh "Cassette_Label" gets the marker text.
function makeCassette(title) {
  const model = getModel('cassette');
  if (model) {
    const labelTex = makeCassetteLabelTexture(title);
    applyLabelToMesh(model, 'Cassette_Label', labelTex, { roughness: 0.85 });
    return model;
  }
  return makeProceduralCassette(title);
}

function makeProceduralCassette(title) {
  const g = new THREE.Group();
  const w = 0.62, h = 0.085, d = 0.42;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: '#1c1c20', roughness: 0.6, metalness: 0.05 }));
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  for (const ox of [-0.15, 0.15]) {
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 24), new THREE.MeshStandardMaterial({ color: '#9a8c70', roughness: 0.5 }));
    reel.position.set(ox, h / 2 + 0.001, 0); g.add(reel);
  }
  // Label panel with marker text
  const labelTex = makeCassetteLabelTexture(title);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.78, d * 0.40),
    new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.85, transparent: true })
  );
  label.rotation.x = -Math.PI / 2;
  label.position.set(0, h / 2 + 0.002, d * 0.22);
  g.add(label);
  return g;
}

// makeFloppy — uses /public/models/floppy.glb if available; mesh "Floppy_Label" gets the marker text.
function makeFloppy(color, title) {
  const model = getModel('floppy');
  if (model) {
    const labelTex = makeFloppyLabelTexture(title);
    applyLabelToMesh(model, 'Floppy_Label', labelTex, { roughness: 0.85 });
    return model;
  }
  return makeProceduralFloppy(color, title);
}

function makeProceduralFloppy(color, title) {
  const g = new THREE.Group();
  const s = 0.42, h = 0.04;
  const body = new THREE.Mesh(new THREE.BoxGeometry(s, h, s), new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 }));
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  const slider = new THREE.Mesh(new THREE.BoxGeometry(s * 0.5, 0.005, s * 0.18), new THREE.MeshStandardMaterial({ color: '#bcc0c8', metalness: 0.7, roughness: 0.3 }));
  slider.position.set(0, h / 2 + 0.003, -s * 0.32); g.add(slider);
  const labelTex = makeFloppyLabelTexture(title);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(s * 0.78, s * 0.42),
    new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.85, transparent: true })
  );
  label.rotation.x = -Math.PI / 2;
  label.position.set(0, h / 2 + 0.001, s * 0.12);
  g.add(label);
  return g;
}

// makePostIt — uses /public/models/postit.glb if available; mesh "PostIt_Top" gets the marker text.
function makePostIt(color, title) {
  const model = getModel('postit');
  if (model) {
    const tex = makePostItTexture(color, title);
    applyLabelToMesh(model, 'PostIt_Top', tex, { roughness: 0.85 });
    return model;
  }
  return makeProceduralPostIt(color, title);
}

function makeProceduralPostIt(color, title) {
  const g = new THREE.Group();
  const s = 0.38, h = 0.012;
  const tex = makePostItTexture(color, title);
  const body = new THREE.Mesh(new THREE.BoxGeometry(s, h, s), [
    new THREE.MeshStandardMaterial({ color: shade(color, -10) }),
    new THREE.MeshStandardMaterial({ color: shade(color, -10) }),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: shade(color, -10) }),
    new THREE.MeshStandardMaterial({ color: shade(color, -10) }),
    new THREE.MeshStandardMaterial({ color: shade(color, -10) }),
  ]);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  return g;
}

// makeManila — uses /public/models/manila.glb if available; mesh "Manila_Sticky" gets the title.
function makeManila(title) {
  const model = getModel('manila');
  if (model) {
    const stickyTex = makeStickyTexture('#f6e572', title);
    applyLabelToMesh(model, 'Manila_Sticky', stickyTex, { roughness: 0.85 });
    return model;
  }
  return makeProceduralManila(title);
}

function makeProceduralManila(title) {
  const g = new THREE.Group();
  const w = 0.72, h = 0.012, d = 0.52;
  const folder = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: '#dccc8c', roughness: 0.85 }));
  folder.castShadow = true; folder.receiveShadow = true; g.add(folder);
  const tab = new THREE.Mesh(new THREE.BoxGeometry(w * 0.25, 0.008, d * 0.12), new THREE.MeshStandardMaterial({ color: '#cdba78', roughness: 0.85 }));
  tab.position.set(-w * 0.32, h / 2 + 0.004, -d / 2 - 0.03); g.add(tab);
  // Sticky note on top — bears the title
  const stickyTex = makeStickyTexture('#f6e572', title);
  const sticky = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.007, 0.22), [
    new THREE.MeshStandardMaterial({ color: '#e8d662' }),
    new THREE.MeshStandardMaterial({ color: '#e8d662' }),
    new THREE.MeshStandardMaterial({ map: stickyTex, roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: '#e8d662' }),
    new THREE.MeshStandardMaterial({ color: '#e8d662' }),
    new THREE.MeshStandardMaterial({ color: '#e8d662' }),
  ]);
  sticky.position.set(w * 0.05, h / 2 + 0.005, -d * 0.05); sticky.rotation.y = -0.15;
  g.add(sticky);
  return g;
}

// ============================================================
// Floor textures (large warehouse + small open-box ground)
// ============================================================
function makeFloorWithFade() {
  const SIZE = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  g.fillStyle = '#3f3a32';
  g.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(${30 + Math.random() * 35},${28 + Math.random() * 28},${22 + Math.random() * 22},${0.18 + Math.random() * 0.22})`;
    g.beginPath(); g.arc(Math.random() * SIZE, Math.random() * SIZE, 60 + Math.random() * 200, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 12000; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`;
    g.fillRect(Math.random() * SIZE, Math.random() * SIZE, 1 + Math.random(), 1 + Math.random());
  }
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = `rgba(220,210,190,${Math.random() * 0.06})`;
    g.fillRect(Math.random() * SIZE, Math.random() * SIZE, 1, 1);
  }
  for (let i = 0; i < 22; i++) {
    g.strokeStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.18})`;
    g.lineWidth = 0.4 + Math.random() * 0.8;
    g.beginPath();
    let x = Math.random() * SIZE, y = Math.random() * SIZE;
    g.moveTo(x, y);
    for (let j = 0; j < 8; j++) {
      x += (Math.random() - 0.5) * 130;
      y += (Math.random() - 0.5) * 130;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let i = 0; i < 4; i++) {
    const cx = SIZE * (0.3 + Math.random() * 0.4);
    const cy = SIZE * (0.3 + Math.random() * 0.4);
    const r = 30 + Math.random() * 60;
    const stain = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    stain.addColorStop(0, 'rgba(15,10,8,0.25)');
    stain.addColorStop(0.6, 'rgba(15,10,8,0.08)');
    stain.addColorStop(1, 'rgba(15,10,8,0)');
    g.fillStyle = stain;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  }
  const bg = hexToRgb(BG_COLOR);
  const grad = g.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.20, SIZE / 2, SIZE / 2, SIZE * 0.50);
  grad.addColorStop(0, `rgba(${bg.r},${bg.g},${bg.b},0)`);
  grad.addColorStop(0.55, `rgba(${bg.r},${bg.g},${bg.b},0.45)`);
  grad.addColorStop(0.85, `rgba(${bg.r},${bg.g},${bg.b},0.94)`);
  grad.addColorStop(1, `rgba(${bg.r},${bg.g},${bg.b},1)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, SIZE, SIZE);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

function makeFloorLogo() {
  const W = 1024, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(28, 22, 18, 0.62)';
  g.font = '400 200px "Permanent Marker", cursive';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save();
  g.translate(W / 2, H / 2 + 6);
  g.rotate(-0.018);
  g.fillText('box.ed', 0, 0);
  g.restore();
  for (let i = 0; i < 280; i++) {
    g.clearRect(Math.random() * W, 40 + Math.random() * (H - 80), 2 + Math.random() * 7, 1 + Math.random() * 5);
  }
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 35; i++) {
    g.fillStyle = `rgba(0,0,0,${0.3 + Math.random() * 0.45})`;
    g.beginPath(); g.arc(Math.random() * W, 30 + Math.random() * (H - 60), 7 + Math.random() * 18, 0, Math.PI * 2); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.75), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 1, metalness: 0, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.008, 1.4);
  m.receiveShadow = true;
  return m;
}

function makeSmallFloor() {
  const SIZE = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  g.fillStyle = '#3f3a32'; g.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(${30 + Math.random() * 35},${28 + Math.random() * 28},${22 + Math.random() * 22},${0.18 + Math.random() * 0.22})`;
    g.beginPath(); g.arc(Math.random() * SIZE, Math.random() * SIZE, 60 + Math.random() * 200, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 7000; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`;
    g.fillRect(Math.random() * SIZE, Math.random() * SIZE, 1 + Math.random(), 1 + Math.random());
  }
  const bg = hexToRgb(BG_COLOR);
  const grad = g.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.18, SIZE / 2, SIZE / 2, SIZE * 0.48);
  grad.addColorStop(0, `rgba(${bg.r},${bg.g},${bg.b},0)`);
  grad.addColorStop(0.6, `rgba(${bg.r},${bg.g},${bg.b},0.5)`);
  grad.addColorStop(1, `rgba(${bg.r},${bg.g},${bg.b},1)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, SIZE, SIZE);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

// ============================================================
// Cardboard / tape / scrawl / photo textures
// ============================================================
function makeCardboardTexture(seed = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const baseR = 192 + Math.floor(rand(seed * 1.3) * 14);
  const baseG = 150 + Math.floor(rand(seed * 2.1) * 12);
  const baseB = 102 + Math.floor(rand(seed * 3.7) * 10);
  g.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 28; i++) {
    g.fillStyle = `rgba(${110 + Math.random() * 45},${75 + Math.random() * 30},${45 + Math.random() * 22},${0.06 + Math.random() * 0.12})`;
    g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, 50 + Math.random() * 130, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(70,45,22,0.05)'; g.lineWidth = 1;
  for (let y = 0; y < 512; y += 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  for (let i = 0; i < 28; i++) {
    g.fillStyle = `rgba(45,28,16,${0.05 + Math.random() * 0.13})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 5 + Math.random() * 45, 1 + Math.random() * 4);
  }
  const grad = g.createRadialGradient(256, 256, 90, 256, 256, 380);
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(35,22,12,0.32)');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
  const id = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    id.data[i] = clamp(id.data[i] + n);
    id.data[i + 1] = clamp(id.data[i + 1] + n);
    id.data[i + 2] = clamp(id.data[i + 2] + n);
  }
  g.putImageData(id, 0, 0);
  return new THREE.CanvasTexture(c);
}

function makeTapeLabelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 192;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 192);
  grad.addColorStop(0, '#ecdca8'); grad.addColorStop(0.5, '#e0cc8c'); grad.addColorStop(1, '#d4c07c');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 192);
  for (let x = 0; x < 512; x += 5) {
    const top = Math.random() * 5; const bot = Math.random() * 5;
    g.clearRect(x, 0, 5, top); g.clearRect(x, 192 - bot, 5, bot);
  }
  g.fillStyle = 'rgba(255,245,200,0.13)'; g.fillRect(0, 28, 512, 26);
  g.fillStyle = '#1d1410';
  g.font = '400 70px "Permanent Marker", cursive';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save();
  g.translate(256, 100);
  g.rotate((Math.random() - 0.5) * 0.04);
  g.fillText(text, 0, 0);
  g.restore();
  return new THREE.CanvasTexture(c);
}

function makeFlapInsideTexture(text) {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(28, 22, 18, 0.85)';
  g.font = '400 90px "Permanent Marker", cursive';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save();
  g.translate(W / 2, H / 2 - 6);
  g.rotate(-0.04);
  g.fillText(text, 0, 0);
  g.restore();
  for (let i = 0; i < 80; i++) {
    g.clearRect(W * 0.18 + Math.random() * W * 0.64, H * 0.30 + Math.random() * H * 0.4, 2 + Math.random() * 5, 1 + Math.random() * 3);
  }
  g.fillStyle = 'rgba(28, 22, 18, 0.55)';
  g.font = '400 28px "Permanent Marker", cursive';
  g.fillText('used / total', W / 2, H * 0.78);
  return new THREE.CanvasTexture(c);
}

// ---- Item label textures (with marker scrawl titles) ----

function makeCDFaceTexture(baseColor, title) {
  const SIZE = 512;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');

  // Outer disc background — base color with subtle radial shimmer
  const grad = g.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.1, SIZE / 2, SIZE / 2, SIZE * 0.5);
  grad.addColorStop(0, shade(baseColor, 25));
  grad.addColorStop(0.5, baseColor);
  grad.addColorStop(1, shade(baseColor, -20));
  g.fillStyle = grad;
  g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2); g.fill();

  // Concentric grooves (very faint)
  for (let r = SIZE * 0.18; r < SIZE * 0.49; r += 4) {
    g.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`;
    g.lineWidth = 1;
    g.beginPath(); g.arc(SIZE / 2, SIZE / 2, r, 0, Math.PI * 2); g.stroke();
  }

  // Title in marker — straight across the middle, slightly tilted
  if (title) {
    g.save();
    g.translate(SIZE / 2, SIZE / 2);
    g.rotate(-0.06);
    g.fillStyle = 'rgba(20, 16, 14, 0.88)';
    g.font = `400 ${Math.min(64, Math.max(36, 540 / title.length))}px "Permanent Marker", cursive`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // First, test for sharpie smear by drawing slightly translucent first
    g.globalAlpha = 0.4;
    g.fillText(title, 1, 1);
    g.globalAlpha = 1;
    g.fillText(title, 0, 0);
    g.restore();
  }

  // A few wear scuffs
  for (let i = 0; i < 25; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.06 + Math.random() * 0.08})`;
    g.lineWidth = 0.5 + Math.random();
    g.beginPath();
    const cx = SIZE / 2, cy = SIZE / 2;
    const a = Math.random() * Math.PI * 2;
    const r1 = SIZE * (0.16 + Math.random() * 0.32);
    const r2 = r1 + 6 + Math.random() * 30;
    g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    g.lineTo(cx + Math.cos(a + 0.04) * r2, cy + Math.sin(a + 0.04) * r2);
    g.stroke();
  }

  // Center hole — punch transparency by drawing dark
  g.fillStyle = '#1a1410';
  g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE * 0.078, 0, Math.PI * 2); g.fill();
  // Inner ring (lighter)
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 2;
  g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE * 0.155, 0, Math.PI * 2); g.stroke();

  return new THREE.CanvasTexture(c);
}

function makeCassetteLabelTexture(title) {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // Off-white label with slight aging
  g.fillStyle = '#f0e9d0';
  g.fillRect(0, 0, W, H);
  // Subtle aged blotches
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(180,160,110,${0.03 + Math.random() * 0.06})`;
    g.beginPath(); g.arc(Math.random() * W, Math.random() * H, 18 + Math.random() * 50, 0, Math.PI * 2); g.fill();
  }
  // "side a" upper-left in tiny printed type
  g.fillStyle = 'rgba(60,50,40,0.55)';
  g.font = '600 22px Helvetica, Arial, sans-serif';
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText('SIDE A', 18, 14);
  // Title in marker
  if (title) {
    g.save();
    g.translate(W / 2, H / 2 + 18);
    g.rotate(-0.025);
    g.fillStyle = 'rgba(22,16,14,0.88)';
    g.font = `400 ${Math.min(78, Math.max(40, 720 / title.length))}px "Permanent Marker", cursive`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(title, 0, 0);
    g.restore();
  }
  // Faint divider line
  g.strokeStyle = 'rgba(70,55,40,0.35)';
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(40, H - 30); g.lineTo(W - 40, H - 30); g.stroke();
  return new THREE.CanvasTexture(c);
}

function makeFloppyLabelTexture(title) {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f5f1e6';
  g.fillRect(0, 0, W, H);
  // Slight tone
  for (let i = 0; i < 8; i++) {
    g.fillStyle = `rgba(180,160,110,${0.02 + Math.random() * 0.04})`;
    g.beginPath(); g.arc(Math.random() * W, Math.random() * H, 30 + Math.random() * 60, 0, Math.PI * 2); g.fill();
  }
  if (title) {
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-0.04);
    g.fillStyle = 'rgba(28,22,18,0.86)';
    g.font = `400 ${Math.min(72, Math.max(40, 700 / title.length))}px "Permanent Marker", cursive`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(title, 0, 0);
    g.restore();
  }
  return new THREE.CanvasTexture(c);
}

function makePostItTexture(baseColor, title) {
  const W = 384, H = 384;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = baseColor;
  g.fillRect(0, 0, W, H);
  // Subtle paper grain
  const id = g.getImageData(0, 0, W, H);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    id.data[i] = clamp(id.data[i] + n);
    id.data[i + 1] = clamp(id.data[i + 1] + n);
    id.data[i + 2] = clamp(id.data[i + 2] + n);
  }
  g.putImageData(id, 0, 0);
  if (title) {
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-0.06);
    g.fillStyle = 'rgba(28,22,18,0.85)';
    g.font = `400 ${Math.min(70, Math.max(40, 540 / title.length))}px "Permanent Marker", cursive`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(title, 0, 0);
    g.restore();
  }
  return new THREE.CanvasTexture(c);
}

function makeStickyTexture(baseColor, title) {
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = baseColor;
  g.fillRect(0, 0, W, H);
  if (title) {
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-0.05);
    g.fillStyle = 'rgba(28,22,18,0.88)';
    g.font = `400 ${Math.min(46, Math.max(26, 320 / Math.max(title.length, 1)))}px "Permanent Marker", cursive`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(title, 0, 0);
    g.restore();
  }
  return new THREE.CanvasTexture(c);
}

function makePhotoTexture(baseColor) {
  const W = 256, H = 192;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f5f1e6';
  g.fillRect(0, 0, W, H);
  const m = 12;
  const grad = g.createLinearGradient(0, m, 0, H - m);
  grad.addColorStop(0, baseColor);
  grad.addColorStop(1, shade(baseColor, -30));
  g.fillStyle = grad; g.fillRect(m, m, W - 2 * m, H - 2 * m);
  g.globalAlpha = 0.5;
  for (let i = 0; i < 4; i++) {
    g.fillStyle = shade(baseColor, Math.random() * 60 - 30);
    g.beginPath();
    g.arc(m + Math.random() * (W - 2 * m), m + Math.random() * (H - 2 * m), 15 + Math.random() * 35, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const id = g.getImageData(m, m, W - 2 * m, H - 2 * m);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    id.data[i] = clamp(id.data[i] + n);
    id.data[i + 1] = clamp(id.data[i + 1] + n);
    id.data[i + 2] = clamp(id.data[i + 2] + n);
  }
  g.putImageData(id, m, m);
  return new THREE.CanvasTexture(c);
}

// ============================================================
// Utils
// ============================================================
function clamp(v) { return Math.max(0, Math.min(255, v)); }
function rand(seed) { const s = Math.sin(seed) * 10000; return s - Math.floor(s); }
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function shade(hex, delta) {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${clamp(r + delta)},${clamp(g + delta)},${clamp(b + delta)})`;
}

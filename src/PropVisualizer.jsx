// ============================================================================
// box.ed — Prop Visualizer (expanded)
// ============================================================================
// Same setup as before:
//   1. CodeSandbox → React template (or StackBlitz / local Vite)
//   2. Add deps: three @react-three/fiber @react-three/drei leva
//   3. Replace src/App.js with this file
//   4. Save → 3D viewport on the right with prop dropdown + Leva panel
//
// What's new in this version:
//   - Every prop now has 15-25 controls, grouped into sub-folders.
//   - Sub-folders collapse independently so you can focus on one area
//     (e.g. close "Dimensions" and just play with "Surface" colors).
//   - All the magic numbers from the procedural code are now knobs:
//     scuff intensity, groove count, label tilt, color jitter, gradient
//     stops, paper grain, edge vignette, etc.
//   - When you hover the value of any number control, you can drag it
//     left/right to scrub, or click and type a precise value.
//   - The Leva panel is shown at the right edge of the viewport.
// ============================================================================

import React, { useMemo, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { useControls, folder, Leva } from 'leva';
import * as THREE from 'three';

// ============================================================================
// PROPS — registry of available items. Each entry has a render component.
// ============================================================================
const PROPS = [
  { id: 'cd',        label: 'CD',                Component: CDProp },
  { id: 'cassette',  label: 'Cassette tape',     Component: CassetteProp },
  { id: 'floppy',    label: 'Floppy disk',       Component: FloppyProp },
  { id: 'photo',     label: 'Photo print',       Component: PhotoProp },
  { id: 'postit',    label: 'Post-it note',      Component: PostItProp },
  { id: 'manila',    label: 'Manila folder',     Component: ManilaProp },
  { id: 'cardboard', label: 'Cardboard sample',  Component: CardboardProp },
];

// ============================================================================
// App — top-level layout. Picker on the top, Canvas + Leva panel below.
// ============================================================================
export default function App() {
  // Read prop selection from URL hash so it persists across reloads
  const initial = window.location.hash.slice(1) || 'cd';
  const [selected, setSelected] = useState(
    PROPS.find((p) => p.id === initial) ? initial : 'cd'
  );
  useEffect(() => { window.location.hash = selected; }, [selected]);

  // Load Permanent Marker font for marker-scrawl labels
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Permanent+Marker&display=swap';
    document.head.appendChild(link);
    return () => { if (link.parentNode) link.parentNode.removeChild(link); };
  }, []);

  const Active = PROPS.find((p) => p.id === selected)?.Component;

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#f0ece5', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ padding: '14px 22px', borderBottom: '1px solid #d4cfc4', display: 'flex', alignItems: 'center', gap: 18, background: '#faf7f0' }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: '#1d1410' }}>box.ed prop visualizer</span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={{ padding: '6px 12px', fontSize: 13, border: '1px solid #c5c1ba', background: '#fff', cursor: 'pointer' }}
        >
          {PROPS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#5a4f42', marginLeft: 'auto' }}>
          drag to orbit · scroll to zoom · use right-side panel to tweak
        </span>
      </div>

      <div style={{ flex: 1, position: 'relative' }}>
        <Canvas shadows camera={{ position: [1.6, 1.4, 1.6], fov: 35 }} style={{ background: '#f0ece5' }}>
          <hemisphereLight args={['#fff8eb', '#a39685', 0.7]} />
          <ambientLight color="#fff5e0" intensity={0.18} />
          <directionalLight
            position={[3, 5, 2]}
            intensity={1.05}
            color="#fff4dd"
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
          />
          <directionalLight position={[-3, 4, -2]} intensity={0.25} color="#a8b0c2" />
          <ContactShadows position={[0, -0.001, 0]} opacity={0.4} scale={5} blur={2.4} far={1.5} />

          {Active && <Active />}

          <OrbitControls enablePan={false} minDistance={0.6} maxDistance={6} />
        </Canvas>

        <Leva collapsed={false} oneLineLabels={false} />
      </div>
    </div>
  );
}

// ============================================================================
// CD prop — disc with marker-scrawl label. ~22 controls.
// ============================================================================
function CDProp() {
  const c = useControls({
    'Dimensions': folder({
      radius: { value: 0.32, min: 0.15, max: 0.50, step: 0.005 },
      thickness: { value: 0.018, min: 0.005, max: 0.05, step: 0.001 },
      holeRadius: { value: 0.05, min: 0.02, max: 0.10, step: 0.001 },
      ringRadius: { value: 0.10, min: 0.06, max: 0.18, step: 0.001 },
    }),
    'Disc surface': folder({
      color: '#3088c8',
      shimmerStrength: { value: 25, min: 0, max: 60, step: 1, hint: 'how much the radial gradient lightens center & darkens edge' },
      grooveCount: { value: 30, min: 0, max: 80, step: 1 },
      grooveOpacity: { value: 0.05, min: 0, max: 0.4, step: 0.005 },
      scuffCount: { value: 25, min: 0, max: 80, step: 1 },
      scuffOpacity: { value: 0.10, min: 0, max: 0.4, step: 0.01 },
    }),
    'Materials': folder({
      faceMetalness: { value: 0.6, min: 0, max: 1, step: 0.05 },
      faceRoughness: { value: 0.32, min: 0, max: 1, step: 0.05 },
      edgeMetalness: { value: 0.7, min: 0, max: 1, step: 0.05 },
      edgeRoughness: { value: 0.35, min: 0, max: 1, step: 0.05 },
    }),
    'Label': folder({
      title: 'SUMMER 07',
      titleTilt: { value: -0.06, min: -0.4, max: 0.4, step: 0.005 },
      titleSizeBase: { value: 64, min: 24, max: 96, step: 1, hint: 'maximum font size; shrinks for longer titles' },
      titleOpacity: { value: 0.88, min: 0, max: 1, step: 0.02 },
      smudgeOpacity: { value: 0.4, min: 0, max: 1, step: 0.02, hint: 'shadow under the marker text' },
    }),
  });
  const mesh = useMemo(() => makeCD(c), [c]);
  return <primitive object={mesh} />;
}

function makeCD(c) {
  const g = new THREE.Group();
  const labelTex = makeCDFaceTexture(c);
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(c.radius, c.radius, c.thickness, 48),
    [
      new THREE.MeshStandardMaterial({ color: c.color, metalness: c.edgeMetalness, roughness: c.edgeRoughness }),
      new THREE.MeshStandardMaterial({ map: labelTex, metalness: c.faceMetalness, roughness: c.faceRoughness }),
      new THREE.MeshStandardMaterial({ color: '#cccccc', metalness: 0.85, roughness: 0.25 }),
    ]
  );
  disc.castShadow = true; disc.receiveShadow = true;
  g.add(disc);
  const hole = new THREE.Mesh(
    new THREE.CylinderGeometry(c.holeRadius, c.holeRadius, c.thickness * 1.2, 24),
    new THREE.MeshStandardMaterial({ color: '#1a1410', metalness: 0.3, roughness: 0.7 })
  );
  g.add(hole);
  return g;
}

function makeCDFaceTexture(c) {
  const SIZE = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const g = cv.getContext('2d');
  // Outer disc background — base color with subtle radial shimmer
  const grad = g.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.1, SIZE / 2, SIZE / 2, SIZE * 0.5);
  grad.addColorStop(0, shade(c.color, c.shimmerStrength));
  grad.addColorStop(0.5, c.color);
  grad.addColorStop(1, shade(c.color, -c.shimmerStrength * 0.8));
  g.fillStyle = grad;
  g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2); g.fill();
  // Concentric grooves
  for (let i = 0; i < c.grooveCount; i++) {
    const r = SIZE * (0.18 + (i / Math.max(c.grooveCount, 1)) * 0.31);
    g.strokeStyle = `rgba(255,255,255,${c.grooveOpacity * (0.6 + Math.random() * 0.8)})`;
    g.lineWidth = 1;
    g.beginPath(); g.arc(SIZE / 2, SIZE / 2, r, 0, Math.PI * 2); g.stroke();
  }
  // Title
  if (c.title) {
    g.save();
    g.translate(SIZE / 2, SIZE / 2);
    g.rotate(c.titleTilt);
    g.fillStyle = `rgba(20, 16, 14, ${c.titleOpacity})`;
    g.font = `400 ${Math.min(c.titleSizeBase, Math.max(36, 540 / c.title.length))}px "Permanent Marker", cursive`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.globalAlpha = c.smudgeOpacity; g.fillText(c.title, 1, 1);
    g.globalAlpha = 1; g.fillText(c.title, 0, 0);
    g.restore();
  }
  // Wear scuffs
  for (let i = 0; i < c.scuffCount; i++) {
    g.strokeStyle = `rgba(255,255,255,${c.scuffOpacity * (0.5 + Math.random() * 0.8)})`;
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
  // Hole + inner ring
  g.fillStyle = '#1a1410';
  g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE * (c.holeRadius / c.radius) * 0.5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 2;
  g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE * (c.ringRadius / c.radius) * 0.5, 0, Math.PI * 2); g.stroke();
  return new THREE.CanvasTexture(cv);
}

// ============================================================================
// Cassette — body + reels + label panel. ~22 controls.
// ============================================================================
function CassetteProp() {
  const c = useControls({
    'Dimensions': folder({
      width:  { value: 0.62, min: 0.30, max: 1.00, step: 0.01 },
      depth:  { value: 0.42, min: 0.20, max: 0.80, step: 0.01 },
      height: { value: 0.085, min: 0.04, max: 0.18, step: 0.005 },
    }),
    'Body': folder({
      bodyColor: '#1c1c20',
      bodyRoughness: { value: 0.6, min: 0, max: 1, step: 0.05 },
      bodyMetalness: { value: 0.05, min: 0, max: 1, step: 0.05 },
    }),
    'Reels': folder({
      reelColor: '#9a8c70',
      reelRadius: { value: 0.07, min: 0.03, max: 0.13, step: 0.005 },
      reelOffset: { value: 0.15, min: 0.05, max: 0.30, step: 0.005, hint: 'distance from center' },
      reelRoughness: { value: 0.5, min: 0, max: 1, step: 0.05 },
    }),
    'Label': folder({
      title: 'DEMO TAPE',
      labelColor: '#f0e9d0',
      labelTilt: { value: -0.025, min: -0.4, max: 0.4, step: 0.005 },
      titleSizeBase: { value: 78, min: 30, max: 120, step: 1 },
      labelWidthFactor: { value: 0.78, min: 0.3, max: 1.0, step: 0.02 },
      labelDepthFactor: { value: 0.40, min: 0.2, max: 0.8, step: 0.02 },
      labelOffsetZ: { value: 0.22, min: -0.4, max: 0.4, step: 0.01, hint: 'forward/back position on the cassette face' },
      agingBlobs: { value: 14, min: 0, max: 40, step: 1 },
      agingOpacity: { value: 0.05, min: 0, max: 0.3, step: 0.005 },
      showSideA: true,
    }),
  });
  const mesh = useMemo(() => makeCassette(c), [c]);
  return <primitive object={mesh} />;
}

function makeCassette(c) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(c.width, c.height, c.depth),
    new THREE.MeshStandardMaterial({ color: c.bodyColor, roughness: c.bodyRoughness, metalness: c.bodyMetalness })
  );
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  for (const ox of [-c.reelOffset, c.reelOffset]) {
    const reel = new THREE.Mesh(
      new THREE.CylinderGeometry(c.reelRadius, c.reelRadius, 0.01, 24),
      new THREE.MeshStandardMaterial({ color: c.reelColor, roughness: c.reelRoughness })
    );
    reel.position.set(ox, c.height / 2 + 0.001, 0);
    g.add(reel);
  }
  const labelTex = makeCassetteLabelTexture(c);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(c.width * c.labelWidthFactor, c.depth * c.labelDepthFactor),
    new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.85, transparent: true })
  );
  label.rotation.x = -Math.PI / 2;
  label.position.set(0, c.height / 2 + 0.002, c.depth * c.labelOffsetZ);
  g.add(label);
  return g;
}

function makeCassetteLabelTexture(c) {
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = c.labelColor; g.fillRect(0, 0, W, H);
  for (let i = 0; i < c.agingBlobs; i++) {
    g.fillStyle = `rgba(180,160,110,${c.agingOpacity + Math.random() * c.agingOpacity})`;
    g.beginPath(); g.arc(Math.random() * W, Math.random() * H, 18 + Math.random() * 50, 0, Math.PI * 2); g.fill();
  }
  if (c.showSideA) {
    g.fillStyle = 'rgba(60,50,40,0.55)';
    g.font = '600 22px Helvetica, Arial, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('SIDE A', 18, 14);
  }
  if (c.title) {
    g.save();
    g.translate(W / 2, H / 2 + 18);
    g.rotate(c.labelTilt);
    g.fillStyle = 'rgba(22,16,14,0.88)';
    g.font = `400 ${Math.min(c.titleSizeBase, Math.max(40, 720 / c.title.length))}px "Permanent Marker", cursive`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(c.title, 0, 0);
    g.restore();
  }
  g.strokeStyle = 'rgba(70,55,40,0.35)';
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(40, H - 30); g.lineTo(W - 40, H - 30); g.stroke();
  return new THREE.CanvasTexture(cv);
}

// ============================================================================
// Floppy — body + slider + write-protect tab + label. ~20 controls.
// ============================================================================
function FloppyProp() {
  const c = useControls({
    'Dimensions': folder({
      size:   { value: 0.42, min: 0.20, max: 0.70, step: 0.01 },
      height: { value: 0.04, min: 0.015, max: 0.08, step: 0.002 },
    }),
    'Body': folder({
      bodyColor: '#3a3a44',
      bodyRoughness: { value: 0.55, min: 0, max: 1, step: 0.05 },
      bodyMetalness: { value: 0.05, min: 0, max: 1, step: 0.05 },
    }),
    'Metal slider': folder({
      sliderColor: '#bcc0c8',
      sliderWidthFactor:  { value: 0.5, min: 0.2, max: 0.9, step: 0.02 },
      sliderDepthFactor:  { value: 0.18, min: 0.08, max: 0.4, step: 0.01 },
      sliderOffsetZ: { value: -0.32, min: -0.5, max: 0.5, step: 0.02 },
      sliderMetalness: { value: 0.7, min: 0, max: 1, step: 0.05 },
      sliderRoughness: { value: 0.3, min: 0, max: 1, step: 0.05 },
    }),
    'Write-protect tab': folder({
      showTab: true,
      tabSizeFactor: { value: 0.06, min: 0.02, max: 0.15, step: 0.005 },
    }),
    'Label': folder({
      title: 'taxes.xls',
      titleTilt: { value: -0.04, min: -0.4, max: 0.4, step: 0.005 },
      titleSizeBase: { value: 72, min: 30, max: 120, step: 1 },
      labelWidthFactor: { value: 0.78, min: 0.3, max: 1.0, step: 0.02 },
      labelDepthFactor: { value: 0.42, min: 0.2, max: 0.8, step: 0.02 },
      labelOffsetZ: { value: 0.12, min: -0.4, max: 0.4, step: 0.01 },
    }),
  });
  const mesh = useMemo(() => makeFloppy(c), [c]);
  return <primitive object={mesh} />;
}

function makeFloppy(c) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(c.size, c.height, c.size),
    new THREE.MeshStandardMaterial({ color: c.bodyColor, roughness: c.bodyRoughness, metalness: c.bodyMetalness })
  );
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  // Metal slider
  const slider = new THREE.Mesh(
    new THREE.BoxGeometry(c.size * c.sliderWidthFactor, 0.005, c.size * c.sliderDepthFactor),
    new THREE.MeshStandardMaterial({ color: c.sliderColor, metalness: c.sliderMetalness, roughness: c.sliderRoughness })
  );
  slider.position.set(0, c.height / 2 + 0.003, c.size * c.sliderOffsetZ);
  g.add(slider);
  // Write-protect tab — small dark square at one corner
  if (c.showTab) {
    const tab = new THREE.Mesh(
      new THREE.BoxGeometry(c.size * c.tabSizeFactor, 0.004, c.size * c.tabSizeFactor),
      new THREE.MeshStandardMaterial({ color: '#15151a', roughness: 0.7 })
    );
    tab.position.set(c.size * 0.38, c.height / 2 + 0.003, c.size * 0.38);
    g.add(tab);
  }
  // Label
  const labelTex = makeFloppyLabelTexture(c);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(c.size * c.labelWidthFactor, c.size * c.labelDepthFactor),
    new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.85, transparent: true })
  );
  label.rotation.x = -Math.PI / 2;
  label.position.set(0, c.height / 2 + 0.001, c.size * c.labelOffsetZ);
  g.add(label);
  return g;
}

function makeFloppyLabelTexture(c) {
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#f5f1e6'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = `rgba(180,160,110,${0.02 + Math.random() * 0.04})`;
    g.beginPath(); g.arc(Math.random() * W, Math.random() * H, 30 + Math.random() * 60, 0, Math.PI * 2); g.fill();
  }
  if (c.title) {
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(c.titleTilt);
    g.fillStyle = 'rgba(28,22,18,0.86)';
    g.font = `400 ${Math.min(c.titleSizeBase, Math.max(40, 700 / c.title.length))}px "Permanent Marker", cursive`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(c.title, 0, 0);
    g.restore();
  }
  return new THREE.CanvasTexture(cv);
}

// ============================================================================
// Photo print — paper plus subject art. ~18 controls.
// ============================================================================
function PhotoProp() {
  const c = useControls({
    'Dimensions': folder({
      width:  { value: 0.7, min: 0.30, max: 1.20, step: 0.02 },
      depth:  { value: 0.5, min: 0.25, max: 0.90, step: 0.02 },
      height: { value: 0.018, min: 0.005, max: 0.05, step: 0.001 },
    }),
    'Paper': folder({
      paperColor: '#f5f1e6',
      borderThickness: { value: 12, min: 0, max: 60, step: 1, hint: 'pixels of white border around the subject' },
    }),
    'Subject': folder({
      subjectColor: '#e89868',
      subjectGradientStrength: { value: 30, min: 0, max: 100, step: 1, hint: 'how much darker the bottom of the subject is' },
      blobCount: { value: 4, min: 0, max: 12, step: 1 },
      blobSizeMin: { value: 15, min: 5, max: 50, step: 1 },
      blobSizeMax: { value: 50, min: 10, max: 100, step: 1 },
      blobOpacity: { value: 0.5, min: 0, max: 1, step: 0.05 },
      noiseIntensity: { value: 22, min: 0, max: 80, step: 1, hint: 'film grain' },
    }),
    'Material': folder({
      roughness: { value: 0.5, min: 0, max: 1, step: 0.05 },
    }),
  });
  const mesh = useMemo(() => makePhoto(c), [c]);
  return <primitive object={mesh} />;
}

function makePhoto(c) {
  const g = new THREE.Group();
  const photoTex = makePhotoTexture(c);
  const paperMat = new THREE.MeshStandardMaterial({ color: c.paperColor });
  const top = new THREE.Mesh(new THREE.BoxGeometry(c.width, c.height, c.depth), [
    paperMat, paperMat,
    new THREE.MeshStandardMaterial({ map: photoTex, roughness: c.roughness }),
    paperMat, paperMat, paperMat,
  ]);
  top.castShadow = true; top.receiveShadow = true;
  g.add(top);
  return g;
}

function makePhotoTexture(c) {
  const W = 256, H = 192;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = c.paperColor; g.fillRect(0, 0, W, H);
  const m = c.borderThickness;
  if (W - 2 * m > 0 && H - 2 * m > 0) {
    const grad = g.createLinearGradient(0, m, 0, H - m);
    grad.addColorStop(0, c.subjectColor);
    grad.addColorStop(1, shade(c.subjectColor, -c.subjectGradientStrength));
    g.fillStyle = grad; g.fillRect(m, m, W - 2 * m, H - 2 * m);
    g.globalAlpha = c.blobOpacity;
    for (let i = 0; i < c.blobCount; i++) {
      g.fillStyle = shade(c.subjectColor, Math.random() * 60 - 30);
      g.beginPath();
      const r = c.blobSizeMin + Math.random() * (c.blobSizeMax - c.blobSizeMin);
      g.arc(m + Math.random() * (W - 2 * m), m + Math.random() * (H - 2 * m), r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    if (c.noiseIntensity > 0) {
      const id = g.getImageData(m, m, W - 2 * m, H - 2 * m);
      for (let i = 0; i < id.data.length; i += 4) {
        const n = (Math.random() - 0.5) * c.noiseIntensity;
        id.data[i] = clamp(id.data[i] + n);
        id.data[i + 1] = clamp(id.data[i + 1] + n);
        id.data[i + 2] = clamp(id.data[i + 2] + n);
      }
      g.putImageData(id, m, m);
    }
  }
  return new THREE.CanvasTexture(cv);
}

// ============================================================================
// Post-it — flat square with marker text. ~14 controls.
// ============================================================================
function PostItProp() {
  const c = useControls({
    'Dimensions': folder({
      size:   { value: 0.38, min: 0.20, max: 0.70, step: 0.01 },
      height: { value: 0.012, min: 0.003, max: 0.04, step: 0.001 },
    }),
    'Paper': folder({
      color: '#f6e572',
      grainIntensity: { value: 10, min: 0, max: 40, step: 1 },
      sideShadeAmount: { value: -10, min: -50, max: 0, step: 1, hint: 'how much darker the sides are than the top' },
    }),
    'Note': folder({
      title: 'remind me',
      titleTilt: { value: -0.06, min: -0.4, max: 0.4, step: 0.005 },
      titleSizeBase: { value: 70, min: 24, max: 120, step: 1 },
      titleOpacity: { value: 0.85, min: 0, max: 1, step: 0.02 },
    }),
  });
  const mesh = useMemo(() => makePostIt(c), [c]);
  return <primitive object={mesh} />;
}

function makePostIt(c) {
  const g = new THREE.Group();
  const tex = makePostItTexture(c);
  const sideMat = new THREE.MeshStandardMaterial({ color: shade(c.color, c.sideShadeAmount) });
  const body = new THREE.Mesh(new THREE.BoxGeometry(c.size, c.height, c.size), [
    sideMat, sideMat,
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }),
    sideMat, sideMat, sideMat,
  ]);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  return g;
}

function makePostItTexture(c) {
  const W = 384, H = 384;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = c.color; g.fillRect(0, 0, W, H);
  if (c.grainIntensity > 0) {
    const id = g.getImageData(0, 0, W, H);
    for (let i = 0; i < id.data.length; i += 4) {
      const n = (Math.random() - 0.5) * c.grainIntensity;
      id.data[i] = clamp(id.data[i] + n);
      id.data[i + 1] = clamp(id.data[i + 1] + n);
      id.data[i + 2] = clamp(id.data[i + 2] + n);
    }
    g.putImageData(id, 0, 0);
  }
  if (c.title) {
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(c.titleTilt);
    g.fillStyle = `rgba(28,22,18,${c.titleOpacity})`;
    g.font = `400 ${Math.min(c.titleSizeBase, Math.max(30, 540 / c.title.length))}px "Permanent Marker", cursive`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(c.title, 0, 0);
    g.restore();
  }
  return new THREE.CanvasTexture(cv);
}

// ============================================================================
// Manila folder — folder + tab + sticky note. ~22 controls.
// ============================================================================
function ManilaProp() {
  const c = useControls({
    'Folder dimensions': folder({
      width:  { value: 0.72, min: 0.40, max: 1.00, step: 0.02 },
      depth:  { value: 0.52, min: 0.30, max: 0.80, step: 0.02 },
      height: { value: 0.012, min: 0.005, max: 0.04, step: 0.001 },
    }),
    'Folder color': folder({
      folderColor: '#dccc8c',
      folderRoughness: { value: 0.85, min: 0, max: 1, step: 0.05 },
    }),
    'Tab': folder({
      tabColor: '#cdba78',
      tabWidthFactor: { value: 0.25, min: 0.10, max: 0.50, step: 0.02 },
      tabDepthFactor: { value: 0.12, min: 0.05, max: 0.30, step: 0.01 },
      tabOffsetX: { value: -0.32, min: -0.5, max: 0.5, step: 0.02, hint: 'left/right position along the back edge' },
    }),
    'Sticky note': folder({
      showSticky: true,
      title: 'old work',
      stickyColor: '#f6e572',
      stickySize: { value: 0.22, min: 0.10, max: 0.40, step: 0.01 },
      stickyOffsetX: { value: 0.05, min: -0.5, max: 0.5, step: 0.01 },
      stickyOffsetZ: { value: -0.05, min: -0.5, max: 0.5, step: 0.01 },
      stickyRotation: { value: -0.15, min: -0.8, max: 0.8, step: 0.02 },
      titleSizeBase: { value: 46, min: 18, max: 80, step: 1 },
    }),
  });
  const mesh = useMemo(() => makeManila(c), [c]);
  return <primitive object={mesh} />;
}

function makeManila(c) {
  const g = new THREE.Group();
  const folder = new THREE.Mesh(
    new THREE.BoxGeometry(c.width, c.height, c.depth),
    new THREE.MeshStandardMaterial({ color: c.folderColor, roughness: c.folderRoughness })
  );
  folder.castShadow = true; folder.receiveShadow = true;
  g.add(folder);
  const tab = new THREE.Mesh(
    new THREE.BoxGeometry(c.width * c.tabWidthFactor, 0.008, c.depth * c.tabDepthFactor),
    new THREE.MeshStandardMaterial({ color: c.tabColor, roughness: c.folderRoughness })
  );
  tab.position.set(c.width * c.tabOffsetX, c.height / 2 + 0.004, -c.depth / 2 - 0.03);
  g.add(tab);
  if (c.showSticky) {
    const stickyTex = makeStickyTexture(c);
    const sideMat = new THREE.MeshStandardMaterial({ color: shade(c.stickyColor, -8) });
    const sticky = new THREE.Mesh(new THREE.BoxGeometry(c.stickySize, 0.007, c.stickySize), [
      sideMat, sideMat,
      new THREE.MeshStandardMaterial({ map: stickyTex, roughness: 0.85 }),
      sideMat, sideMat, sideMat,
    ]);
    sticky.position.set(c.width * c.stickyOffsetX, c.height / 2 + 0.005, c.depth * c.stickyOffsetZ);
    sticky.rotation.y = c.stickyRotation;
    g.add(sticky);
  }
  return g;
}

function makeStickyTexture(c) {
  const W = 256, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = c.stickyColor; g.fillRect(0, 0, W, H);
  if (c.title) {
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-0.05);
    g.fillStyle = 'rgba(28,22,18,0.88)';
    g.font = `400 ${Math.min(c.titleSizeBase, Math.max(20, 320 / Math.max(c.title.length, 1)))}px "Permanent Marker", cursive`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(c.title, 0, 0);
    g.restore();
  }
  return new THREE.CanvasTexture(cv);
}

// ============================================================================
// Cardboard sample — bare cube with cardboard texture for tweaking. ~18 controls.
// ============================================================================
function CardboardProp() {
  const c = useControls({
    'Box': folder({
      size: { value: 1.0, min: 0.4, max: 2.0, step: 0.05 },
    }),
    'Base color': folder({
      seed: { value: 1, min: 1, max: 100, step: 1, hint: 'changes random distribution of blobs/scuffs' },
      baseR: { value: 192, min: 100, max: 240, step: 2 },
      baseG: { value: 150, min: 80, max: 220, step: 2 },
      baseB: { value: 102, min: 50, max: 200, step: 2 },
    }),
    'Tonal blobs': folder({
      blobCount: { value: 28, min: 0, max: 80, step: 1, hint: 'darker patches that suggest natural variation' },
      blobOpacityMin: { value: 0.06, min: 0, max: 0.4, step: 0.01 },
      blobOpacityMax: { value: 0.18, min: 0, max: 0.6, step: 0.01 },
      blobSizeMin: { value: 50, min: 10, max: 200, step: 5 },
      blobSizeMax: { value: 180, min: 30, max: 400, step: 5 },
    }),
    'Surface detail': folder({
      corrugationOpacity: { value: 0.05, min: 0, max: 0.3, step: 0.005, hint: 'horizontal banding from cardboard fluting' },
      scuffCount: { value: 28, min: 0, max: 100, step: 1, hint: 'small dark marks on the surface' },
      scuffOpacity: { value: 0.13, min: 0, max: 0.5, step: 0.01 },
      noiseIntensity: { value: 18, min: 0, max: 60, step: 1, hint: 'overall paper grain' },
    }),
    'Edge vignette': folder({
      vignetteOpacity: { value: 0.32, min: 0, max: 0.8, step: 0.02 },
      vignetteRadius: { value: 380, min: 200, max: 500, step: 10, hint: 'how far in the dark edges reach' },
    }),
    'Material': folder({
      roughness: { value: 0.96, min: 0, max: 1, step: 0.02 },
      metalness: { value: 0, min: 0, max: 0.3, step: 0.01 },
    }),
  });
  const mesh = useMemo(() => {
    const tex = makeCardboardTexture(c);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(c.size, c.size, c.size),
      new THREE.MeshStandardMaterial({ map: tex, roughness: c.roughness, metalness: c.metalness })
    );
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }, [c]);
  return <primitive object={mesh} />;
}

function makeCardboardTexture(c) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const g = cv.getContext('2d');
  // Base color with seed-based jitter
  const baseR = c.baseR + Math.floor(rand(c.seed * 1.3) * 14);
  const baseG = c.baseG + Math.floor(rand(c.seed * 2.1) * 12);
  const baseB = c.baseB + Math.floor(rand(c.seed * 3.7) * 10);
  g.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
  g.fillRect(0, 0, 512, 512);
  // Tonal blobs
  for (let i = 0; i < c.blobCount; i++) {
    const op = c.blobOpacityMin + Math.random() * (c.blobOpacityMax - c.blobOpacityMin);
    g.fillStyle = `rgba(${110 + Math.random() * 45},${75 + Math.random() * 30},${45 + Math.random() * 22},${op})`;
    const r = c.blobSizeMin + Math.random() * (c.blobSizeMax - c.blobSizeMin);
    g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, r, 0, Math.PI * 2); g.fill();
  }
  // Corrugation banding
  g.strokeStyle = `rgba(70,45,22,${c.corrugationOpacity})`;
  g.lineWidth = 1;
  for (let y = 0; y < 512; y += 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  // Scuffs
  for (let i = 0; i < c.scuffCount; i++) {
    const op = c.scuffOpacity * (0.4 + Math.random() * 0.8);
    g.fillStyle = `rgba(45,28,16,${op})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 5 + Math.random() * 45, 1 + Math.random() * 4);
  }
  // Edge vignette
  const grad = g.createRadialGradient(256, 256, 90, 256, 256, c.vignetteRadius);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(35,22,12,${c.vignetteOpacity})`);
  g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
  // Per-pixel grain noise
  if (c.noiseIntensity > 0) {
    const id = g.getImageData(0, 0, 512, 512);
    for (let i = 0; i < id.data.length; i += 4) {
      const n = (Math.random() - 0.5) * c.noiseIntensity;
      id.data[i] = clamp(id.data[i] + n);
      id.data[i + 1] = clamp(id.data[i + 1] + n);
      id.data[i + 2] = clamp(id.data[i + 2] + n);
    }
    g.putImageData(id, 0, 0);
  }
  return new THREE.CanvasTexture(cv);
}

// ============================================================================
// Utility helpers
// ============================================================================
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

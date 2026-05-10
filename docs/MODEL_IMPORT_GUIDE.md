# box.ed — Model Import Quickstart

Everything you need to start dropping in 3D models, in order.

---

## 1. Project setup (one-time)

Your project should look like this:

```
your-project/
├── public/
│   └── models/              ← GLB files go here
├── src/
│   ├── box_ed_flow_prototype.jsx   ← updated, now imports modelLoader
│   └── modelLoader.js              ← new file, drop in alongside
└── package.json
```

The `modelLoader.js` file goes into `src/` alongside the main prototype file.
The `public/models/` folder doesn't exist yet — create it. (In CodeSandbox,
right-click in the file tree → New Folder, name it `public`. Then again inside
`public` → New Folder, name it `models`.)

---

## 2. Per-model workflow (every time you find a new prop)

### Step 1: Find the model
Sketchfab, Quaternius, etc. Filter for **GLB format** and **low-poly**.
Target: 500–2,000 triangles per item.

### Step 2: Compress it
Drop the `.glb` into [gltf.report](https://gltf.report). In the right panel,
click "Script" and paste:

```typescript
await document.transform(
  dedup(),
  prune(),
  weld(),
  textureCompress({ targetFormat: 'webp', resize: [256, 256] }),
);
```

Run, then export. Target file size: 100–300 KB.
(If still too big, see compression notes below.)

### Step 3: Set up dynamic label (optional, for editable text)
If you want users to write custom labels on this prop:
1. Open the GLB in Blender
2. Follow the steps in `blender_label_setup.md`
3. Re-export, re-compress

If you skip this, the prop will display whatever printed label the model came
with — fine for prototyping.

### Step 4: Drop into project
Save the final file to `public/models/<name>.glb`. The name needs to match
what's in `MODEL_PATHS` inside `modelLoader.js`:

| Item type    | Filename       |
|--------------|----------------|
| CD           | `cd.glb`       |
| Cassette     | `cassette.glb` |
| Floppy disk  | `floppy.glb`   |
| Photo print  | `photo.glb`    |
| Post-it      | `postit.glb`   |
| Manila folder| `manila.glb`   |
| Cardboard box| `box.glb`      |

### Step 5: Reload the app
That's it. The model loader will pick up the new file automatically.
Console will show `[modelLoader] loaded cd` (or whatever).

If you set up dynamic labels in step 3, marker text will appear on the named
mesh. If not, you'll see the model's built-in printed label.

---

## 3. How it actually works

When the app starts, `preloadModels()` runs. It tries to fetch each `.glb`
file in `MODEL_PATHS`. For each one:
- **Loads successfully** → cached in memory
- **Fails (file missing)** → silently skipped, console warning

Each maker function in `box_ed_flow_prototype.jsx` (makeCD, makeCassette, etc.)
asks the loader: *"do you have a model for this?"*
- **Yes** → clone it, apply marker label texture, return the clone
- **No** → use the procedural geometry fallback

This means:
- You can deploy the loader system before having any models
- You can add models one at a time without breaking anything
- You can test by adding/removing GLB files and reloading

---

## 4. Compression notes (advanced)

If a model is still too big after the basic compression script, try these in
order:

**Smaller textures.** Change `[256, 256]` to `[128, 128]`. Visible quality drop
on labels, but file size drops dramatically.

**JPEG instead of WebP.** Change `targetFormat: 'webp'` to `targetFormat: 'jpeg'`.
Slightly larger files but works in older browsers.

**Add Draco compression.** Add this to the script imports:
```typescript
import { draco } from '@gltf-transform/functions';
```
And add `draco({ method: 'edgebreaker' })` to the transform pipeline before
`textureCompress`. Saves 30–50% on geometry data.

**Simplify polygons.** If the model is high-poly:
```typescript
import { simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

// Add to pipeline:
simplify({
  simplifier: MeshoptSimplifier,
  ratio: 0.5,         // keep 50% of triangles
  error: 0.005,
  lockBorder: true,
}),
```

---

## 5. Troubleshooting

**"Model loaded but I don't see it in the scene."**
Check the console for the `[modelLoader] loaded X` message — confirms loading
worked. If it loaded but isn't visible, the model's scale is probably wrong.
Open the GLB in [gltf-viewer.donmccurdy.com](https://gltf-viewer.donmccurdy.com)
to see its size; you may need to scale it in Blender so it matches the
~0.4-unit size of procedural items.

**"Model shows but the marker label doesn't appear."**
Console will warn `[modelLoader] no mesh named "X_Label" found`. Means the
mesh in your GLB isn't named what the code expects. Either rename in Blender
(see `blender_label_setup.md`) or change the name in the `applyLabelToMesh`
call in the maker function.

**"The model is HUGE in the scene."**
Scale it down in Blender (select model, `S` key, type `0.1` for 10% size,
Enter). Re-export. Or scale it at runtime by editing the maker function:
```js
const model = getModel('cd');
if (model) {
  model.scale.setScalar(0.1);  // shrink to 10%
  // ... rest of the function
}
```

**"The model is rotated wrong."**
Rotate in Blender (select model, `R` then `X`/`Y`/`Z`, type degrees, Enter).
Or rotate at runtime: `model.rotation.x = Math.PI / 2;`

---

## 6. Files in this project

- `box_ed_flow_prototype.jsx` — main app, now imports the loader
- `modelLoader.js` — the loading system (new file)
- `blender_label_setup.md` — Blender steps for editable labels
- `PropVisualizer.jsx` — separate sandbox for tweaking procedural code
- This file — overview of how it all fits together

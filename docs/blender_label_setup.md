# box.ed — Blender label-mesh setup

A focused walkthrough for adding a dynamic-label material slot to imported GLB
models. You're not modeling anything — just doing light surgery so the label
area becomes a separately-named mesh that your code can target at runtime.

---

## Setup (one-time, ~10 min)

### 1. Install Blender
Download from blender.org. It's free. About 300 MB. Latest stable version is
fine — anything 4.0+ works for this workflow.

### 2. Get oriented (~5 min once installed)
When Blender opens, you'll see a 3D viewport with a default cube. Don't worry
about the toolbars — for our workflow you only need to know:

- **Mouse wheel** → zoom
- **Middle-click drag** → orbit
- **Shift + middle-click drag** → pan
- **Numpad keys** (or `View` menu) → snap to specific angles (1=front, 3=side, 7=top)
- **Tab** → toggle between Object Mode and Edit Mode (huge — Edit Mode is where
  face selection lives)

Try this with the default cube: click it, press Tab, click a face, see it
highlight. Press Tab to go back. That's 80% of what you'll be doing.

### 3. Delete the default cube
Click the cube, press `X`, click "Delete". Empty scene now.

---

## The actual workflow (per model, ~5-10 min once practiced)

### Step 1: Import the GLB
**File → Import → glTF 2.0 (.glb/.gltf)** → pick your model.

It appears in the viewport. Sometimes very small, sometimes huge — scroll to
zoom until you can see it. Orbit (middle-click drag) until you find the face
where the label belongs.

### Step 2: Find the existing material slot for the label area
In the right sidebar, click the model in the **Outliner** (top-right panel).
Then in the **Properties panel** (bottom-right), click the red sphere icon
("Material Properties").

You'll see a list of materials this model uses. For your VHS, there's likely
just one called "material". Note this — you'll be splitting one face off
of it.

### Step 3: Enter Edit Mode and select the label face
1. Make sure your model is selected (click it, it should outline orange)
2. Press **Tab** → enters Edit Mode
3. Press **3** (the regular 3, not numpad) → switches to Face select mode
   (the third icon in the top-left toolbar)
4. Click the face where the label should go. It highlights orange.

If the label area is multiple connected polygons (most models will have it as
a single quad face but some have it subdivided), hold **Shift** and click
additional faces to add them to your selection.

**Tip:** If you can't find the face because the label is on a curved surface
or wraps around, press **Z** to toggle wireframe view — it's easier to see
mesh structure that way.

### Step 4: Create a new material for the label
With your face(s) still selected:
1. In the **Material Properties** panel (right side), click the **+** icon
   to add a new material slot
2. With the new (empty) slot selected, click **+ New** to create a fresh material
3. Click on the material name to rename it — call it `LabelMaterial` (or
   anything descriptive)
4. Below, the material properties show. Find **Base Color**, set it to **white**.
   This is what gets replaced at runtime by your marker-scrawl texture.
5. Click the **Assign** button (just above the material list). This applies
   the new material to your selected face(s).

### Step 5: Separate the label face into its own mesh object
This is the critical step that makes your code able to find the label.

With the face still selected:
1. Press **P** (capital or lowercase, both work) → "Separate" menu pops up
2. Choose **Selection**

The label face is now a separate object. Switch back to Object Mode
(**Tab**) and look at the Outliner — you'll see two objects now, e.g.
"VHS" and "VHS.001".

### Step 6: Rename the separated mesh
In the Outliner:
1. Double-click the new object's name (the `.001` one)
2. Type the exact name your code will look for. Following the convention from
   the integration patches:
   - For a VHS: `VHS_Label`
   - For a CD: `CD_Face`
   - For a cassette: `Cassette_Label`
   - For a floppy: `Floppy_Label`
   - For a photo: `Photo_Front`
   - For a post-it: `PostIt_Top`
   - For a manila folder: `Manila_Sticky`

   The name has to match exactly what your `applyLabelToMesh()` call uses.
   Case-sensitive. No spaces.

### Step 7: Export back to GLB
**File → Export → glTF 2.0 (.glb/.gltf)**

In the export dialog (right side):
- **Format**: glTF Binary (.glb)
- **Include**: keep "Selected Objects" UNCHECKED (you want everything exported)
- **Transform** → leave defaults
- **Geometry** → leave defaults
- **Materials** → leave defaults

Click **Export glTF 2.0**. Save with the same filename as the original.

### Step 8: Re-compress with gltf.report
Your re-exported file will likely be larger than the optimized version you
downloaded. Drop it back into gltf.report and run the same compression
script you used before. The end result should be roughly the same size as
before plus maybe 5-10 KB for the extra material slot.

### Step 9: Test in your project
Drop the file into `/public/models/vhs.glb`. In your `box_ed_flow_prototype.jsx`,
the `makeVHS` function (or whatever you call it) does:

```js
const model = getModel('vhs');
if (model) {
  const labelTex = makeCassetteLabelTexture(title); // or your VHS-specific label maker
  applyLabelToMesh(model, 'VHS_Label', labelTex, { roughness: 0.85 });
  return model;
}
```

Reload the app. If the marker text appears on the label area, you're done.
If not, check the console — the loader logs `[modelLoader] no mesh named
"VHS_Label" found` when the name doesn't match. Open the GLB in
gltf-viewer.donmccurdy.com to inspect what mesh names it actually has.

---

## Common gotchas

**The label face is part of the body mesh, not a separate face.**
Some models bake the label into a single big quad that covers the whole front
of the object. In that case, before Step 3, you need to add edge loops to
isolate just the label area:
1. In Edit Mode, switch to Edge select mode (press **2**)
2. Press **Ctrl+R** → cuts a new edge loop where you click
3. Drag to position, click to confirm
4. Repeat to isolate the label area as its own face
5. Then go to Step 3.

**The label appears upside-down or rotated when you load it.**
This means the face's UV coordinates are flipped. In Edit Mode, with the face
selected, open the **UV Editor** (top-left, switch from "Layout" workspace
to "UV Editing"). You'll see how the texture maps to the face. Rotate or
flip the UV until it matches the orientation you want. This is fiddly the
first time but quick once you've done it once.

**The label material's color is wrong (e.g. tinted yellow).**
Your runtime texture has white pixels that get multiplied by the material's
base color. So if base color is yellow, white pixels become yellow. Set the
base color in Blender to pure white (255, 255, 255) and your runtime texture
will display its true colors.

**Re-export looks completely different from the original.**
Some Blender export defaults flatten transforms or strip data. If the
re-exported model looks broken, in the export dialog under "Transform" check
**+Y Up** and under "Geometry" check **Apply Modifiers**. These two cover
90% of "why does it look wrong" issues.

---

## What you've actually learned

After doing this once: select faces, create materials, separate objects,
rename, export. That's the core kit for this workflow. You can apply it to
any model going forward.

After doing it 3-4 times it becomes muscle memory and you'll spend more
time finding the right face than doing the actual mesh work.

If you ever need to do something more complex (e.g. the model needs the
label area to be a totally new mesh because it doesn't have one at all),
the "add a plane" pattern is: Object Mode → Add → Mesh → Plane → scale
and rotate to fit → set its parent to the main model → assign your
LabelMaterial → name it correctly. But for most existing models, the
"separate an existing face" pattern from Step 3-5 is enough.

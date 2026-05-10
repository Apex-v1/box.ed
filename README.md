# box.ed

A 3D web app where you fill virtual moving boxes with digital things — links to videos, songs, files, photos, games — represented as physical items like CDs, cassettes, floppy disks, and post-it notes.

> Status: prototype (v0.7). Items render, boxes open and close, you can add and edit items via a fake "BizBay" marketplace flow. Real backend (uploads, persistence, sharing) not yet wired up.

## What it is

Most digital storage is invisible. box.ed makes it physical. You buy a moving box from a knockoff Office Depot ("Office Biz"), it gets delivered to your floor, you click it to open it, and inside you arrange links and files as 3D items you can drag around, label with marker, and rearrange. Each item represents something digital — a YouTube video shows up as a CD with the video title scrawled on it, a PDF becomes a manila folder, a tweet becomes a sticky note.

## Run it locally

You need Node.js (v18 or newer). Then:

```bash
git clone https://github.com/YOUR_USERNAME/box-ed.git
cd box-ed
npm install
npm run dev
```

Vite will start a local server and print a URL (usually `http://localhost:5173`). Open it in your browser. Hot-reload is on, so edits save and reflect instantly.

## Deploy

[Vercel](https://vercel.com) auto-detects Vite projects and deploys with zero config. Push the repo, click "New Project" in Vercel, point at the repo, click Deploy. It runs `npm run build` (which produces `dist/`) and serves the static files. About 90 seconds end-to-end the first time.

## Project structure

```
box-ed/
├── public/
│   └── models/                       3D model files (.glb) — drop new ones in
├── src/
│   ├── main.jsx                      React entry point
│   ├── box_ed_flow_prototype.jsx     Main app — scene, UI, all logic
│   ├── modelLoader.js                GLB loader with procedural fallback
│   └── PropVisualizer.jsx            Standalone tool for tweaking props
├── docs/
│   ├── MODEL_IMPORT_GUIDE.md         How to add new 3D models
│   └── blender_label_setup.md        Editable label setup in Blender
├── index.html                        Vite entry HTML
├── vite.config.js
├── package.json
└── LICENSE                           MIT
```

## Adding new 3D models

box.ed uses procedural geometry by default (every item is built from primitives in code), but you can swap in real models from Sketchfab, Quaternius, etc. The model loader tries each registered file at startup and falls back to procedural if it's missing — so you can add models one at a time without breaking anything.

See [`docs/MODEL_IMPORT_GUIDE.md`](docs/MODEL_IMPORT_GUIDE.md) for the workflow.

## Editing procedural props

Run the standalone prop visualizer for live-tweaking the procedural geometry:

```bash
# Temporarily change main.jsx to render PropVisualizer instead of App
# (or set up a separate route — see PropVisualizer.jsx for details)
npm run dev
```

The visualizer gives you ~20 sliders per prop (CD radius, cassette label tilt, photo border thickness, etc.) and shows the result in real-time. Tune values until you like them, then update the defaults in `box_ed_flow_prototype.jsx`.

## Tech stack

- **React 18** for UI and state management
- **Three.js** for 3D scene rendering (vanilla, not react-three-fiber — the prototype uses imperative Three.js for finer control over the scene graph)
- **Vite** for the build and dev server
- **Procedural canvas textures** for cardboard, marker scrawls, and item surfaces — all generated at runtime from JS so labels can be dynamic

No backend yet. State lives in React; nothing persists across page reloads.

## What's working

- Floor scene with multiple boxes, drag-to-move with mass-based physics
- Buy a new box from "Office Biz" → it gets delivered to the floor
- Click a box to open it (orthographic isometric camera)
- Six item types: CD, cassette, floppy, photo, post-it, manila folder
- Right-click items for edit/delete menu
- Drag items with cursor-velocity-driven dangle physics
- Click box body to set/edit the side label
- Add new items via "BizBay" (eBay knockoff) with mock URL scraping
- Close box → flaps fold inward + tape strip animation → return to floor
- Per-box state (each box owns its own items and label)

## What's not working yet

- No real persistence (localStorage UUID + Upstash planned)
- No real OG-tag scraping (mock responses only)
- No file uploads (Vercel Blob planned)
- No sharing / view-only mode
- No mobile / touch optimization pass
- Cardboard box itself is procedural-only (item models can be swapped in)

## Contributing

Currently solo project. If you've stumbled across this and want to play with it, fork freely. The MIT license covers the code; the "box.ed" name and any branding are not licensed for derivative works.

## License

[MIT](LICENSE)

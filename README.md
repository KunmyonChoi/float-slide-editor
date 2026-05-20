# Float Slide Editor

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

A browser-based slide editor that converts HTML presentations into flat, absolutely-positioned elements for pixel-perfect editing and multi-format export including PowerPoint (PPTX).

![Float Slide Editor](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)

## Features

### Slide Editing
- **HTML Slide Import** — Load any HTML slide deck (reveal.js, scroll-snap, custom) and auto-convert to editable elements
- **Flat Editing Mode** — Edit slides as absolutely-positioned elements with precise coordinate control
- **Inline Text Editing** — Double-click text or shapes to edit with rich formatting
- **Multi-Select & Alignment** — Shift-click, marquee selection, snap guides, alignment & distribution tools
- **Shape Tools** — Rectangle, circle, lines (horizontal/vertical) with rotation support
- **Background Editor** — Multi-layer background editing (solid, gradient, image) per slide
- **Page Management** — Add, delete, reorder pages directly in flat mode

### PowerPoint Export
- **High-fidelity PPTX** — Python backend (python-pptx) for accurate export with ~95% pixel match
- **Font Embedding** — Google Fonts auto-download, WOFF2-to-TTF conversion, variable font instantiation, glyph subsetting
- **Master Slide Background** — Common backgrounds set as slide master, per-slide overrides for cover pages
- **Partial Borders** — Individual border sides with different colors/thickness via connectors
- **Shadow & Gradient** — CSS box-shadow, text-shadow, linear/radial gradients mapped to OOXML
- **Theme Cleanup** — Removes default PowerPoint theme effects (shadows, fills) for clean output

### Media Support
- **Images** — Drag-and-drop, clipboard paste, file picker with auto-resize
- **Video** — YouTube/Vimeo embed URLs and local video files (IndexedDB storage)
- **Video Options** — Autoplay, loop, mute, hide controls (YouTube overlay suppression)
- **SVG** — Inline SVG rendering and PNG conversion for export

### Presentation Mode
- **Flat Presenter** — Full-screen slideshow from edited content
- **HTML Presenter** — Original HTML presentation with native transitions
- **Navigation** — Keyboard (arrows, PageUp/Down, Space), mouse wheel, click zones
- **Video Playback** — Interactive video controls during presentation

### Project Management
- **Project Save/Load** — `.flatproj` ZIP packages (JSON + media files)
- **IndexedDB BlobStore** — Large media files stored in browser, lightweight references in project data
- **Multi-Format Export** — HTML, PNG, PPTX, JSON (single page or all pages)
- **Comparison Pipeline** — Automated pixel comparison between flat rendering and PPTX output

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Bold toggle |
| `Ctrl+I` | Italic toggle |
| `Ctrl+U` | Underline toggle |
| `Ctrl+Shift+>` | Increase font size |
| `Ctrl+Shift+<` | Decrease font size |
| `Ctrl+C/X/V` | Copy / Cut / Paste |
| `Ctrl+D` | Duplicate |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+A` | Select all |
| `Ctrl+]/[` | Z-order forward / backward |
| `Ctrl+Shift+]/[` | Z-order front / back |
| `Arrow keys` | Move element (1px, +Shift: 10px) |
| `Enter` | Edit text / shape |
| `Delete` | Delete selected |
| `F5` | Presentation mode |
| `Escape` | Cancel / Deselect / Exit |

## Getting Started

### Frontend

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

### PPTX Backend (Optional)

The Python backend enables high-quality PowerPoint export with font embedding.

```bash
cd pptx-server

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start server
uvicorn server:app --host 127.0.0.1 --port 8321
```

The frontend automatically detects the backend and falls back to client-side pptxgenjs export if unavailable.

### Quality Comparison Pipeline

Automated pixel comparison between flat canvas rendering and PPTX output:

```bash
# Requires: dev server (port 5173) + PPTX backend (port 8321) + LibreOffice
node scripts/auto-compare.mjs /path/to/slides.html
node scripts/auto-compare.mjs /path/to/slides.html --slide 3  # specific slide
```

## Architecture

```
float-editor/
├── src/
│   ├── components/     # React UI (canvas, panels, toolbars, menus)
│   ├── core/           # Business logic
│   │   ├── FlatExtractor.js      # HTML→flat element conversion
│   │   ├── FlatExporter.js       # Flat→HTML export
│   │   ├── PptxBackendClient.js  # Python PPTX backend client
│   │   ├── BlobStore.js          # IndexedDB media storage
│   │   ├── ProjectSerializer.js  # .flatproj ZIP save/load
│   │   ├── ImageExporter.js      # PNG/JPEG export
│   │   └── SnapEngine.js         # Snap guides & alignment
│   ├── store/          # Zustand state management
│   │   ├── editorStore.js        # HTML editor state
│   │   └── flatStore.js          # Flat editor state + page management
│   └── test/           # Test suites
├── pptx-server/        # Python PPTX export backend
│   ├── server.py              # FastAPI endpoints
│   ├── exporter.py            # python-pptx slide builder
│   ├── font_embedder.py       # Font download, conversion, embedding
│   ├── text_runs.py           # HTML→text runs converter
│   └── gradient.py            # CSS gradient parser
├── scripts/
│   └── auto-compare.mjs       # Pixel comparison pipeline
└── package.json
```

### Key Concepts

| Concept | Description |
|---------|-------------|
| **FlatElement** | Absolute-positioned element with computed styles extracted from HTML |
| **FlatExtractor** | Walks iframe DOM, captures `getComputedStyle()`, handles flex parents, overlapping slides |
| **Background Layers** | Full-canvas shapes auto-detected and managed as slide backgrounds |
| **BlobStore** | IndexedDB wrapper for large media — elements reference `idb://key` |
| **Font Embedding** | Google Fonts CSS → full variable font download → weight instantiation → glyph subsetting → OOXML embedding |
| **Master Background** | Most common background set as slide master, per-slide overrides for different pages |

## Tech Stack

### Frontend
- **React 19** + **Vite 8**
- **Zustand** — State management
- **Tailwind CSS 4** — UI styling
- **pptxgenjs** — Client-side PPTX fallback
- **dom-to-image-more** — Image export
- **JSZip** — Project file packaging
- **Puppeteer** — Comparison pipeline screenshots
- **Vitest** — Testing

### Backend (PPTX Export)
- **Python 3.12** + **FastAPI** + **Uvicorn**
- **python-pptx** — OOXML PPTX generation
- **fontTools** — WOFF2 conversion, variable font instantiation, subsetting
- **CairoSVG** — SVG→PNG conversion
- **requests** — Google Fonts download

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

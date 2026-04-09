# Float Slide Editor

A browser-based slide editor that converts existing HTML presentations into flat, absolutely-positioned elements for pixel-perfect editing and multi-format export.

## Features

- **HTML Slide Import** - Load any HTML slide deck via iframe and extract elements with computed styles
- **Flat Editing Mode** - Edit slides as absolutely-positioned elements with precise coordinate control
- **Inline Text Editing** - Double-click to edit text with rich formatting (bold, italic, color, font)
- **Multi-Select & Alignment** - Shift-click or marquee selection, snap guides, alignment/distribution tools
- **Property Panel** - Visual controls for colors, gradients, shadows, borders, opacity, and more
- **Context Menu** - Right-click for copy/paste, z-order, lock/unlock, grouping
- **Advanced Editing** - Rotation, gradient fills, box/text shadows, image cropping, element locking
- **Multi-Format Export** - HTML, PPTX (PowerPoint), PNG/JPEG images, JSON, project save/load
- **Presentation Mode** - Full-screen slideshow from flat-edited content with keyboard navigation
- **Multi-Page Support** - Navigate and edit multiple slides, including async extraction of unvisited pages

## Tech Stack

- **React 19** + **Vite 8**
- **Zustand** for state management
- **Tailwind CSS 4** for UI styling
- **pptxgenjs** for PPTX export
- **dom-to-image-more** for image export
- **Vitest** for testing (837+ tests)

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## Architecture

```
src/
  components/   # React UI components (canvas, panels, toolbars, menus)
  core/         # Business logic (extraction, export, parsing, alignment)
  store/        # Zustand stores (editorStore, flatStore)
  test/         # Vitest test suites + fixtures
```

### Key Concepts

- **FlatElement** - Absolute-positioned element with computed styles extracted from source HTML
- **FlatExtractor** - Walks iframe DOM, captures `getComputedStyle()` for each element
- **FlatExporter** - Generates standalone HTML from flat elements
- **PptExporter** - Maps flat elements to pptxgenjs API calls (px-to-inch conversion)
- **StructuralAnalyzer** - Compares original vs flat HTML for quality regression testing

## Development Phases

This project was built incrementally across 8 phases:

1. **Inline Text Editing** - contentEditable integration with flat elements
2. **Copy/Paste & Z-Order** - Clipboard operations and layer management
3. **Property Panel** - Visual style editing controls
4. **Multi-Select** - Shift-click, marquee, and batch operations
5. **Snap & Alignment** - Smart guides, alignment, and distribution
6. **Context Menu** - Right-click menu with common operations
7. **Advanced Editing** - Rotation, gradients, shadows, cropping, locking
8. **Export & Save** - Multi-format export, project serialization, presentation mode

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

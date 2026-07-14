# Stellar Graph

An immersive Obsidian knowledge-graph view designed for exploration rather than decoration.

## Features

- Canvas-rendered force graph built for large vaults
- Live search across note names, folders, and tags
- Folder- or tag-based constellation colors
- One- and two-hop focus modes
- Shortest-path discovery between notes
- Interactive inspector with degree and tag details
- Drag, pan, zoom, fit, pin, and double-click navigation
- Responsive, dark observatory interface
- Settings for scale, link weight, motion, orphans, and clustering

## Install for development

```powershell
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/stellar-graph/
```

Then enable **Stellar Graph** under **Settings → Community plugins** and run **Open Stellar Graph** from the command palette.

## Interaction

- Drag empty space to pan.
- Scroll to zoom.
- Drag a star to pin it.
- Select a star to inspect it.
- Double-click a star to open the note.
- Choose **Path from here**, then select another star to reveal the shortest link path.

# Stellar Graph

Stellar Graph is an Obsidian community plugin that turns your vault links into a fast, searchable canvas graph. It is built for actual navigation: find notes, isolate neighborhoods, inspect clusters, and trace paths between ideas without leaving Obsidian.

## Features

- Canvas-rendered force graph for linked notes
- Live search across note names, folders, and tags
- Folder or tag color modes
- One-hop and two-hop focus modes
- Shortest-path discovery between notes
- Inspector with backlinks, outlinks, folder, tag, and degree details
- Drag, pan, zoom, fit, pin, and double-click note navigation
- Optional orphan-note visibility
- Settings for node scale, link opacity, graph motion, and color behavior

## Commands

Stellar Graph adds these Obsidian commands:

- `Open Stellar Graph`
- `Rebuild Stellar Graph`

## Manual Install

Download or build the plugin files, then copy these three files into your vault:

```text
<vault>/.obsidian/plugins/stellar-graph/main.js
<vault>/.obsidian/plugins/stellar-graph/manifest.json
<vault>/.obsidian/plugins/stellar-graph/styles.css
```

Enable the plugin in Obsidian:

1. Open `Settings`.
2. Go to `Community plugins`.
3. Turn off `Restricted mode` if needed.
4. Enable `Stellar Graph`.
5. Run `Open Stellar Graph` from the command palette.

## Development

Install dependencies:

```powershell
npm install
```

Build once:

```powershell
npm run build
```

Run the development build:

```powershell
npm run dev
```

## Interaction

- Drag empty canvas space to pan.
- Scroll to zoom.
- Use `Fit` to center the graph.
- Drag a note node to pin it.
- Select a node to inspect note details.
- Double-click a node to open the note.
- Choose `Path from here`, then select another node to reveal the shortest link path.

## Release Files

An Obsidian plugin release should include:

- `main.js`
- `manifest.json`
- `styles.css`

The packaged plugin archive for version `0.1.0` is generated as `stellar-graph-0.1.0.zip`.

## Status

Version `0.1.0` is an initial release. It targets Obsidian `1.5.0` and newer.

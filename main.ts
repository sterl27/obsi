import { App, ItemView, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, setIcon } from "obsidian";

const VIEW_TYPE = "stellar-graph-view";

interface StellarSettings {
  nodeScale: number;
  linkOpacity: number;
  motion: boolean;
  showOrphans: boolean;
  colorMode: "folder" | "tag";
}

const DEFAULT_SETTINGS: StellarSettings = {
  nodeScale: 1,
  linkOpacity: 0.24,
  motion: true,
  showOrphans: true,
  colorMode: "folder"
};

interface GraphNode {
  id: string;
  file: TFile;
  label: string;
  group: string;
  tags: string[];
  degree: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
}

interface GraphEdge { source: GraphNode; target: GraphNode; }
interface Transform { x: number; y: number; scale: number; }

class StellarGraphView extends ItemView {
  plugin: StellarGraphPlugin;
  canvas!: HTMLCanvasElement;
  ctx!: CanvasRenderingContext2D;
  nodes: GraphNode[] = [];
  edges: GraphEdge[] = [];
  filtered = new Set<string>();
  selected: GraphNode | null = null;
  hovered: GraphNode | null = null;
  transform: Transform = { x: 0, y: 0, scale: 1 };
  animation = 0;
  temperature = 1;
  query = "";
  focusDepth = 0;
  pathStart: GraphNode | null = null;
  path = new Set<string>();
  private dragNode: GraphNode | null = null;
  private panning = false;
  private pointer = { x: 0, y: 0 };
  private lastFrame = 0;
  private resizeObserver?: ResizeObserver;

  constructor(leaf: WorkspaceLeaf, plugin: StellarGraphPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Stellar Graph"; }
  getIcon(): string { return "orbit"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("stellar-graph-view");
    const shell = this.contentEl.createDiv("stellar-shell");
    this.buildHeader(shell);
    const stage = shell.createDiv("stellar-stage");
    this.canvas = stage.createEl("canvas", { cls: "stellar-canvas" });
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.ctx = context;
    this.buildHud(stage);
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(stage);
    await this.rebuild();
    this.resize();
    this.animation = requestAnimationFrame((time) => this.tick(time));
  }

  async onClose(): Promise<void> {
    cancelAnimationFrame(this.animation);
    this.resizeObserver?.disconnect();
  }

  private buildHeader(shell: HTMLElement): void {
    const header = shell.createDiv("stellar-header");
    const brand = header.createDiv("stellar-brand");
    brand.createSpan({ cls: "stellar-mark", text: "✦" });
    const brandText = brand.createDiv();
    brandText.createEl("strong", { text: "STELLAR" });
    brandText.createSpan({ text: "Knowledge observatory" });
    const searchWrap = header.createDiv("stellar-search");
    setIcon(searchWrap.createSpan(), "search");
    const search = searchWrap.createEl("input", { attr: { type: "search", placeholder: "Search the constellation…", "aria-label": "Search graph" } });
    search.addEventListener("input", () => { this.query = search.value.toLowerCase(); this.updateFilter(); });
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const match = this.nodes.find((node) => this.filtered.has(node.id));
        if (match) this.selectNode(match, true);
      }
    });
    const actions = header.createDiv("stellar-actions");
    this.iconButton(actions, "refresh-cw", "Rebuild graph", () => void this.rebuild());
    this.iconButton(actions, "scan", "Fit graph", () => this.fitGraph());
    this.iconButton(actions, "settings-2", "Graph settings", () => {
      (this.app as App & { setting: { open(): void; openTabById(id: string): void } }).setting.open();
      (this.app as App & { setting: { open(): void; openTabById(id: string): void } }).setting.openTabById(this.plugin.manifest.id);
    });
  }

  private buildHud(stage: HTMLElement): void {
    const rail = stage.createDiv("stellar-rail");
    this.iconButton(rail, "plus", "Zoom in", () => this.zoomAt(1.25));
    this.iconButton(rail, "minus", "Zoom out", () => this.zoomAt(0.8));
    this.iconButton(rail, "maximize-2", "Fit graph", () => this.fitGraph());
    this.iconButton(rail, "locate-fixed", "Focus neighbors", () => { this.focusDepth = (this.focusDepth + 1) % 3; this.updateFilter(); });
    this.iconButton(rail, "route", "Find path from selected note", () => {
      this.path.clear();
      if (this.selected) { this.pathStart = this.selected; new Notice("Select a destination note"); }
      else new Notice("Select a starting note first");
    });

    const legend = stage.createDiv("stellar-legend");
    legend.createEl("div", { cls: "stellar-eyebrow", text: "LIVE VAULT" });
    const stats = legend.createDiv("stellar-stats");
    stats.createSpan({ cls: "stellar-node-count", text: "0 notes" });
    stats.createSpan({ cls: "stellar-edge-count", text: "0 links" });
    legend.createEl("div", { cls: "stellar-hint", text: "Drag to orbit · Scroll to zoom · Double-click to open" });

    const inspector = stage.createDiv("stellar-inspector");
    inspector.createDiv("stellar-inspector-empty").setText("Select a star to inspect its connections");
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, handler: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "stellar-icon-button", attr: { "aria-label": label } });
    setIcon(button, icon);
    button.addEventListener("click", handler);
    return button;
  }

  async rebuild(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const nodeByPath = new Map<string, GraphNode>();
    this.nodes = files.map((file, index) => {
      const cache = this.app.metadataCache.getFileCache(file);
      const tags = (cache?.tags ?? []).map((tag) => tag.tag);
      const folder = file.parent?.path || "Vault root";
      const angle = index * 2.399963;
      const radius = 40 + Math.sqrt(index) * 24;
      const node: GraphNode = { id: file.path, file, label: file.basename, group: this.plugin.settings.colorMode === "tag" ? (tags[0] ?? "untagged") : folder, tags, degree: 0, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0, pinned: false };
      nodeByPath.set(file.path, node);
      return node;
    });
    const edgeKeys = new Set<string>();
    this.edges = [];
    for (const source of this.nodes) {
      const links = this.app.metadataCache.resolvedLinks[source.file.path] ?? {};
      for (const targetPath of Object.keys(links)) {
        const target = nodeByPath.get(targetPath);
        if (!target || target === source) continue;
        const key = [source.id, target.id].sort().join("\u0000");
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        source.degree++;
        target.degree++;
        this.edges.push({ source, target });
      }
    }
    this.temperature = 1;
    this.selected = null;
    this.path.clear();
    this.updateFilter();
    this.updateStats();
    requestAnimationFrame(() => this.fitGraph());
  }

  private updateStats(): void {
    this.contentEl.querySelector(".stellar-node-count")?.setText(`${this.nodes.length} notes`);
    this.contentEl.querySelector(".stellar-edge-count")?.setText(`${this.edges.length} links`);
  }

  updateFilter(): void {
    let allowed = new Set(this.nodes.filter((node) => !this.query || `${node.label} ${node.group} ${node.tags.join(" ")}`.toLowerCase().includes(this.query)).map((node) => node.id));
    if (!this.plugin.settings.showOrphans) allowed = new Set([...allowed].filter((id) => (this.nodes.find((node) => node.id === id)?.degree ?? 0) > 0));
    if (this.selected && this.focusDepth > 0) {
      const neighborhood = this.neighborhood(this.selected, this.focusDepth);
      allowed = new Set([...allowed].filter((id) => neighborhood.has(id)));
    }
    this.filtered = allowed;
  }

  private neighborhood(start: GraphNode, depth: number): Set<string> {
    const found = new Set<string>([start.id]);
    let frontier = [start];
    for (let i = 0; i < depth; i++) {
      const next: GraphNode[] = [];
      for (const node of frontier) for (const edge of this.edges) {
        const neighbor = edge.source === node ? edge.target : edge.target === node ? edge.source : null;
        if (neighbor && !found.has(neighbor.id)) { found.add(neighbor.id); next.push(neighbor); }
      }
      frontier = next;
    }
    return found;
  }

  private tick(time: number): void {
    const delta = Math.min(32, time - this.lastFrame || 16) / 16;
    this.lastFrame = time;
    if (this.plugin.settings.motion && this.temperature > 0.003) this.simulate(delta);
    this.draw(time);
    this.animation = requestAnimationFrame((next) => this.tick(next));
  }

  private simulate(delta: number): void {
    const active = this.nodes.filter((node) => this.filtered.has(node.id));
    const sampleStep = Math.max(1, Math.floor(active.length / 260));
    for (let i = 0; i < active.length; i++) {
      const a = active[i];
      if (!a.pinned) { a.vx += -a.x * 0.00022 * delta; a.vy += -a.y * 0.00022 * delta; }
      for (let j = i + 1; j < active.length; j += sampleStep) {
        const b = active[j];
        let dx = b.x - a.x; let dy = b.y - a.y;
        const distance2 = Math.max(80, dx * dx + dy * dy);
        const force = (110 / distance2) * this.temperature * delta;
        dx *= force; dy *= force;
        if (!a.pinned) { a.vx -= dx; a.vy -= dy; }
        if (!b.pinned) { b.vx += dx; b.vy += dy; }
      }
    }
    for (const edge of this.edges) {
      if (!this.filtered.has(edge.source.id) || !this.filtered.has(edge.target.id)) continue;
      const dx = edge.target.x - edge.source.x; const dy = edge.target.y - edge.source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = (distance - 90) * 0.0018 * this.temperature * delta;
      const fx = dx / distance * force; const fy = dy / distance * force;
      if (!edge.source.pinned) { edge.source.vx += fx; edge.source.vy += fy; }
      if (!edge.target.pinned) { edge.target.vx -= fx; edge.target.vy -= fy; }
    }
    for (const node of active) if (!node.pinned) {
      node.vx *= 0.88; node.vy *= 0.88;
      node.x += node.vx * delta; node.y += node.vy * delta;
    }
    this.temperature *= 0.992;
  }

  private draw(time: number): void {
    const width = this.canvas.clientWidth; const height = this.canvas.clientHeight;
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.save();
    this.ctx.translate(width / 2 + this.transform.x, height / 2 + this.transform.y);
    this.ctx.scale(this.transform.scale, this.transform.scale);
    this.drawGrid(width, height);
    for (const edge of this.edges) {
      if (!this.filtered.has(edge.source.id) || !this.filtered.has(edge.target.id)) continue;
      const onPath = this.path.has(edge.source.id) && this.path.has(edge.target.id);
      const emphasized = onPath || edge.source === this.selected || edge.target === this.selected;
      this.ctx.beginPath(); this.ctx.moveTo(edge.source.x, edge.source.y); this.ctx.lineTo(edge.target.x, edge.target.y);
      this.ctx.strokeStyle = emphasized ? "rgba(132, 236, 255, .78)" : `rgba(129, 148, 183, ${this.plugin.settings.linkOpacity})`;
      this.ctx.lineWidth = emphasized ? 1.8 / this.transform.scale : 0.7 / this.transform.scale;
      this.ctx.stroke();
    }
    const visible = this.nodes.filter((node) => this.filtered.has(node.id));
    visible.sort((a, b) => a.degree - b.degree);
    for (const node of visible) this.drawNode(node, time);
    this.ctx.restore();
  }

  private drawGrid(width: number, height: number): void {
    const spacing = 80;
    const left = (-width / 2 - this.transform.x) / this.transform.scale;
    const top = (-height / 2 - this.transform.y) / this.transform.scale;
    const right = left + width / this.transform.scale;
    const bottom = top + height / this.transform.scale;
    this.ctx.lineWidth = 0.5 / this.transform.scale;
    this.ctx.strokeStyle = "rgba(104, 134, 174, .055)";
    for (let x = Math.floor(left / spacing) * spacing; x < right; x += spacing) { this.ctx.beginPath(); this.ctx.moveTo(x, top); this.ctx.lineTo(x, bottom); this.ctx.stroke(); }
    for (let y = Math.floor(top / spacing) * spacing; y < bottom; y += spacing) { this.ctx.beginPath(); this.ctx.moveTo(left, y); this.ctx.lineTo(right, y); this.ctx.stroke(); }
  }

  private drawNode(node: GraphNode, time: number): void {
    const selected = node === this.selected; const hovered = node === this.hovered; const onPath = this.path.has(node.id);
    const radius = (3.5 + Math.sqrt(node.degree + 1) * 1.75) * this.plugin.settings.nodeScale;
    const color = this.colorFor(node.group);
    if (selected || hovered || onPath) {
      const pulse = 1 + Math.sin(time / 260) * 0.12;
      this.ctx.beginPath(); this.ctx.arc(node.x, node.y, radius * 2.7 * pulse, 0, Math.PI * 2);
      const glow = this.ctx.createRadialGradient(node.x, node.y, radius, node.x, node.y, radius * 2.8);
      glow.addColorStop(0, color.replace("1)", ".38)")); glow.addColorStop(1, "rgba(0,0,0,0)");
      this.ctx.fillStyle = glow; this.ctx.fill();
    }
    this.ctx.beginPath(); this.ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = selected ? "#f8fbff" : color; this.ctx.fill();
    if (radius * this.transform.scale > 4.5 || selected || hovered) {
      this.ctx.font = `${selected ? 600 : 500} ${Math.max(9, 11 / this.transform.scale)}px ui-sans-serif, system-ui`;
      this.ctx.fillStyle = selected ? "#ffffff" : "rgba(226,235,250,.82)";
      this.ctx.textAlign = "center"; this.ctx.textBaseline = "top";
      this.ctx.fillText(node.label, node.x, node.y + radius + 5 / this.transform.scale);
    }
  }

  private colorFor(group: string): string {
    let hash = 0;
    for (let i = 0; i < group.length; i++) hash = group.charCodeAt(i) + ((hash << 5) - hash);
    const hue = ((hash % 360) + 360) % 360;
    return `hsla(${hue}, 82%, 68%, 1)`;
  }

  private bindEvents(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.canvas.setPointerCapture(event.pointerId);
      this.pointer = { x: event.clientX, y: event.clientY };
      const node = this.hitTest(event.offsetX, event.offsetY);
      if (node) { this.dragNode = node; node.pinned = true; this.selectNode(node, false); }
      else this.panning = true;
    });
    this.canvas.addEventListener("pointermove", (event) => {
      const dx = event.clientX - this.pointer.x; const dy = event.clientY - this.pointer.y;
      this.pointer = { x: event.clientX, y: event.clientY };
      if (this.dragNode) { this.dragNode.x += dx / this.transform.scale; this.dragNode.y += dy / this.transform.scale; this.temperature = Math.max(this.temperature, 0.18); }
      else if (this.panning) { this.transform.x += dx; this.transform.y += dy; }
      else this.hovered = this.hitTest(event.offsetX, event.offsetY);
      this.canvas.style.cursor = this.dragNode ? "grabbing" : this.hovered ? "pointer" : this.panning ? "grabbing" : "grab";
    });
    this.canvas.addEventListener("pointerup", () => { this.dragNode = null; this.panning = false; });
    this.canvas.addEventListener("dblclick", (event) => { const node = this.hitTest(event.offsetX, event.offsetY); if (node) void this.app.workspace.getLeaf(false).openFile(node.file); });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0012);
      const before = this.screenToWorld(event.offsetX, event.offsetY);
      this.transform.scale = Math.min(5, Math.max(0.12, this.transform.scale * factor));
      const after = this.screenToWorld(event.offsetX, event.offsetY);
      this.transform.x += (after.x - before.x) * this.transform.scale;
      this.transform.y += (after.y - before.y) * this.transform.scale;
    }, { passive: false });
  }

  private selectNode(node: GraphNode, center: boolean): void {
    if (this.pathStart && this.pathStart !== node) { this.path = this.shortestPath(this.pathStart, node); this.pathStart = null; }
    else if (this.pathStart === null && this.path.size === 0) { /* normal selection */ }
    this.selected = node;
    if (center) { this.transform.x = -node.x * this.transform.scale; this.transform.y = -node.y * this.transform.scale; }
    this.updateFilter();
    this.renderInspector(node);
  }

  private renderInspector(node: GraphNode): void {
    const panel = this.contentEl.querySelector<HTMLElement>(".stellar-inspector");
    if (!panel) return;
    panel.empty();
    panel.createEl("div", { cls: "stellar-eyebrow", text: node.group });
    panel.createEl("h2", { text: node.label });
    const metrics = panel.createDiv("stellar-metrics");
    metrics.createDiv().createEl("strong", { text: String(node.degree) });
    metrics.lastElementChild?.createSpan({ text: "connections" });
    metrics.createDiv().createEl("strong", { text: String(node.tags.length) });
    metrics.lastElementChild?.createSpan({ text: "tags" });
    if (node.tags.length) panel.createDiv("stellar-tags").setText(node.tags.join("  "));
    const buttons = panel.createDiv("stellar-inspector-actions");
    const open = buttons.createEl("button", { text: "Open note", cls: "mod-cta" });
    open.addEventListener("click", () => void this.app.workspace.getLeaf(false).openFile(node.file));
    const path = buttons.createEl("button", { text: "Path from here" });
    path.addEventListener("click", () => { this.pathStart = node; this.path.clear(); new Notice("Now select a destination note"); });
  }

  private shortestPath(start: GraphNode, end: GraphNode): Set<string> {
    const queue = [start]; const previous = new Map<string, string | null>([[start.id, null]]);
    while (queue.length) {
      const current = queue.shift()!;
      if (current === end) break;
      for (const edge of this.edges) {
        const next = edge.source === current ? edge.target : edge.target === current ? edge.source : null;
        if (next && !previous.has(next.id)) { previous.set(next.id, current.id); queue.push(next); }
      }
    }
    if (!previous.has(end.id)) { new Notice("No link path found"); return new Set(); }
    const result = new Set<string>(); let cursor: string | null = end.id;
    while (cursor) { result.add(cursor); cursor = previous.get(cursor) ?? null; }
    return result;
  }

  private hitTest(x: number, y: number): GraphNode | null {
    const point = this.screenToWorld(x, y);
    let winner: GraphNode | null = null; let distance = Infinity;
    for (const node of this.nodes) if (this.filtered.has(node.id)) {
      const radius = (7 + Math.sqrt(node.degree + 1) * 2) * this.plugin.settings.nodeScale / Math.sqrt(this.transform.scale);
      const next = Math.hypot(node.x - point.x, node.y - point.y);
      if (next < radius && next < distance) { winner = node; distance = next; }
    }
    return winner;
  }

  private screenToWorld(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.canvas.clientWidth / 2 - this.transform.x) / this.transform.scale, y: (y - this.canvas.clientHeight / 2 - this.transform.y) / this.transform.scale };
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(rect.width * dpr); this.canvas.height = Math.floor(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private fitGraph(): void {
    const active = this.nodes.filter((node) => this.filtered.has(node.id));
    if (!active.length) return;
    const xs = active.map((node) => node.x); const ys = active.map((node) => node.y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
    this.transform.scale = Math.min(2.2, Math.max(0.15, Math.min(this.canvas.clientWidth / Math.max(180, maxX - minX + 120), this.canvas.clientHeight / Math.max(180, maxY - minY + 120))));
    this.transform.x = -(minX + maxX) / 2 * this.transform.scale;
    this.transform.y = -(minY + maxY) / 2 * this.transform.scale;
  }

  private zoomAt(factor: number): void { this.transform.scale = Math.min(5, Math.max(0.12, this.transform.scale * factor)); }
}

class StellarSettingTab extends PluginSettingTab {
  plugin: StellarGraphPlugin;
  constructor(app: App, plugin: StellarGraphPlugin) { super(app, plugin); this.plugin = plugin; }
  display(): void {
    const { containerEl } = this; containerEl.empty();
    containerEl.createEl("h2", { text: "Stellar Graph" });
    new Setting(containerEl).setName("Node scale").setDesc("Scale stars and hubs.").addSlider((slider) => slider.setLimits(0.6, 2, 0.1).setValue(this.plugin.settings.nodeScale).setDynamicTooltip().onChange(async (value) => { this.plugin.settings.nodeScale = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Link opacity").setDesc("Control the visual weight of connections.").addSlider((slider) => slider.setLimits(0.05, 0.8, 0.05).setValue(this.plugin.settings.linkOpacity).setDynamicTooltip().onChange(async (value) => { this.plugin.settings.linkOpacity = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Living layout").setDesc("Animate the force-directed layout as the graph settles.").addToggle((toggle) => toggle.setValue(this.plugin.settings.motion).onChange(async (value) => { this.plugin.settings.motion = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Show orphan notes").setDesc("Include notes with no resolved links.").addToggle((toggle) => toggle.setValue(this.plugin.settings.showOrphans).onChange(async (value) => { this.plugin.settings.showOrphans = value; await this.plugin.saveSettings(); this.plugin.refreshViews(); }));
    new Setting(containerEl).setName("Cluster colors").setDesc("Color stars by their folder or first tag.").addDropdown((dropdown) => dropdown.addOption("folder", "Folder").addOption("tag", "First tag").setValue(this.plugin.settings.colorMode).onChange(async (value: "folder" | "tag") => { this.plugin.settings.colorMode = value; await this.plugin.saveSettings(); this.plugin.refreshViews(true); }));
  }
}

export default class StellarGraphPlugin extends Plugin {
  settings: StellarSettings = DEFAULT_SETTINGS;
  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new StellarGraphView(leaf, this));
    this.addRibbonIcon("orbit", "Open Stellar Graph", () => void this.activateView());
    this.addCommand({ id: "open-stellar-graph", name: "Open Stellar Graph", callback: () => void this.activateView() });
    this.addCommand({ id: "rebuild-stellar-graph", name: "Rebuild Stellar Graph", callback: () => this.refreshViews(true) });
    this.addSettingTab(new StellarSettingTab(this.app, this));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.refreshViews(true)));
  }
  onunload(): void { this.app.workspace.detachLeavesOfType(VIEW_TYPE); }
  async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf("tab"); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    this.app.workspace.revealLeaf(leaf);
  }
  refreshViews(rebuild = false): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof StellarGraphView) { if (rebuild) void view.rebuild(); else view.updateFilter(); }
    }
  }
  async loadSettings(): Promise<void> { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<StellarSettings> | null); }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}

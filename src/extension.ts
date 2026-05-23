import * as vscode from "vscode";
import { TypingEngine } from "./engine";
import { parseLinesmith } from "./parser";
import { LinesmithPanel, PanelHostMessage, PanelState } from "./panel";
import { StatusBar } from "./statusBar";
import { Chunk, PlaybackSpec, PlaybackStatus, SessionSettings } from "./types";

const LANGUAGE_ID = "linesmith";
const FILE_EXT = ".linesmith";

const SEED_SCRIPT = `# new linesmith script — chunks separated by --- on its own line
# add @note lines at the top of a chunk to show talking points in the panel

@note Talking point for this chunk — shown in the panel, never typed

console.log("hello, world");

---

// chunk 2 starts here
`;

class LinesmithController {
  private engine = new TypingEngine();
  private statusBar = new StatusBar();
  private settings: SessionSettings;
  private targetUri: vscode.Uri | null = null;
  private scriptUri: vscode.Uri | null = null;
  private chunks: Chunk[] = [];
  private playingChunkIndex: number | null = null;
  private countdown: { chunkIndex: number; secondsLeft: number } | null = null;
  private countdownAbort: AbortController | null = null;
  private output = vscode.window.createOutputChannel("Linesmith");

  constructor(private context: vscode.ExtensionContext) {
    this.settings = this.loadSettings();
    let lastStatus: PlaybackStatus | null = null;
    this.engine.onProgress((update) => {
      this.statusBar.update(update);
      LinesmithPanel.getCurrent()?.setProgress(update);
      if (update.status !== lastStatus) {
        lastStatus = update.status;
        if (update.status === "idle" || update.status === "cancelled") {
          this.playingChunkIndex = null;
        }
        this.pushState();
      }
    });
  }

  register(): void {
    this.context.subscriptions.push(
      this.statusBar,
      this.output,
      vscode.window.onDidChangeActiveTextEditor((editor) => this.onActiveEditorChanged(editor)),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.scriptUri && event.document.uri.toString() === this.scriptUri.toString()) {
          this.refreshChunks();
        }
      }),
      vscode.commands.registerCommand("linesmith.openPanel", () => this.openPanel()),
      vscode.commands.registerCommand("linesmith.detachPanel", () => this.detachPanel()),
      vscode.commands.registerCommand("linesmith.newScript", () => this.newScript()),
      vscode.commands.registerCommand("linesmith.playNext", () => this.playNext()),
      vscode.commands.registerCommand("linesmith.playClipboard", () => this.playClipboard()),
      vscode.commands.registerCommand("linesmith.pauseResume", () => this.pauseResume()),
      vscode.commands.registerCommand("linesmith.stop", () => this.stop()),
      vscode.commands.registerCommand("linesmith.reset", () => this.reset())
    );
    this.onActiveEditorChanged(vscode.window.activeTextEditor);
  }

  private loadSettings(): SessionSettings {
    const config = vscode.workspace.getConfiguration("linesmith");
    return {
      mode: config.get<SessionSettings["mode"]>("defaultMode", "char"),
      wpm: config.get<number>("defaultWpm", 80),
      jitter: config.get<boolean>("defaultJitter", true),
      lineDelayMs: config.get<number>("defaultLineDelayMs", 120),
      countdownSeconds: config.get<number>("defaultCountdown", 0),
    };
  }

  private isScriptDoc(doc: vscode.TextDocument): boolean {
    return doc.languageId === LANGUAGE_ID || doc.fileName.endsWith(FILE_EXT);
  }

  private onActiveEditorChanged(editor: vscode.TextEditor | undefined): void {
    if (!editor) return;
    if (this.isScriptDoc(editor.document)) {
      this.scriptUri = editor.document.uri;
      this.refreshChunks();
    } else {
      this.targetUri = editor.document.uri;
      this.pushState();
    }
  }

  private findScriptDoc(): vscode.TextDocument | null {
    if (!this.scriptUri) return null;
    return vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.scriptUri!.toString()) ?? null;
  }

  private refreshChunks(): void {
    const doc = this.findScriptDoc();
    if (!doc) {
      this.chunks = [];
      this.pushState();
      return;
    }
    const text = doc.getText();
    const fresh = parseLinesmith(text);
    const previousPlayed = new Map(this.chunks.map((c) => [c.index, c.played]));
    this.chunks = fresh.map((c) => ({ ...c, played: previousPlayed.get(c.index) ?? false }));
    if (this.chunks.length > 0 && this.chunks.every((c) => c.played)) {
      this.chunks = this.chunks.map((c) => ({ ...c, played: false }));
    }
    this.pushState();
  }

  private pushState(): void {
    const panel = LinesmithPanel.getCurrent();
    if (!panel) return;
    const state: PanelState = {
      chunks: this.chunks,
      scriptPath: this.scriptUri ? this.relPath(this.scriptUri) : null,
      targetPath: this.targetUri ? this.relPath(this.targetUri) : null,
      settings: this.settings,
      status: this.engine.status,
      playingChunkIndex: this.playingChunkIndex,
      countdown: this.countdown,
    };
    panel.setState(state);
  }

  private relPath(uri: vscode.Uri): string {
    const ws = vscode.workspace.getWorkspaceFolder(uri);
    if (ws) return vscode.workspace.asRelativePath(uri, false);
    return uri.fsPath;
  }

  private openPanel(): void {
    const panel = LinesmithPanel.show(this.context.extensionUri, (msg) => this.handlePanelMessage(msg));
    this.statusBar.show();
    panel.setState({
      chunks: this.chunks,
      scriptPath: this.scriptUri ? this.relPath(this.scriptUri) : null,
      targetPath: this.targetUri ? this.relPath(this.targetUri) : null,
      settings: this.settings,
      status: this.engine.status,
      playingChunkIndex: this.playingChunkIndex,
      countdown: this.countdown,
    });
  }

  private async detachPanel(): Promise<void> {
    let panel = LinesmithPanel.getCurrent();
    if (!panel) {
      this.openPanel();
      panel = LinesmithPanel.getCurrent();
      if (!panel) return;
    }
    panel.reveal();
    try {
      await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
    } catch (err) {
      vscode.window.showWarningMessage(
        "Linesmith: this editor doesn't support moving panels to a new window."
      );
    }
  }

  private async newScript(): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({ language: LANGUAGE_ID, content: SEED_SCRIPT });
    await vscode.window.showTextDocument(doc, { preview: false });
    this.openPanel();
  }

  private async playNext(): Promise<void> {
    if (this.engine.status === "paused") {
      this.engine.resume();
      return;
    }
    if (this.engine.status === "playing") return;

    if (!this.chunks.length) {
      vscode.window.showInformationMessage("Linesmith: no chunks in the active script. Open a .linesmith file.");
      return;
    }
    const next = this.chunks.find((c) => !c.played);
    if (!next) {
      vscode.window.showInformationMessage("Linesmith: all chunks played. The list will reset on the next refresh.");
      return;
    }
    await this.playChunk(next.index);
  }

  private async playChunk(index: number): Promise<void> {
    if (this.countdown || this.engine.status === "playing" || this.engine.status === "paused") {
      this.output.appendLine(`[playChunk] busy (countdown=${!!this.countdown}, engine=${this.engine.status}) — ignored`);
      return;
    }
    const chunk = this.chunks[index];
    if (!chunk) {
      this.output.appendLine(`[playChunk] no chunk at index ${index}`);
      return;
    }
    const target = await this.resolveTarget();
    if (!target) {
      this.output.appendLine(`[playChunk] no target editor`);
      return;
    }
    this.output.appendLine(
      `[playChunk] index=${index} target=${target.document.uri.fsPath} mode=${this.settings.mode}`
    );

    this.playingChunkIndex = index;
    this.pushState();

    let liveTarget = target;
    if (this.settings.countdownSeconds > 0) {
      const cancelled = await this.runCountdown(index, this.settings.countdownSeconds);
      if (cancelled) {
        this.playingChunkIndex = null;
        this.pushState();
        return;
      }
      const refreshed = await this.resolveTarget();
      if (!refreshed) {
        this.playingChunkIndex = null;
        this.pushState();
        return;
      }
      liveTarget = refreshed;
    }

    await this.ensureFreshLine(liveTarget);

    const spec: PlaybackSpec = {
      text: chunk.text,
      mode: this.settings.mode,
      wpm: this.settings.wpm,
      jitter: this.settings.jitter,
      lineDelayMs: this.settings.lineDelayMs,
    };
    const result = await this.engine.play(spec, liveTarget, {
      chunkIndex: index,
      chunkTotal: this.chunks.length,
    });
    if (result === "completed") {
      this.chunks[index] = { ...chunk, played: true };
      if (this.chunks.every((c) => c.played)) {
        this.chunks = this.chunks.map((c) => ({ ...c, played: false }));
      }
    }
    this.playingChunkIndex = null;
    this.pushState();
  }

  private async playClipboard(): Promise<void> {
    if (this.engine.status !== "idle") return;
    const text = await vscode.env.clipboard.readText();
    if (!text) {
      vscode.window.showInformationMessage("Linesmith: clipboard is empty.");
      return;
    }
    const target = await this.resolveTarget();
    if (!target) return;

    this.statusBar.show();
    const spec: PlaybackSpec = {
      text,
      mode: this.settings.mode,
      wpm: this.settings.wpm,
      jitter: this.settings.jitter,
      lineDelayMs: this.settings.lineDelayMs,
    };
    await this.engine.play(spec, target, { chunkIndex: 0, chunkTotal: 1 });
  }

  private async ensureFreshLine(editor: vscode.TextEditor): Promise<void> {
    const pos = editor.selection.active;
    const doc = editor.document;
    if (doc.getText().length === 0) return;

    let prefix = "";
    if (pos.character > 0) {
      prefix = "\n\n";
    } else if (pos.line > 0 && doc.lineAt(pos.line - 1).text.trim().length > 0) {
      prefix = "\n";
    }
    if (!prefix) return;

    const offset = doc.offsetAt(pos);
    await editor.edit((edit) => edit.insert(pos, prefix));
    const newPos = doc.positionAt(offset + prefix.length);
    editor.selection = new vscode.Selection(newPos, newPos);
  }

  private async resolveTarget(): Promise<vscode.TextEditor | null> {
    if (this.targetUri) {
      const visible = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === this.targetUri!.toString()
      );
      if (visible) return visible;
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === this.targetUri!.toString()
      );
      if (doc) {
        return await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false });
      }
    }
    const fallback = vscode.window.visibleTextEditors.find((e) => !this.isScriptDoc(e.document));
    if (fallback) {
      this.targetUri = fallback.document.uri;
      return fallback;
    }
    vscode.window.showWarningMessage(
      "Linesmith: no target editor. Click into a code file in the main window, then try again."
    );
    return null;
  }

  private pauseResume(): void {
    if (this.engine.status === "playing") this.engine.pause();
    else if (this.engine.status === "paused") this.engine.resume();
  }

  private stop(): void {
    if (this.countdownAbort) this.countdownAbort.abort();
    this.engine.stop();
  }

  private async runCountdown(chunkIndex: number, seconds: number): Promise<boolean> {
    this.countdownAbort = new AbortController();
    const signal = this.countdownAbort.signal;
    try {
      for (let secondsLeft = seconds; secondsLeft > 0; secondsLeft--) {
        this.countdown = { chunkIndex, secondsLeft };
        this.statusBar.showCountdown(secondsLeft);
        this.pushState();
        const aborted = await sleep(1000, signal);
        if (aborted) return true;
      }
      return false;
    } finally {
      this.countdown = null;
      this.countdownAbort = null;
      this.statusBar.clearCountdown();
      this.pushState();
    }
  }

  private rearmFrom(index: number): void {
    if (index < 0 || index >= this.chunks.length) return;
    if (this.engine.status === "playing" || this.engine.status === "paused" || this.countdown) {
      this.output.appendLine(`[rearmFrom] busy — ignored`);
      return;
    }
    this.chunks = this.chunks.map((c) => ({
      ...c,
      played: c.index < index,
    }));
    this.pushState();
  }

  private async reset(): Promise<void> {
    if (this.engine.status === "playing" || this.engine.status === "paused") {
      this.engine.stop();
    }

    const target = await this.resolveTarget();
    if (target && target.document.getText().length > 0) {
      const doc = target.document;
      const fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        doc.lineAt(doc.lineCount - 1).range.end
      );
      await target.edit((edit) => edit.delete(fullRange));
      const start = new vscode.Position(0, 0);
      target.selection = new vscode.Selection(start, start);
    }

    this.chunks = this.chunks.map((c) => ({ ...c, played: false }));
    this.playingChunkIndex = null;
    this.pushState();
  }

  private handlePanelMessage(msg: PanelHostMessage): void {
    this.output.appendLine(`[panel] ${msg.type}${msg.index !== undefined ? ` index=${msg.index}` : ""}`);
    switch (msg.type) {
      case "ready":
        this.pushState();
        break;
      case "playChunk":
        if (typeof msg.index === "number") void this.playChunk(msg.index);
        break;
      case "playNext":
        void this.playNext();
        break;
      case "pauseResume":
        this.pauseResume();
        break;
      case "stop":
        this.stop();
        break;
      case "newScript":
        void this.newScript();
        break;
      case "detach":
        void this.detachPanel();
        break;
      case "reset":
        void this.reset();
        break;
      case "rearmFrom":
        if (typeof msg.index === "number") this.rearmFrom(msg.index);
        break;
      case "settingsChanged":
        if (msg.settings) {
          this.settings = { ...this.settings, ...msg.settings };
        }
        break;
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(true);
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const controller = new LinesmithController(context);
  controller.register();
}

export function deactivate(): void {
  // engine listeners are disposed via context subscriptions
}

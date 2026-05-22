import * as vscode from "vscode";
import { TypingEngine } from "./engine";
import { parseLinesmith } from "./parser";
import { LinesmithPanel, PanelHostMessage, PanelState } from "./panel";
import { StatusBar } from "./statusBar";
import { Chunk, PlaybackSpec, SessionSettings } from "./types";

const LANGUAGE_ID = "linesmith";
const FILE_EXT = ".linesmith";

const SEED_SCRIPT = `# new linesmith script — chunks separated by --- on its own line

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
  private output = vscode.window.createOutputChannel("Linesmith");

  constructor(private context: vscode.ExtensionContext) {
    this.settings = this.loadSettings();
    this.engine.onProgress((update) => {
      this.statusBar.update(update);
      LinesmithPanel.getCurrent()?.setProgress(update);
      if (update.status === "idle" || update.status === "cancelled") {
        this.playingChunkIndex = null;
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
      vscode.commands.registerCommand("linesmith.stop", () => this.stop())
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

    await this.ensureFreshLine(target);

    this.playingChunkIndex = index;
    this.pushState();

    const spec: PlaybackSpec = {
      text: chunk.text,
      mode: this.settings.mode,
      wpm: this.settings.wpm,
      jitter: this.settings.jitter,
      lineDelayMs: this.settings.lineDelayMs,
    };
    const result = await this.engine.play(spec, target, {
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
    this.engine.stop();
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
      case "settingsChanged":
        if (msg.settings) {
          this.settings = { ...this.settings, ...msg.settings };
        }
        break;
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const controller = new LinesmithController(context);
  controller.register();
}

export function deactivate(): void {
  // engine listeners are disposed via context subscriptions
}

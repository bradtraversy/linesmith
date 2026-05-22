import * as vscode from "vscode";
import { Chunk, PlaybackStatus, ProgressUpdate, SessionSettings } from "./types";

export interface PanelHostMessage {
  type:
    | "playChunk"
    | "playNext"
    | "pauseResume"
    | "stop"
    | "settingsChanged"
    | "newScript"
    | "detach"
    | "reset"
    | "ready";
  index?: number;
  settings?: SessionSettings;
}

export interface PanelState {
  chunks: Chunk[];
  scriptPath: string | null;
  targetPath: string | null;
  settings: SessionSettings;
  status: PlaybackStatus;
  playingChunkIndex: number | null;
}

export class LinesmithPanel {
  static readonly viewType = "linesmith.panel";
  private static current: LinesmithPanel | null = null;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private messageHandler: ((msg: PanelHostMessage) => void) | null = null;
  private latestState: PanelState | null = null;

  static show(extensionUri: vscode.Uri, handler: (msg: PanelHostMessage) => void): LinesmithPanel {
    const column = vscode.ViewColumn.Beside;
    if (LinesmithPanel.current) {
      LinesmithPanel.current.messageHandler = handler;
      LinesmithPanel.current.panel.reveal(column, true);
      return LinesmithPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      LinesmithPanel.viewType,
      "Linesmith",
      { viewColumn: column, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      }
    );
    LinesmithPanel.current = new LinesmithPanel(panel, extensionUri, handler);
    return LinesmithPanel.current;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, handler: (msg: PanelHostMessage) => void) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.messageHandler = handler;
    this.panel.webview.html = this.renderHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: PanelHostMessage) => this.messageHandler?.(msg),
      null,
      this.disposables
    );
  }

  setState(state: PanelState): void {
    this.latestState = state;
    this.panel.webview.postMessage({ type: "state", state });
  }

  setProgress(update: ProgressUpdate): void {
    this.panel.webview.postMessage({ type: "progress", update });
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside, true);
  }

  static getCurrent(): LinesmithPanel | null {
    return LinesmithPanel.current;
  }

  dispose(): void {
    LinesmithPanel.current = null;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }

  private renderHtml(): string {
    const webview = this.panel.webview;
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "panel.css"));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "panel.js"));
    const nonce = generateNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link rel="stylesheet" href="${cssUri}" />
  <title>Linesmith</title>
</head>
<body>
  <header class="header">
    <button id="detach-btn" class="detach" title="Detach to its own window (great for recording)">⬈ Detach</button>
    <div class="row">
      <span class="label">Script:</span>
      <span id="script-path" class="path">(none open)</span>
    </div>
    <div class="row">
      <span class="label">Target:</span>
      <span id="target-path" class="path">(click into a code file)</span>
    </div>
  </header>

  <section id="empty" class="empty hidden">
    <p>No <code>.linesmith</code> file is the active editor.</p>
    <button id="new-script-btn">Create new script</button>
  </section>

  <section id="chunks" class="chunks"></section>

  <section class="controls">
    <div class="control-row">
      <label>Mode
        <select id="mode-select">
          <option value="instant">Instant</option>
          <option value="line">Line</option>
          <option value="char" selected>Char</option>
        </select>
      </label>
      <label>WPM
        <input type="range" id="wpm-slider" min="20" max="200" value="80" />
        <span id="wpm-value" class="value">80</span>
      </label>
      <label class="checkbox">
        <input type="checkbox" id="jitter-checkbox" checked /> Jitter
      </label>
    </div>
    <div class="control-row buttons">
      <button id="play-next-btn" class="primary">▶ Play Next</button>
      <button id="pause-btn">⏸ Pause</button>
      <button id="stop-btn">⏹ Stop</button>
      <button id="reset-btn" class="secondary" title="Clear the target file and re-arm all chunks">⟲ Reset</button>
    </div>
  </section>

  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function generateNonce(): string {
  let result = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

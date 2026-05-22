import * as vscode from "vscode";
import { PlaybackSpec, PlaybackState, PlaybackStatus, ProgressUpdate } from "./types";

const CHARS_PER_WORD = 5;

export type ProgressListener = (update: ProgressUpdate) => void;

export class TypingEngine {
  private state: PlaybackState = { status: "idle", position: 0 };
  private pendingEdits = 0;
  private resumeSignal: (() => void) | null = null;
  private docListener?: vscode.Disposable;
  private currentChunkIndex = 0;
  private currentChunkTotal = 0;
  private currentChunkLength = 0;
  private listener: ProgressListener | null = null;

  onProgress(listener: ProgressListener): void {
    this.listener = listener;
  }

  get status(): PlaybackStatus {
    return this.state.status;
  }

  async play(
    spec: PlaybackSpec,
    target: vscode.TextEditor,
    context: { chunkIndex: number; chunkTotal: number }
  ): Promise<"completed" | "cancelled"> {
    if (this.state.status === "playing" || this.state.status === "paused") {
      return "cancelled";
    }

    this.currentChunkIndex = context.chunkIndex;
    this.currentChunkTotal = context.chunkTotal;
    this.currentChunkLength = spec.text.length;
    this.state = { status: "playing", position: 0, startedAt: Date.now() };
    this.emit();

    this.attachCancelWatcher(target);

    try {
      if (spec.mode === "instant") {
        const ok = await this.applyEdit(target, target.selection.active, spec.text);
        if (!ok) return this.finishCancelled();
        this.state.position = spec.text.length;
        this.emit();
      } else if (spec.mode === "line") {
        const result = await this.playByLine(spec, target);
        if (result === "cancelled") return this.finishCancelled();
      } else {
        const result = await this.playByChar(spec, target);
        if (result === "cancelled") return this.finishCancelled();
      }
    } finally {
      this.detachCancelWatcher();
    }

    this.state = { status: "idle", position: this.currentChunkLength };
    this.emit();
    return "completed";
  }

  pause(): void {
    if (this.state.status !== "playing") return;
    this.state.status = "paused";
    this.emit();
  }

  resume(): void {
    if (this.state.status !== "paused") return;
    this.state.status = "playing";
    this.emit();
    const signal = this.resumeSignal;
    this.resumeSignal = null;
    signal?.();
  }

  stop(): void {
    if (this.state.status === "idle" || this.state.status === "cancelled") return;
    this.state.status = "cancelled";
    this.emit();
    const signal = this.resumeSignal;
    this.resumeSignal = null;
    signal?.();
  }

  private finishCancelled(): "cancelled" {
    this.state = { status: "idle", position: this.state.position };
    this.emit();
    return "cancelled";
  }

  private async playByLine(spec: PlaybackSpec, target: vscode.TextEditor): Promise<"completed" | "cancelled"> {
    const lineDelay = spec.lineDelayMs ?? 120;
    let remaining = spec.text;
    let isFirst = true;
    while (remaining.length > 0) {
      const newlineIdx = remaining.indexOf("\n");
      const segment = newlineIdx === -1 ? remaining : remaining.slice(0, newlineIdx + 1);
      remaining = newlineIdx === -1 ? "" : remaining.slice(newlineIdx + 1);

      if (!isFirst) {
        const stopped = await this.delay(lineDelay);
        if (stopped) return "cancelled";
      }
      isFirst = false;

      const ok = await this.applyEdit(target, target.selection.active, segment);
      if (!ok) return "cancelled";

      this.state.position += segment.length;
      this.emit();

      const pauseStopped = await this.waitIfPaused();
      if (pauseStopped) return "cancelled";
    }
    return "completed";
  }

  private async playByChar(spec: PlaybackSpec, target: vscode.TextEditor): Promise<"completed" | "cancelled"> {
    const wpm = spec.wpm ?? 80;
    const baseDelay = 60000 / (wpm * CHARS_PER_WORD);
    const jitter = spec.jitter ?? false;

    for (const ch of spec.text) {
      const pauseStopped = await this.waitIfPaused();
      if (pauseStopped) return "cancelled";

      const ok = await this.applyEdit(target, target.selection.active, ch);
      if (!ok) return "cancelled";

      this.state.position += ch.length;
      this.emit();

      const delayMs = jitter ? baseDelay * (0.7 + Math.random() * 0.6) : baseDelay;
      const stopped = await this.delay(delayMs);
      if (stopped) return "cancelled";
    }
    return "completed";
  }

  private async applyEdit(editor: vscode.TextEditor, position: vscode.Position, text: string): Promise<boolean> {
    if (this.state.status === "cancelled") return false;
    this.pendingEdits++;
    let success = false;
    try {
      success = await editor.edit(
        (builder) => builder.insert(position, text),
        { undoStopBefore: false, undoStopAfter: false }
      );
    } catch {
      success = false;
    }
    if (!success) {
      return false;
    }
    const newOffset = editor.document.offsetAt(position) + text.length;
    const newPos = editor.document.positionAt(newOffset);
    editor.selection = new vscode.Selection(newPos, newPos);
    editor.revealRange(new vscode.Range(newPos, newPos), vscode.TextEditorRevealType.Default);
    return true;
  }

  private async delay(ms: number): Promise<boolean> {
    if (ms <= 0) return this.state.status === "cancelled";
    await new Promise((resolve) => setTimeout(resolve, ms));
    return this.state.status === "cancelled";
  }

  private async waitIfPaused(): Promise<boolean> {
    if (this.statusIs("cancelled")) return true;
    while (this.statusIs("paused")) {
      await new Promise<void>((resolve) => {
        this.resumeSignal = resolve;
      });
      if (this.statusIs("cancelled")) return true;
    }
    return false;
  }

  private statusIs(status: PlaybackStatus): boolean {
    return this.state.status === status;
  }

  private attachCancelWatcher(editor: vscode.TextEditor): void {
    this.detachCancelWatcher();
    this.docListener = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document !== editor.document) return;
      if (this.pendingEdits > 0) {
        this.pendingEdits = Math.max(0, this.pendingEdits - event.contentChanges.length);
        return;
      }
      this.stop();
    });
  }

  private detachCancelWatcher(): void {
    this.docListener?.dispose();
    this.docListener = undefined;
    this.pendingEdits = 0;
  }

  private emit(): void {
    if (!this.listener) return;
    this.listener({
      chunkIndex: this.currentChunkIndex,
      chunkTotal: this.currentChunkTotal,
      positionInChunk: this.state.position,
      chunkLength: this.currentChunkLength,
      status: this.state.status,
    });
  }
}

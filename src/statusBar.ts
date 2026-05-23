import * as vscode from "vscode";
import { ProgressUpdate } from "./types";

export class StatusBar {
  private item: vscode.StatusBarItem;
  private visible = false;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = "linesmith.pauseResume";
  }

  show(): void {
    this.visible = true;
    this.refreshIdle();
  }

  hide(): void {
    this.visible = false;
    this.item.hide();
  }

  showCountdown(secondsLeft: number): void {
    this.visible = true;
    this.item.text = `$(watch) Linesmith — starting in ${secondsLeft}…`;
    this.item.tooltip = "Click to cancel";
    this.item.command = "linesmith.stop";
    this.item.show();
  }

  clearCountdown(): void {
    if (this.visible) this.refreshIdle();
  }

  update(update: ProgressUpdate): void {
    if (!this.visible) this.visible = true;

    const pct = update.chunkLength === 0
      ? 0
      : Math.round((update.positionInChunk / update.chunkLength) * 100);

    if (update.status === "playing") {
      this.item.text = `$(record) Linesmith — chunk ${update.chunkIndex + 1}/${update.chunkTotal}, ${pct}%`;
      this.item.tooltip = "Click to pause";
    } else if (update.status === "paused") {
      this.item.text = `$(debug-pause) Linesmith — paused (${update.chunkIndex + 1}/${update.chunkTotal}, ${pct}%)`;
      this.item.tooltip = "Click to resume";
    } else if (update.status === "cancelled") {
      this.item.text = `$(stop-circle) Linesmith — stopped`;
      this.item.tooltip = "Open Linesmith panel";
      this.item.command = "linesmith.openPanel";
    } else {
      this.refreshIdle();
      return;
    }

    this.item.show();
  }

  private refreshIdle(): void {
    this.item.text = `$(keyboard) Linesmith`;
    this.item.tooltip = "Open Linesmith panel";
    this.item.command = "linesmith.openPanel";
    if (this.visible) this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}

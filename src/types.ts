export type PlaybackMode = "instant" | "line" | "char";

export interface PlaybackSpec {
  text: string;
  mode: PlaybackMode;
  wpm?: number;
  jitter?: boolean;
  lineDelayMs?: number;
}

export type PlaybackStatus = "idle" | "playing" | "paused" | "cancelled";

export interface PlaybackState {
  status: PlaybackStatus;
  position: number;
  startedAt?: number;
}

export interface Chunk {
  index: number;
  text: string;
  preview: string;
  played: boolean;
}

export interface SessionSettings {
  mode: PlaybackMode;
  wpm: number;
  jitter: boolean;
  lineDelayMs: number;
}

export interface ProgressUpdate {
  chunkIndex: number;
  chunkTotal: number;
  positionInChunk: number;
  chunkLength: number;
  status: PlaybackStatus;
}

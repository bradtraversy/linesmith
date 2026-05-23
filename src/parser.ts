import { Chunk } from "./types";

const SEPARATOR = /^\s*---\s*$/;
const DIRECTIVE = /^\s*@([a-zA-Z][a-zA-Z0-9_-]*)\s*:?\s*(.*)$/;
const PREVIEW_MAX = 60;

export function parseLinesmith(source: string): Chunk[] {
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  const groups: string[][] = [[]];
  for (const line of lines) {
    if (SEPARATOR.test(line)) {
      groups.push([]);
    } else {
      groups[groups.length - 1].push(line);
    }
  }

  const chunks: Chunk[] = [];
  let index = 0;
  for (const group of groups) {
    const trimmed = trimBlankEdges(group);
    const { notes, body } = extractDirectives(trimmed);
    const text = body.join("\n");
    if (text.length === 0 && notes.length === 0) continue;
    chunks.push({
      index: index++,
      text,
      preview: makePreview(text),
      played: false,
      notes,
    });
  }
  return chunks;
}

const KNOWN_DIRECTIVES = new Set(["note"]);

function extractDirectives(lines: string[]): { notes: string[]; body: string[] } {
  const notes: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(DIRECTIVE);
    if (!m) break;
    const name = m[1].toLowerCase();
    if (!KNOWN_DIRECTIVES.has(name)) break;
    const value = m[2].trim();
    if (name === "note" && value.length > 0) notes.push(value);
    i++;
  }
  const body = trimBlankEdges(lines.slice(i));
  return { notes, body };
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

function makePreview(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim() !== "") ?? "";
  const trimmed = firstLine.trim();
  if (trimmed.length <= PREVIEW_MAX) return trimmed;
  return trimmed.slice(0, PREVIEW_MAX - 1) + "…";
}

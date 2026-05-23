# Changelog

All notable changes to Linesmith will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-05-23

### Added
- `@note` directive — lines starting with `@note` at the top of a chunk become talking-point notes in the panel; never typed into the target. Multiple `@note` lines accumulate.
- Countdown before playback — optional 3s or 5s pre-roll before Play Next or per-chunk Play, with a full-panel overlay and status-bar mirror. Off by default. Does not affect the clipboard fast path.
- Re-arm from chunk — hover any chunk card and click the rewind button to mark earlier chunks played and this chunk + later as un-played. Useful for restarting a take partway through a script.
- `linesmith.defaultCountdown` setting — `0` / `3` / `5`.

### Changed
- Maximum WPM raised from 200 to 300 for fast-burst typing effects.
- Stop button now also cancels an in-progress countdown without starting playback.

## [0.1.0] — 2026-05-22

Initial release.

### Added
- Typing engine with instant, line, and char modes
- Adjustable WPM and human-like jitter for char mode
- `.linesmith` script files — plain text with `---` chunk separators
- Webview panel with per-chunk Play, Play Next, Pause, Stop, and Reset
- Detach Panel action — pops the panel into its own OS window for clean screen recording
- Clipboard fast path — `ctrl+alt+shift+l` types the clipboard contents at the cursor
- Status bar progress indicator with click-to-pause
- `.linesmith` language contribution — file icon, syntax highlighting for `---` separators and `@directive` lines
- Six commands wired to keyboard shortcuts: Play Next, Play From Clipboard, Stop, Open Panel, New Script, Detach Panel
- Configurable defaults: `linesmith.defaultMode`, `linesmith.defaultWpm`, `linesmith.defaultJitter`, `linesmith.defaultLineDelayMs`

### Notes
- Cursor choreography (per-chunk `@directive` frontmatter for cursor placement and edit moves) is the planned v0.2 differentiator — the syntax highlighting groundwork ships here so v0.2 can extend it without grammar surgery.

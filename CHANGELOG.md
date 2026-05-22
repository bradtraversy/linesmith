# Changelog

All notable changes to Linesmith will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

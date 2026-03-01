# DeckTerm — Project Context for Claude

## Overview

DeckTerm is an Electron-based terminal emulator (shell wrapper) that exposes a WebSocket API so it can be remote-controlled by an accompanying Elgato Stream Deck plugin. A user can press a physical button on their Stream Deck to send any shell command, execute a `cd` to a directory, or open / bring focus to the terminal — all without touching the keyboard.

- **Author:** Cedric Fromm
- **App ID:** `com.cedfro.deck-term`
- **Version:** 0.6.0 (Electron app), 0.1.0 (Stream Deck plugin)
- **License:** MIT / ISC

---

## Repository Structure

```
DeckTerm/                          # Root of the repo
├── README.md
├── LICENSE
├── claude.md                      # This file
│
├── DeckTerm/                      # Electron application
│   ├── main.js                    # Main process: window, pty, WebSocket server
│   ├── index.js                   # Renderer process: xterm.js UI, shell switcher
│   ├── index.html                 # HTML shell for the renderer
│   ├── preload.js                 # Preload script (window manager helpers)
│   ├── styles.css                 # Dark theme styles
│   ├── package.json               # Electron app dependencies & electron-builder config
│   └── build/                     # Icons & build assets
│
└── StreamDeckPlugin/
    └── deck-term/                 # Stream Deck plugin source
        ├── package.json           # Plugin dependencies (rollup, @elgato/streamdeck, ws)
        ├── rollup.config.mjs      # Bundles TypeScript → bin/plugin.js
        ├── tsconfig.json
        └── com.cedfro.deck-term.sdPlugin/
            ├── manifest.json      # Plugin manifest (actions, OS targets, SDK version)
            ├── bin/               # Compiled plugin output (plugin.js, package.json)
            ├── imgs/              # Action & category icons
            └── ui/
                ├── terminal-command.html   # Property Inspector for Terminal Command action
                └── open-terminal.html      # Property Inspector for Open Terminal action
        └── src/
            ├── plugin.ts          # Entry point: registers actions, connects to Stream Deck
            └── actions/
                └── deck-term.ts   # TerminalCommandAction, OpenTerminalAction
```

---

## Architecture

### Electron App (`DeckTerm/`)

| Layer | Technology | Responsibility |
|---|---|---|
| Main process | Node.js / Electron | Spawns pty, owns WebSocket server, manages window state |
| Shell process | `node-pty` | Runs the actual shell (cmd, bash, PowerShell, Git Bash, …) |
| Terminal UI | `xterm.js` + FitAddon | Renders terminal in the renderer process |
| Remote API | `ws` (WebSocket, port **3000**) | Accepts commands from the Stream Deck plugin or any external client |
| IPC bridge | Electron IPC | Relays keystrokes/resize/data between renderer and main process |

#### Key files — Electron app

- **`main.js`** — Creates the frameless `BrowserWindow`, loads saved window geometry, spawns `node-pty`, sets up IPC handlers, and starts the WebSocket server on port 3000. Contains `handleWebSocketCommand()` which routes `command` and `open` message types.
- **`index.js`** — Renderer code. Initialises `xterm.js`, the `FitAddon`, all IPC listeners, the custom frameless titlebar (min/max/close), a shell-switcher dropdown (auto-detects PowerShell, cmd, Git Bash), and Ctrl+Scroll font zoom.
- **`preload.js`** — Exposes `window.windowManager` helpers (close/minimize/toggleMaximize) via the Electron preload context.

#### Configuration

Persisted in the Electron `userData` directory:

| File | Purpose |
|---|---|
| `config.json` | `{ "customPath": "<shell executable>" }` — overrides the detected default shell |
| `window-state.json` | Saves last window bounds (x, y, width, height) between sessions |

Default shell paths:
- **Windows:** `C:\WINDOWS\system32\cmd.exe`
- **macOS / Linux:** `bash`

`config.json` location:
- Windows: `%APPDATA%\DeckTerm\config.json`
- macOS/Linux: `~/.config/DeckTerm/config.json`

---

### Stream Deck Plugin (`StreamDeckPlugin/deck-term/`)

Built with the official `@elgato/streamdeck` SDK (TypeScript). Compiled by Rollup into a single `bin/plugin.js` bundle.

#### Actions

| Action | UUID | Property Inspector field | What it does |
|---|---|---|---|
| **Terminal Command** | `com.cedfro.deck-term.terminalcommand` | `terminalcommand` (text) | Opens a WebSocket to `ws://localhost:3000`, sends `{ "cmd": "command", "terminalcommand": "<value>" }` |
| **Open Terminal** | `com.cedfro.deck-term.openterminal` | `path` (text) | Opens a WebSocket to `ws://localhost:3000`, sends `{ "cmd": "open", "path": "<value>" }` |

Each key press creates a short-lived WebSocket connection, sends one JSON message, and immediately closes.

#### Plugin targets

- Stream Deck software ≥ 6.5
- Windows 10+, macOS 12+
- Node.js 20 runtime (inside Stream Deck)

---

## WebSocket API (port 3000)

Anyone can integrate with DeckTerm by connecting to `ws://localhost:3000`.

### Execute a shell command
```json
{ "cmd": "command", "terminalcommand": "git status" }
```
DeckTerm writes `<terminalcommand>\n` to the active pty.

### Change directory
```json
{ "cmd": "open", "path": "C:/Projects/my-app" }
```
DeckTerm writes `cd "<path>"\n` to the active pty.

---

## Development Setup

### Electron App

```bash
cd DeckTerm
npm install
npm start          # run in development mode
npm run dist       # build installers (NSIS on Windows, DMG on macOS, AppImage/deb on Linux)
```

Key dependencies: `electron`, `node-pty`, `xterm`, `ws`, `electron-builder`.

### Stream Deck Plugin

```bash
cd StreamDeckPlugin/deck-term
npm install
npm run build      # single production build → com.cedfro.deck-term.sdPlugin/bin/plugin.js
npm run watch      # incremental build + auto-restart plugin in Stream Deck software
```

Key dependencies: `@elgato/streamdeck`, `ws`, `rollup`, `typescript`.

To install the plugin, double-click the built `.streamDeckPlugin` package; Stream Deck software handles the rest.

---

## Goals & Roadmap Direction

- **Core goal:** Provide a lightweight, always-available terminal that can be driven by physical hardware buttons (Stream Deck).
- **Shell agnosticism:** Support any shell (cmd, PowerShell, Git Bash, zsh, …) via `node-pty` and a user-configurable path.
- **Extensibility:** The WebSocket API is intentionally simple so third-party tools beyond Stream Deck can integrate.
- **Cross-platform:** Electron + node-pty targets Windows, macOS, and Linux from the same codebase.
- **Potential future areas:** Multi-tab / multi-session support, configurable WebSocket port, authentication/security for the WebSocket API, richer Stream Deck feedback (e.g. command output displayed on key LCD).

---

## Notable Implementation Details

- The window is **frameless** (`frame: false`); the titlebar (drag region, min/max/close, menu) is fully custom HTML/CSS/JS.
- Hardware acceleration is **disabled** (`app.disableHardwareAcceleration()`) to avoid GPU rendering issues in the terminal.
- `node-pty` is spawned with `cols: 120, rows: 40` as comfortable initial defaults; the renderer sends resize events as the window changes.
- The renderer uses `Ctrl + Scroll` to zoom the font size (clamped 8–40 px).
- The plugin uses a fresh WebSocket connection per keypress rather than a persistent connection, keeping the plugin stateless and resilient to DeckTerm restarts.

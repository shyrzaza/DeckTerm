# DeckTerm — Refactoring Checklist

Items are ordered by severity. Check them off as you go.

---

## 🔴 Critical

### 1. Fix Electron security misconfiguration
- [x] **Done**

**Files:** `DeckTerm/main.js`, `DeckTerm/preload.js`

`BrowserWindow` is created with `nodeIntegration: true`, `contextIsolation: false`, and `enableRemoteModule: true`. This is a well-documented attack vector — any XSS or injected content in the renderer gets full Node.js access to the machine. The modern Electron pattern (enforced since Electron 12) is `contextIsolation: true` and `nodeIntegration: false`, with a `contextBridge` in the preload script that explicitly exposes only the APIs the renderer actually needs.

```js
// ❌ current — dangerous
webPreferences: {
  nodeIntegration: true,
  contextIsolation: false,
  enableRemoteModule: true
}

// ✅ should be
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  preload: path.join(__dirname, 'preload.js')
}
```

In `preload.js`, replace all `remote` usage with `contextBridge.exposeInMainWorld(...)` to expose a typed, minimal API surface to the renderer.

---

### 2. Replace dead `preload.js` — `remote` module was removed
- [x] **Done**

**File:** `DeckTerm/preload.js`

`require('electron').remote` was removed in Electron 14. The current `preload.js` silently fails on every startup — `window.windowManager` is never actually set. The window control buttons work purely because `index.js` sends IPC messages directly, making the preload dead code that creates a false impression of safety.

Rewrite `preload.js` using the `contextBridge` API (part of fix #1):

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, data) => ipcRenderer.send(channel, data),
  on: (channel, callback) => ipcRenderer.on(channel, (_, ...args) => callback(...args))
});
```

Then update `index.js` to use `window.electronAPI.send(...)` / `window.electronAPI.on(...)` instead of `require('electron').ipcRenderer` directly.

---

## 🟠 High

### 3. Add WebSocket authentication
- [x] **Done**

**File:** `DeckTerm/main.js`

The WebSocket server on port 3000 accepts any JSON from any local process with zero validation. Any application running on the same machine can send arbitrary shell commands to the user's terminal. At minimum, implement a per-session shared token:

1. On startup, generate a random token (e.g. `crypto.randomUUID()`).
2. Write it to a known local file (e.g. `userData/ws-token.json`).
3. Require all WebSocket clients to send `{ "auth": "<token>" }` as the first message before any command is accepted.
4. The Stream Deck plugin reads the token file on connection.

**Security boundary:** This token protects against generic/opportunistic abuse — port scanners, random malware, accidental connections from other tools using port 3000. It does **not** protect against a targeted process running as the same OS user, because that process can read `userData/ws-token.json` directly. This is an intentional, documented limit: any same-user process already has full shell access and does not need DeckTerm to cause harm. The token raises the bar; it is not a sandbox.

---

### 4. Load xterm.js from local node_modules, not CDN
- [x] **Done**

**File:** `DeckTerm/index.html`

Both `xterm.js` and `xterm-addon-fit` are loaded from `cdn.jsdelivr.net`. The packages are already declared as `dependencies` in `package.json` but never used locally. Problems:
- The app breaks when offline.
- No subresource integrity (SRI) hashes — CDN content could be tampered with.
- CDN version can silently diverge from the npm version.

Replace the CDN `<script>` and `<link>` tags with paths pointing into `node_modules`:

```html
<!-- ❌ current -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
<script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.7.0/lib/xterm-addon-fit.js"></script>

<!-- ✅ should be -->
<link rel="stylesheet" href="../node_modules/xterm/css/xterm.css" />
<script src="../node_modules/xterm/lib/xterm.js"></script>
<script src="../node_modules/xterm-addon-fit/lib/xterm-addon-fit.js"></script>
```

---

### 5. Fix duplicate IPC handler registration
- [x] **Done**

**File:** `DeckTerm/main.js`

`ipcMain.on('terminal.keystroke', ...)` is registered in two places: once in `setupTerminalHandlers()` (to write input to the pty) and again in `setupWebSocketServer()` (to broadcast to WS clients). In Electron, `ipcMain.on` stacks listeners — every keystroke fires both handlers. If `createWindow()` is ever called more than once (e.g. on macOS re-activate), the handlers accumulate indefinitely.

Consolidate into a single handler in `setupTerminalHandlers()` that both writes to pty and calls `broadcastToWebSocketClients()`:

```js
ipcMain.on('terminal.keystroke', (event, data) => {
  ptyProcess.write(data);
  broadcastToWebSocketClients(data);
});
```

Remove the second registration from `setupWebSocketServer()`.

---

### 6. Update Electron to current stable version
- [x] **Done**

**File:** `DeckTerm/package.json`

`"electron": "^27.0.0"` was released in late 2023. Current stable (early 2026) is Electron 34. Electron 27 has known security advisories. For an open-source terminal application that runs with direct shell access, staying on a supported, up-to-date Electron release is important.

```bash
cd DeckTerm
npm install --save-dev electron@latest
```

After upgrading, verify that `node-pty` native bindings are rebuilt for the new Electron version:

```bash
npx electron-rebuild
```

---

### 8. Migrate Electron app to TypeScript
- [x] **Done**

**Files:** `DeckTerm/main.js`, `DeckTerm/index.js`, `DeckTerm/preload.js`

The Stream Deck plugin is already properly TypeScript with strict settings. The Electron app is plain JS. `electron`, `node-pty`, and `ws` all ship excellent type definitions. Migrating catches whole categories of bugs at editor-time (wrong IPC channel names, missing properties, bad pty options, etc.).

Quickest migration path:
1. Add a `tsconfig.json` to `DeckTerm/` (extend `@tsconfig/node20`).
2. Rename files to `.ts`.
3. Install `typescript` and `ts-node` as devDependencies.
4. Update `package.json` scripts to compile before `electron .`.

As a lower-effort intermediate step, add `// @ts-check` at the top of each `.js` file and add JSDoc type annotations — this gives type checking in VS Code without a full TypeScript migration.

---

### 9. Replace `var shell` with `let`
- [x] **Done**

**File:** `DeckTerm/main.js`

One module-scoped variable is declared with `var` while the rest of the file correctly uses `let`/`const`. `var` has function scope and hoisting behaviour that can introduce subtle bugs.

```js
// ❌ current
var shell = config.customPath;

// ✅ should be
let shell = config.customPath;
```

---

### 10. Remove commented-out dead code block
- [x] **Done**

**File:** `DeckTerm/main.js`

A ~20-line commented-out `ipcMain.on('select-shell-dialog', ...)` block sits at the very top of `main.js`. The functionality was superseded by `ipcMain.on('terminal.reloadShell', ...)` but the old code was never deleted. Dead code increases cognitive load for new contributors and signals that the codebase may not be actively maintained.

Delete the entire commented block at the top of the file.

---

### 11. Rename `GitBashSettings` type in the plugin
- [x] **Done**

**File:** `StreamDeckPlugin/deck-term/src/actions/deck-term.ts`

The settings type for `TerminalCommandAction` is called `GitBashSettings` — a leftover from an earlier iteration when the plugin only supported Git Bash. The action now works with any shell command, so the type name is misleading.

```ts
// ❌ current
type GitBashSettings = {
  terminalcommand: string;
};

// ✅ should be
type TerminalCommandSettings = {
  terminalcommand: string;
};
```

Update the generic parameter on `SingletonAction<GitBashSettings>` and both event handler signatures accordingly.

---

### 12. Persist font size to config
- [x] **Done**

**Files:** `DeckTerm/index.js`, `DeckTerm/main.js`

`Ctrl+Scroll` changes the font size via `currentFontSize` in the renderer, but the value is never saved. After a restart the font resets to 14px. The size should be written to `config.json` alongside `customPath`.

Approach:
1. When font size changes in `index.js`, send an IPC message: `ipc.send('config.setFontSize', currentFontSize)`.
2. In `main.js`, handle that message by merging the value into `config.json` on disk.
3. On startup, read `fontSize` from config and pass it to the renderer as part of the initial setup IPC.

---

## 🔵 Low

### 13. Add tests
- [ ] **Done**

**Both sub-projects**

Neither the Electron app nor the plugin has any test coverage. For open source, even minimal tests give contributors confidence when making changes.

Suggested starting points:
- **`DeckTerm/`** — Unit tests for `loadConfig`, `handleWebSocketCommand` (command routing), `findShells` (path detection), and `loadWindowState`. Use [Vitest](https://vitest.dev/) or Jest with an Electron test helper.
- **`StreamDeckPlugin/`** — Unit tests for the WebSocket message construction in `TerminalCommandAction` and `OpenTerminalAction`. Vitest works natively with the TypeScript setup already in place.

---

### 14. Add a CI/CD pipeline
- [ ] **Done**

**New file:** `.github/workflows/ci.yml`

No GitHub Actions workflow exists. Without CI, broken builds and type errors can be merged silently. A minimal workflow should:
1. Run on every push and PR to `main`.
2. Install dependencies for both sub-projects.
3. Type-check and lint the plugin (`tsc --noEmit`).
4. Build the plugin (`npm run build`).
5. (Future) Run tests once they exist.

---

### 15. Replace `electron-reload` alpha dependency
- [x] **Done**

**File:** `DeckTerm/package.json`

`"electron-reload": "^2.0.0-alpha.1"` is an alpha release that has not been updated in years. It is a devDependency only, so it doesn't affect end users, but it can cause install warnings and signals instability.

Options:
- Switch to [electron-vite](https://electron-vite.org/) for a modern, actively maintained HMR dev experience.
- Or simply remove it for the initial open-source release and rely on manual restarts during development.

---

### 16. Add open-source community files
- [ ] **Done**

**New files at repo root**

Standard open-source hygiene. GitHub surfaces these automatically when contributors open issues or pull requests.

| File | Purpose |
|---|---|
| `CONTRIBUTING.md` | How to set up the project, coding conventions, PR process |
| `.github/ISSUE_TEMPLATE/bug_report.md` | Structured bug report template |
| `.github/ISSUE_TEMPLATE/feature_request.md` | Structured feature request template |
| `CODE_OF_CONDUCT.md` | Contributor Covenant or similar |

---

### 17. Add `.nvmrc` to pin Node version
- [ ] **Done**

**New file:** `.nvmrc` (repo root)

The plugin's `manifest.json` and `tsconfig.json` both target Node 20, but there is no lockfile hint for contributors who use `nvm` or `fnm`. Without it, someone on Node 18 or 22 may hit subtle compatibility issues.

Create `.nvmrc` at the repo root:
```
20
```

---

### 18. Fix embedded quotes in `DEFAULT_SHELL_WIN`
- [x] **Done**

**File:** `DeckTerm/main.js`

The Windows default shell constant includes literal quote characters inside the string:

```js
// ❌ current — the quotes are part of the value
const DEFAULT_SHELL_WIN = '"C:\\WINDOWS\\system32\\cmd.exe"';
```

When this is passed to `pty.spawn()` as the executable path, those embedded quotes cause the spawn to fail. The quotes are unnecessary — `node-pty` does not require them.

```js
// ✅ correct
const DEFAULT_SHELL_WIN = 'C:\\WINDOWS\\system32\\cmd.exe';
```
---

### 19. Migrate from deprecated `xterm-addon-fit` to `@xterm/addon-fit`
- [x] **Done**

**Files:** `DeckTerm/package.json`, `DeckTerm/index.html`, `DeckTerm/index.js`

`xterm-addon-fit@0.7.0` is deprecated. The xterm.js project moved to a scoped package namespace (`@xterm/*`). The replacement is `@xterm/addon-fit`, which should be done alongside item #6 (Electron upgrade) as the newer packages may require API changes.

```bash
npm uninstall xterm xterm-addon-fit
npm install @xterm/xterm @xterm/addon-fit
```

Update `index.html` script paths:
```html
<!-- ❌ current -->
<script src="./node_modules/xterm/lib/xterm.js"></script>
<script src="./node_modules/xterm-addon-fit/lib/xterm-addon-fit.js"></script>

<!-- ✅ should be -->
<script src="./node_modules/@xterm/xterm/lib/xterm.js"></script>
<script src="./node_modules/@xterm/addon-fit/lib/addon-fit.js"></script>
```

Check the `@xterm/addon-fit` package for any constructor or API differences before switching.
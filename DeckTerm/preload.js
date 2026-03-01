/**
 * DeckTerm Preload Script
 *
 * Runs in an isolated context between the main process and the renderer.
 * Only the methods explicitly listed here are accessible to the renderer —
 * no Node.js or Electron internals leak through.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // ── Terminal I/O ────────────────────────────────────────────────────────

    /** Send updated terminal dimensions to the main process. */
    sendResize: (cols, rows) =>
        ipcRenderer.send('terminal.resize', { cols, rows }),

    /** Forward a keystroke from the terminal UI to the pty. */
    sendKeystroke: (data) =>
        ipcRenderer.send('terminal.keystroke', data),

    /** Register a callback that fires whenever the pty produces output. */
    onIncomingData: (callback) =>
        ipcRenderer.on('terminal.incomingData', (_, data) => callback(data)),

    // ── Shell management ────────────────────────────────────────────────────

    /** Ask the main process for the list of detected shell executables. */
    getShells: () =>
        ipcRenderer.invoke('shell.getShells'),

    /** Tell the main process to restart the pty with a different shell. */
    reloadShell: (shellPath) =>
        ipcRenderer.send('terminal.reloadShell', { shellPath }),

    // ── Window controls ─────────────────────────────────────────────────────

    minimize: () =>
        ipcRenderer.send('window-control', { action: 'minimize' }),

    maximizeToggle: () =>
        ipcRenderer.send('window-control', { action: 'maximize-toggle' }),

    close: () =>
        ipcRenderer.send('window-control', { action: 'close' }),
});
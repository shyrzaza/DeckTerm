/**
 * DeckTerm Preload Script
 *
 * Runs in an isolated context between the main process and the renderer.
 * Only the methods explicitly listed here are accessible to the renderer —
 * no Node.js or Electron internals leak through.
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
    sendResize: (cols: number, rows: number) => void;
    sendKeystroke: (data: string) => void;
    onIncomingData: (callback: (data: string) => void) => void;
    getShells: () => Promise<Array<{ name: string; exePath: string }>>;
    reloadShell: (shellPath: string) => void;
    getFontSize: () => Promise<number>;
    saveFontSize: (size: number) => void;
    minimize: () => void;
    maximizeToggle: () => void;
    close: () => void;
}

contextBridge.exposeInMainWorld('electronAPI', {
    // ── Terminal I/O ────────────────────────────────────────────────────────

    /** Send updated terminal dimensions to the main process. */
    sendResize: (cols: number, rows: number) =>
        ipcRenderer.send('terminal.resize', { cols, rows }),

    /** Forward a keystroke from the terminal UI to the pty. */
    sendKeystroke: (data: string) =>
        ipcRenderer.send('terminal.keystroke', data),

    /** Register a callback that fires whenever the pty produces output. */
    onIncomingData: (callback: (data: string) => void) =>
        ipcRenderer.on('terminal.incomingData', (_event, data: string) => callback(data)),

    // ── Shell management ────────────────────────────────────────────────────

    /** Ask the main process for the list of detected shell executables. */
    getShells: () =>
        ipcRenderer.invoke('shell.getShells'),

    /** Tell the main process to restart the pty with a different shell. */
    reloadShell: (shellPath: string) =>
        ipcRenderer.send('terminal.reloadShell', { shellPath }),

    /** Retrieve the saved font size from config. */
    getFontSize: () =>
        ipcRenderer.invoke('config.getFontSize'),

    /** Persist the current font size to config. */
    saveFontSize: (size: number) =>
        ipcRenderer.send('config.setFontSize', size),

    // ── Window controls ─────────────────────────────────────────────────────

    minimize: () =>
        ipcRenderer.send('window-control', { action: 'minimize' }),

    maximizeToggle: () =>
        ipcRenderer.send('window-control', { action: 'maximize-toggle' }),

    close: () =>
        ipcRenderer.send('window-control', { action: 'close' }),
} satisfies ElectronAPI);

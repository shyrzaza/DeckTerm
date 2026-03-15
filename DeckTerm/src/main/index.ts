/**
 * DeckTerm - Main Process
 *
 * Manages the BrowserWindow, pty, IPC handlers, and WebSocket server.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import * as pty from 'node-pty';
import type { IPty, IDisposable } from 'node-pty';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';

// Constants
const DEFAULT_SHELL_WIN = 'C:\\WINDOWS\\system32\\cmd.exe';
const DEFAULT_SHELL_UNIX = 'bash';
const WS_PORT = 3000;

// Ensure userData path is consistent between dev and production.
// In dev, Electron uses package.json "name" ("deck-term"); in production it
// uses "productName" ("DeckTerm"). Explicitly set it so both environments
// write config/token files to the same location.
app.setName('DeckTerm');

// Disable hardware acceleration to prevent potential issues
app.disableHardwareAcceleration();

interface AppConfig {
  customPath: string;
  fontSize?: number;
}

interface ShellEntry {
  name: string;
  exePath: string;
}

interface WindowState {
  width: number;
  height: number;
  x: number;
  y: number;
}

const configPath = path.join(app.getPath('userData'), 'config.json');
const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');
const wsTokenPath = path.join(app.getPath('userData'), 'ws-token.json');

/**
 * Loads the application configuration from the config file.
 */
function loadConfig(): AppConfig {
  try {
    const data = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(data) as AppConfig;
  } catch {
    return {
      customPath: os.platform() === 'win32' ? DEFAULT_SHELL_WIN : DEFAULT_SHELL_UNIX
    };
  }
}

const config = loadConfig();
let shell = config.customPath;
let wss: WebSocketServer;
let mainWindow: BrowserWindow | null = null;
let ptyProcess: IPty | null = null;
let dataDisposable: IDisposable | null = null;

/** Tracks which WebSocket connections have successfully authenticated. */


/**
 * Loads an existing WS auth token from disk, or generates and persists a new one.
 */
function loadOrCreateToken(): string {
  try {
    const data = JSON.parse(fs.readFileSync(wsTokenPath, 'utf-8')) as { token?: string };
    if (data.token) return data.token;
  } catch { /* fall through to generate */ }
  const token = crypto.randomUUID();
  fs.writeFileSync(wsTokenPath, JSON.stringify({ token }, null, 2));
  return token;
}

// ── IPC handlers registered at startup ──────────────────────────────────────

ipcMain.on('terminal.reloadShell', (_event, { shellPath }: { shellPath: string }) => {
    reloadShell(shellPath);
});

ipcMain.on('config.setFontSize', (_event, fontSize: number) => {
    config.fontSize = fontSize;
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (err) {
        console.error('Failed to save font size:', err);
    }
});

ipcMain.handle('config.getFontSize', () => config.fontSize ?? 14);

ipcMain.handle('shell.getShells', () => findShells());

// ── Shell detection ──────────────────────────────────────────────────────────

/**
 * Scans common system paths for available shell executables.
 */
function findShells(): ShellEntry[] {
    const shellDefs = [
        {
            name: 'PowerShell',
            paths: [
                path.join(process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
                path.join(process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'powershell.exe')
            ]
        },
        {
            name: 'Command Prompt',
            paths: [
                path.join(process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'cmd.exe')
            ]
        },
        {
            name: 'Git Bash',
            paths: [
                path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
                path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe')
            ]
        }
    ];

    const foundShells: ShellEntry[] = [];
    for (const def of shellDefs) {
        for (const shellPath of def.paths) {
            try {
                if (fs.existsSync(shellPath)) {
                    foundShells.push({ name: def.name, exePath: shellPath });
                    break;
                }
            } catch { /* skip inaccessible paths */ }
        }
    }
    return foundShells;
}

// ── Window state ─────────────────────────────────────────────────────────────

function loadWindowState(): WindowState {
  try {
    return JSON.parse(fs.readFileSync(windowStatePath, 'utf8')) as WindowState;
  } catch {
    return { width: 800, height: 600, x: 0, y: 0 };
  }
}

function saveWindowState(window: BrowserWindow): void {
  if (!window.isDestroyed()) {
    fs.writeFileSync(windowStatePath, JSON.stringify(window.getBounds()));
  }
}

// ── Shell / pty management ───────────────────────────────────────────────────

/**
 * Tears down the current pty and spawns a new one with the given shell.
 */
function reloadShell(newShellPath: string): void {
    shell = newShellPath;
    if (ptyProcess) {
        dataDisposable?.dispose();
        dataDisposable = null;
        ptyProcess.write('exit\r');
        try { ptyProcess.kill(); } catch { /* ignore if already dead */ }
    }
    ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 120,
        rows: 40,
        cwd: process.env.HOME,
        env: process.env
    });
    setupTerminalDataHandler();
}

// ── Window creation ──────────────────────────────────────────────────────────

function createWindow(): void {
    const savedState = loadWindowState();
    mainWindow = new BrowserWindow({
        width: savedState.width,
        height: savedState.height,
        x: savedState.x,
        y: savedState.y,
        frame: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, '../preload/index.js')
        }
    });

    mainWindow.setMenuBarVisibility(false);

    // In development, electron-vite sets ELECTRON_RENDERER_URL for HMR.
    // In production, load the built HTML file directly.
    if (process.env.NODE_ENV === 'development' && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    mainWindow.on('close', () => { if (mainWindow) saveWindowState(mainWindow); });
    mainWindow.on('closed', () => { mainWindow = null; });

    ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 120,
        rows: 40,
        cwd: process.env.HOME,
        env: process.env
    });

    setupTerminalHandlers();
    setupTerminalDataHandler();

    ipcMain.on('window-control', (_event, arg: { action: string }) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        switch (arg.action) {
            case 'minimize':        mainWindow.minimize(); break;
            case 'maximize-toggle': mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); break;
            case 'close':           mainWindow.close(); break;
        }
    });
}

// ── Terminal IPC handlers ────────────────────────────────────────────────────

function setupTerminalHandlers(): void {
    ipcMain.on('terminal.resize', (_event, size: { cols: number; rows: number }) => {
        ptyProcess?.resize(size.cols, size.rows);
    });

    ipcMain.on('terminal.keystroke', (_event, data: string) => {
        ptyProcess?.write(data);
        broadcastToWebSocketClients(data);
    });
}

function setupTerminalDataHandler(): void {
    dataDisposable = ptyProcess?.onData((data: string) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('terminal.incomingData', data);
        }
    }) ?? null;
}

// ── WebSocket server ─────────────────────────────────────────────────────────

function setupWebSocketServer(): void {
    const token = loadOrCreateToken();
    wss = new WebSocketServer({ port: WS_PORT });

    wss.on('connection', (ws) => {
        ws.on('message', (message) => {
            try {
                const parsed = JSON.parse(message.toString()) as Record<string, unknown>;

                if (parsed.token !== token) {
                    console.warn('WebSocket message rejected — invalid token');
                    ws.close(1008, 'Unauthorized');
                    return;
                }

                handleWebSocketCommand(parsed as WsMessage);
            } catch (error) {
                console.error('Error processing WebSocket message:', error);
            }
        });

        ws.on('error', (error) => console.error('WebSocket error:', error));
    });
}

type WsMessage =
    | { type: 'exec';  token: string; payload: { command: string } }
    | { type: 'chdir'; token: string; payload: { path: string } };

function handleWebSocketCommand(message: WsMessage): void {
    switch (message.type) {
        case 'exec':
            if (message.payload.command) ptyProcess?.write(`${message.payload.command}\n`);
            break;
        case 'chdir':
            if (message.payload.path) ptyProcess?.write(`cd "${message.payload.path}"\n`);
            break;
        default:
            console.error('Unknown WebSocket message type:', (message as WsMessage).type);
    }
}

function broadcastToWebSocketClients(data: string): void {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
    });
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.on('ready', () => {
    createWindow();
    setupWebSocketServer();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) createWindow();
});

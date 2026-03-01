/**
 * DeckTerm - An Electron-based terminal application with WebSocket support
 * This application creates a terminal interface that can be controlled both
 * through direct keyboard input and remote WebSocket commands.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import * as pty from 'node-pty';
import type { IPty, IDisposable } from 'node-pty';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';

// Constants
const DEFAULT_SHELL_WIN = 'C:\\WINDOWS\\system32\\cmd.exe';
const DEFAULT_SHELL_UNIX = 'bash';
const WS_PORT = 3000;

// Enable live reload in development mode
if (process.env.NODE_ENV === 'development') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('electron-reload')(path.join(__dirname, '..'), {
    electron: require(path.join(__dirname, '..', 'node_modules', 'electron'))
  });
}

// Disable hardware acceleration to prevent potential issues
app.disableHardwareAcceleration();

interface AppConfig {
  customPath: string;
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

/**
 * Loads the application configuration from the config file.
 */
function loadConfig(): AppConfig {
  try {
    const data = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(data) as AppConfig;
  } catch (err) {
    console.error('Failed to read config file:', err);
    return {
      customPath: os.platform() === 'win32' ? DEFAULT_SHELL_WIN : DEFAULT_SHELL_UNIX
    };
  }
}

// Handle reload shell session from renderer
ipcMain.on('terminal.reloadShell', (_event, { shellPath }: { shellPath: string }) => {
    reloadShell(shellPath);
});

/**
 * Scans common system paths for available shell executables.
 * Runs in the main process where Node.js fs/path access is safe.
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
    shellDefs.forEach(shellDef => {
        for (const shellPath of shellDef.paths) {
            try {
                if (fs.existsSync(shellPath)) {
                    foundShells.push({ name: shellDef.name, exePath: shellPath });
                    break;
                }
            } catch (e) { /* skip inaccessible paths */ }
        }
    });
    return foundShells;
}

// Handle shell list request from renderer
ipcMain.handle('shell.getShells', () => findShells());

const configPath = path.join(app.getPath('userData'), 'config.json');
const config = loadConfig();

let shell = config.customPath;
let wss: WebSocketServer;
let mainWindow: BrowserWindow | null;
let ptyProcess: IPty | null = null;
let dataDisposable: IDisposable | null = null;

const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');

/**
 * Loads saved window bounds from disk, falling back to sensible defaults.
 */
function loadWindowState(): WindowState {
  try {
    return JSON.parse(fs.readFileSync(windowStatePath, 'utf8')) as WindowState;
  } catch (e) {
    return { width: 800, height: 600, x: 0, y: 0 };
  }
}

/**
 * Persists the current window bounds to disk.
 */
function saveWindowState(window: BrowserWindow): void {
  if (!window.isDestroyed()) {
    const bounds = window.getBounds();
    fs.writeFileSync(windowStatePath, JSON.stringify(bounds));
  }
}

/**
 * Tears down the current pty and spawns a new one with the given shell.
 */
function reloadShell(newShellPath: string): void {
    shell = newShellPath;
    if (ptyProcess) {
        dataDisposable?.dispose();
        dataDisposable = null;
        ptyProcess.write('exit\r');
        try { ptyProcess.kill(); } catch (e) { /* ignore if already dead */ }
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

/**
 * Creates the main application window and initialises the terminal process.
 */
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
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

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

/**
 * Registers IPC handlers for terminal I/O and font size changes.
 */
function setupTerminalHandlers(): void {
    ipcMain.on('terminal.resize', (_event, size: { cols: number; rows: number }) => {
        ptyProcess?.resize(size.cols, size.rows);
    });

    // Handle keyboard input — also broadcast to any connected WebSocket clients
    ipcMain.on('terminal.keystroke', (_event, data: string) => {
        ptyProcess?.write(data);
        broadcastToWebSocketClients(data);
    });

    ipcMain.on('terminal.setFontSize', (_event, fontSize: number) => {
        console.log('Font size updated:', fontSize);
    });
}

/**
 * Pipes pty output to the renderer via IPC.
 */
function setupTerminalDataHandler(): void {
    dataDisposable = ptyProcess?.onData((data: string) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('terminal.incomingData', data);
        }
    }) ?? null;
}

/**
 * Starts the WebSocket server on WS_PORT and routes incoming commands.
 */
function setupWebSocketServer(): void {
    wss = new WebSocketServer({ port: WS_PORT });

    wss.on('connection', (ws) => {
        console.log('New WebSocket client connected');

        ws.on('message', (message) => {
            try {
                const command = JSON.parse(message.toString()) as { cmd: string; terminalcommand?: string; path?: string };
                handleWebSocketCommand(command);
            } catch (error) {
                console.error('Error processing WebSocket message:', error);
            }
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
    });
}

/**
 * Dispatches a parsed WebSocket command to the pty.
 */
function handleWebSocketCommand(command: { cmd: string; terminalcommand?: string; path?: string }): void {
    switch (command.cmd) {
        case 'command':
            if (command.terminalcommand) {
                ptyProcess?.write(`${command.terminalcommand}\n`);
            }
            break;

        case 'open':
            if (command.path) {
                ptyProcess?.write(`cd "${command.path}"\n`);
            }
            break;

        default:
            console.error('Unknown WebSocket command:', command.cmd);
    }
}

/**
 * Sends data to all connected WebSocket clients.
 */
function broadcastToWebSocketClients(data: string): void {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// Application event handlers
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

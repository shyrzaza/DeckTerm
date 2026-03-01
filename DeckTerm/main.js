/**
 * DeckTerm - An Electron-based terminal application with WebSocket support
 * This application creates a terminal interface that can be controlled both
 * through direct keyboard input and remote WebSocket commands.
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');

function reloadShell(newShellPath) {
    shell = newShellPath;
    if (ptyProcess) {
        ptyProcess.removeAllListeners(); // Remove all listeners
        ptyProcess.write('exit\r');
        try { ptyProcess.kill(); } catch (e) {}
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

const pty = require('node-pty');
const os = require('os');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

// Constants
const DEFAULT_SHELL_WIN = '"C:\\WINDOWS\\system32\\cmd.exe"';
const DEFAULT_SHELL_UNIX = 'bash';
const WS_PORT = 3000;

// Enable live reload in development mode
if (process.env.NODE_ENV === 'development') {
  require('electron-reload')(__dirname, {
    electron: require(`${__dirname}/node_modules/electron`)
  });
}

// Disable hardware acceleration to prevent potential issues
app.disableHardwareAcceleration();

/**
 * Loads the application configuration from the config file
 * @returns {Object} Configuration object containing shell path
 */
function loadConfig() {
  try {
    const data = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Failed to read config file:', err);
    // Fallback to default shell based on platform
    return {
      customPath: os.platform() === 'win32' ? DEFAULT_SHELL_WIN : DEFAULT_SHELL_UNIX
    };
  }
}

// Handle reload shell session from renderer
ipcMain.on('terminal.reloadShell', (event, { shellPath }) => {
    reloadShell(shellPath);
});

/**
 * Scans common system paths for available shell executables.
 * Runs in the main process where Node.js fs/path access is safe.
 * @returns {Array<{name: string, exePath: string}>}
 */
function findShells() {
    const shellDefs = [
        {
            name: 'PowerShell',
            paths: [
                path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
                path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'powershell.exe')
            ]
        },
        {
            name: 'Command Prompt',
            paths: [
                path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'cmd.exe')
            ]
        },
        {
            name: 'Git Bash',
            paths: [
                path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
                path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe')
            ]
        }
    ];

    const foundShells = [];
    shellDefs.forEach(shell => {
        for (const shellPath of shell.paths) {
            try {
                if (fs.existsSync(shellPath)) {
                    foundShells.push({ name: shell.name, exePath: shellPath });
                    break;
                }
            } catch (e) {}
        }
    });
    return foundShells;
}

// Handle shell list request from renderer (invoked via ipcRenderer.invoke)
ipcMain.handle('shell.getShells', () => findShells());


const configPath = path.join(app.getPath('userData'), 'config.json');
const config = loadConfig();

var shell = config.customPath;;
let wss;
let mainWindow;
let ptyProcess;


const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');

// Load window state
function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(windowStatePath, 'utf8'));
  } catch (e) {
    // Default size if file doesn't exist or is malformed
    return {
      width: 800,
      height: 600,
      x: 0,
      y: 0    
    };
  }
}

// Save window state
function saveWindowState(window) {
  if (!window.isDestroyed()) {
    const bounds = window.getBounds();
    fs.writeFileSync(windowStatePath, JSON.stringify(bounds));
  }
}


/**
 * Creates the main application window and initializes the terminal process
 */
function createWindow() {
    // Initialize window with saved dimensions and position
    const savedState = loadWindowState();
    mainWindow = new BrowserWindow({
        width: savedState.width,
        height: savedState.height,
        x: savedState.x,
        y: savedState.y,
        frame: false, // Disable default titlebar
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Configure window settings
    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadURL(`file://${__dirname}/index.html`);

    // Save window state before closing
    mainWindow.on('close', () => saveWindowState(mainWindow));
    mainWindow.on('closed', () => mainWindow = null);

    // Initialize terminal process with comfortable defaults
    ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 120, // Wider default for better visibility
        rows: 40,  // Taller default for more content
        cwd: process.env.HOME,
        env: process.env
    });

    // Set up terminal event handlers
    setupTerminalHandlers();
    setupTerminalDataHandler();

    // IPC handler for window controls
    ipcMain.on('window-control', (event, arg) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        switch (arg.action) {
            case 'minimize':
                mainWindow.minimize();
                break;
            case 'maximize-toggle':
                if (mainWindow.isMaximized()) {
                    mainWindow.unmaximize();
                } else {
                    mainWindow.maximize();
                }
                break;
            case 'close':
                mainWindow.close();
                break;
        }
    });
}

/**
 * Sets up terminal-related IPC and WebSocket event handlers
 */
function setupTerminalHandlers() {
    // Handle terminal resize events
    ipcMain.on('terminal.resize', (event, size) => {
        ptyProcess.resize(size.cols, size.rows);
    });

    // Handle keyboard input from renderer — also broadcast to any connected WebSocket clients
    ipcMain.on('terminal.keystroke', (event, data) => {
        ptyProcess.write(data);
        broadcastToWebSocketClients(data);
    });

    // Handle font size change from renderer
    ipcMain.on('terminal.setFontSize', (event, fontSize) => {
        // Optionally, you can resize the pty based on font size
        // For example, you could recalculate cols/rows here if needed
        // This is a placeholder for any logic you want to add
        // Example: store fontSize or log it
        console.log('Font size updated:', fontSize);
        // If you want to resize pty, you could do:
        // ptyProcess.resize(newCols, newRows);
    });
}

function setupTerminalDataHandler(){
        // Forward terminal output to renderer
    ptyProcess.on('data', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('terminal.incomingData', data);
        }
    });
}
/**
 * Sets up WebSocket server for remote terminal control
 */
function setupWebSocketServer() {
    wss = new WebSocket.Server({ port: WS_PORT });
    
    wss.on('connection', ws => {
        console.log('New WebSocket client connected');
        
        ws.on('message', async (message) => {
            try {
                const command = JSON.parse(message);
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
 * Handles incoming WebSocket commands
 * @param {Object} command - The parsed command object
 */
function handleWebSocketCommand(command) {
    switch (command.cmd) {
        case 'command':
            const terminalCommand = command.terminalcommand.toString('utf8');
            ptyProcess.write(`${terminalCommand}\n`);
            break;
            
        case 'open':
            const pathToOpen = command.path.toString('utf8');
            ptyProcess.write(`cd "${pathToOpen}"\n`);
            break;

        default:
            console.error('Unknown WebSocket command:', command.cmd);
    }
}

/**
 * Broadcasts a message to all connected WebSocket clients
 * @param {string} data - The data to broadcast
 */
function broadcastToWebSocketClients(data) {
    wss.clients.forEach(client => {
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

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () { 
    if (mainWindow === null) {
        createWindow();
    }
});
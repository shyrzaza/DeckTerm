
/**
 * DeckTerm - An Electron-based terminal application with WebSocket support
 * This application creates a terminal interface that can be controlled both
 * through direct keyboard input and remote WebSocket commands.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const pty = require('node-pty');
const os = require('os');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

// Constants
const DEFAULT_SHELL_WIN = 'C:\\Program Files\\Git\\bin\\bash.exe';
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
        webPreferences: {
            nodeIntegration: true,
            enableRemoteModule: true,
            contextIsolation: false,
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
}

/**
 * Sets up terminal-related IPC and WebSocket event handlers
 */
function setupTerminalHandlers() {
    // Handle terminal resize events
    ipcMain.on('terminal.resize', (event, size) => {
        ptyProcess.resize(size.cols, size.rows);
    });

    // Forward terminal output to renderer
    ptyProcess.on('data', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('terminal.incomingData', data);
        }
    });

    // Handle keyboard input from renderer
    ipcMain.on('terminal.keystroke', (event, data) => {
        ptyProcess.write(data);
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

    // Broadcast terminal keystrokes to all connected clients
    ipcMain.on('terminal.keystroke', (event, data) => {
        broadcastToWebSocketClients(data);
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
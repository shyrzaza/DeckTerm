/**
 * DeckTerm Terminal Renderer
 * Handles the terminal UI and communication with the main process
 */

const ipc = require('electron').ipcRenderer;

// Terminal configuration
const TERMINAL_OPTIONS = {
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: 14,
    fontFamily: 'Consolas, monospace',
    theme: {
        background: '#1E1E1E',
        foreground: '#D4D4D4'
    }
};

// Initialize terminal
const terminal = new Terminal(TERMINAL_OPTIONS);
const fitAddon = new FitAddon.FitAddon();

/**
 * Initializes the terminal UI and its addons
 */
function initializeTerminal() {
    terminal.loadAddon(fitAddon);
    terminal.open(document.getElementById('terminal'));
    fitAddon.fit();
    
    // Send initial dimensions to main process
    updateTerminalSize();
}

/**
 * Updates terminal size and notifies the main process
 */
function updateTerminalSize() {
    fitAddon.fit();
    ipc.send('terminal.resize', {
        cols: terminal.cols,
        rows: terminal.rows
    });
}

/**
 * Set up event handlers for terminal interaction
 */
function setupEventHandlers() {
    // Handle incoming data from the main process
    ipc.on('terminal.incomingData', (event, data) => {
        terminal.write(data);
    });

    // Handle terminal input
    terminal.onData((data) => {
        ipc.send('terminal.keystroke', data);
    });

    // Handle window resize
    window.addEventListener('resize', updateTerminalSize);
}

// Initialize the terminal interface
initializeTerminal();
setupEventHandlers();

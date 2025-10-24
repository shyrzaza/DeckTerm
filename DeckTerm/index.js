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


// --- Custom Titlebar Logic ---
// Window controls using IPC
document.getElementById('min-btn').addEventListener('click', () => {
    ipc.send('window-control', { action: 'minimize' });
});
document.getElementById('max-btn').addEventListener('click', () => {
    ipc.send('window-control', { action: 'maximize-toggle' });
});
document.getElementById('close-btn').addEventListener('click', () => {
    ipc.send('window-control', { action: 'close' });
});

// Dropdown menu logic
document.addEventListener('DOMContentLoaded', function() {
    const menuBtn = document.getElementById('menu-btn');
    const menuDropdown = document.getElementById('menu-dropdown');

    menuBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        menuDropdown.classList.toggle('show');
    });

    // Hide dropdown when clicking outside
    document.addEventListener('click', function(e) {
        if (menuDropdown.classList.contains('show')) {
            if (!menuDropdown.contains(e.target) && e.target !== menuBtn) {
                menuDropdown.classList.remove('show');
            }
        }
    });
});



// Initialize the terminal interface
initializeTerminal();
setupEventHandlers();

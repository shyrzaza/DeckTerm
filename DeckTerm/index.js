const path = require('path');
const fs = require('fs');

/**
 * Scans common Windows system paths for shell executables
 * Returns an array of objects: { name, exePath }
 */
function findShells() {
    // Common shell locations
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
/**
 * DeckTerm Terminal Renderer
 * Handles the terminal UI and communication with the main process
 */

const ipc = require('electron').ipcRenderer;

// Terminal configuration
let currentFontSize = 14;
const TERMINAL_OPTIONS = {
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: currentFontSize,
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

    // Handle CTRL + Scroll wheel for font size
    const terminalDiv = document.getElementById('terminal');
    terminalDiv.addEventListener('wheel', function(e) {
        if (e.ctrlKey) {
            e.preventDefault();
            if (e.deltaY < 0) {
                // Scroll up: increase font size
                currentFontSize = Math.min(currentFontSize + 1, 40);
            } else if (e.deltaY > 0) {
                // Scroll down: decrease font size
                currentFontSize = Math.max(currentFontSize - 1, 8);
            }
            terminal.options.fontSize = currentFontSize;
            fitAddon.fit();
        }
    });
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
function initializeDropdownMenu(options) {
    const menuBtn = document.getElementById('menu-btn');
    const menuDropdown = document.getElementById('menu-dropdown');

    let menuItems = [];
    let shellMap = {};
    if (options?.items) {
        menuItems = options.items;
    } else if (options?.shells) {
        menuItems = options.shells.map(shell => shell.name);
        shellMap = options.shells.reduce((acc, shell) => {
            acc[shell.name] = shell.exePath;
            return acc;
        }, {});
    } else {
        menuItems = [
            'Nothing available'
        ];
    }

    // Clear any existing items
    menuDropdown.innerHTML = '';

    // Dynamically create menu items
    menuItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'dropdown-item';
        div.textContent = item;
        // If this is a shell, add click handler to reload session
        if (shellMap[item]) {
            div.addEventListener('click', () => {
                menuDropdown.classList.remove('show');
                reloadShellSession(shellMap[item]);
            });
        }
        menuDropdown.appendChild(div);
    });

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
}
/**
 * Reloads the shell session in the terminal with the selected shell executable
 * @param {string} shellPath - Path to the shell executable
 */
function reloadShellSession(shellPath) {

    ipc.send('terminal.reloadShell', { shellPath });
    terminal.clear();
}

document.addEventListener('DOMContentLoaded', function() {
    const shells = findShells();
    initializeDropdownMenu({ shells });
});



// Initialize the terminal interface
initializeTerminal();
setupEventHandlers();

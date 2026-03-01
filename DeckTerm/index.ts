/**
 * DeckTerm Terminal Renderer
 * Handles the terminal UI and communication with the main process.
 *
 * This file is loaded as a plain <script> tag in index.html. It must NOT
 * contain top-level import/export statements — Node.js and CommonJS are not
 * available in the renderer (contextIsolation: true, nodeIntegration: false).
 * All main-process communication goes through window.electronAPI (preload.js).
 *
 * Terminal and FitAddon are UMD globals injected by the @xterm script tags.
 */

// ── Ambient declarations for UMD globals loaded via <script> tags ───────────

declare const Terminal: typeof import('@xterm/xterm').Terminal;
declare const FitAddon: { FitAddon: new () => import('@xterm/addon-fit').FitAddon };

// ── Window interface extension for the contextBridge API ────────────────────

interface Window {
    electronAPI: {
        sendResize: (cols: number, rows: number) => void;
        sendKeystroke: (data: string) => void;
        onIncomingData: (callback: (data: string) => void) => void;
        getShells: () => Promise<Array<{ name: string; exePath: string }>>;
        reloadShell: (shellPath: string) => void;
        minimize: () => void;
        maximizeToggle: () => void;
        close: () => void;
    };
}

// ── Terminal setup ───────────────────────────────────────────────────────────

let currentFontSize = 14;
const TERMINAL_OPTIONS = {
    cursorBlink: true,
    cursorStyle: 'block' as const,
    fontSize: currentFontSize,
    fontFamily: 'Consolas, monospace',
    theme: {
        background: '#1E1E1E',
        foreground: '#D4D4D4'
    }
};

const terminal = new Terminal(TERMINAL_OPTIONS);
const fitAddon = new FitAddon.FitAddon();

/**
 * Mounts the terminal in the DOM and loads its addons.
 */
function initializeTerminal(): void {
    terminal.loadAddon(fitAddon);
    terminal.open(document.getElementById('terminal')!);
    fitAddon.fit();
    updateTerminalSize();
}

/**
 * Recalculates terminal dimensions and sends them to the main process.
 */
function updateTerminalSize(): void {
    fitAddon.fit();
    window.electronAPI.sendResize(terminal.cols, terminal.rows);
}

/**
 * Wires up all event listeners for terminal I/O and window interactions.
 */
function setupEventHandlers(): void {
    // Pipe pty output to the terminal screen
    window.electronAPI.onIncomingData((data: string) => {
        terminal.write(data);
    });

    // Forward keystrokes to the pty
    terminal.onData((data: string) => {
        window.electronAPI.sendKeystroke(data);
    });

    // Refit on window resize
    window.addEventListener('resize', updateTerminalSize);

    // Ctrl + Scroll wheel to zoom font size
    const terminalDiv = document.getElementById('terminal')!;
    terminalDiv.addEventListener('wheel', (e: WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault();
            currentFontSize = e.deltaY < 0
                ? Math.min(currentFontSize + 1, 40)
                : Math.max(currentFontSize - 1, 8);
            terminal.options.fontSize = currentFontSize;
            fitAddon.fit();
        }
    });
}

// ── Custom titlebar ──────────────────────────────────────────────────────────

document.getElementById('min-btn')!.addEventListener('click', () => {
    window.electronAPI.minimize();
});
document.getElementById('max-btn')!.addEventListener('click', () => {
    window.electronAPI.maximizeToggle();
});
document.getElementById('close-btn')!.addEventListener('click', () => {
    window.electronAPI.close();
});

// ── Shell switcher dropdown ──────────────────────────────────────────────────

interface DropdownOptions {
    items?: string[];
    shells?: Array<{ name: string; exePath: string }>;
}

function initializeDropdownMenu(options: DropdownOptions): void {
    const menuBtn = document.getElementById('menu-btn')!;
    const menuDropdown = document.getElementById('menu-dropdown')!;

    let menuItems: string[] = [];
    const shellMap: Record<string, string> = {};

    if (options.items) {
        menuItems = options.items;
    } else if (options.shells) {
        menuItems = options.shells.map(s => s.name);
        options.shells.forEach(s => { shellMap[s.name] = s.exePath; });
    } else {
        menuItems = ['Nothing available'];
    }

    menuDropdown.innerHTML = '';

    menuItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'dropdown-item';
        div.textContent = item;
        if (shellMap[item]) {
            div.addEventListener('click', () => {
                menuDropdown.classList.remove('show');
                reloadShellSession(shellMap[item]);
            });
        }
        menuDropdown.appendChild(div);
    });

    menuBtn.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        menuDropdown.classList.toggle('show');
    });

    document.addEventListener('click', (e: MouseEvent) => {
        if (menuDropdown.classList.contains('show')) {
            if (!menuDropdown.contains(e.target as Node) && e.target !== menuBtn) {
                menuDropdown.classList.remove('show');
            }
        }
    });
}

/**
 * Restarts the pty with the chosen shell and clears the terminal screen.
 */
function reloadShellSession(shellPath: string): void {
    window.electronAPI.reloadShell(shellPath);
    terminal.clear();
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const shells = await window.electronAPI.getShells();
    initializeDropdownMenu({ shells });
});

initializeTerminal();
setupEventHandlers();

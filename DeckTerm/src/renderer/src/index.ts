/**
 * DeckTerm Renderer
 *
 * Handles the terminal UI and communication with the main process.
 * Bundled by Vite — ES module imports are fully supported here.
 * All main-process communication goes through window.electronAPI (preload).
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './styles.css';

// ── Type declaration for the contextBridge API ───────────────────────────────

declare global {
    interface Window {
        electronAPI: {
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
        };
    }
}

// ── Terminal setup ───────────────────────────────────────────────────────────

let currentFontSize = 14;

const terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: currentFontSize,
    fontFamily: 'Consolas, monospace',
    theme: {
        background: '#1E1E1E',
        foreground: '#D4D4D4'
    }
});

const fitAddon = new FitAddon();

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
 * Recalculates terminal dimensions and notifies the main process.
 */
function updateTerminalSize(): void {
    fitAddon.fit();
    window.electronAPI.sendResize(terminal.cols, terminal.rows);
}

/**
 * Wires up all event listeners for terminal I/O and window interactions.
 */
function setupEventHandlers(): void {
    window.electronAPI.onIncomingData((data) => {
        terminal.write(data);
    });

    terminal.onData((data) => {
        window.electronAPI.sendKeystroke(data);
    });

    window.addEventListener('resize', updateTerminalSize);

    // Ctrl + Scroll wheel to zoom font size
    document.getElementById('terminal')!.addEventListener('wheel', (e: WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault();
            currentFontSize = e.deltaY < 0
                ? Math.min(currentFontSize + 1, 40)
                : Math.max(currentFontSize - 1, 8);
            terminal.options.fontSize = currentFontSize;
            fitAddon.fit();
            window.electronAPI.saveFontSize(currentFontSize);
        }
    });
}

// ── Custom titlebar ──────────────────────────────────────────────────────────

document.getElementById('min-btn')!.addEventListener('click', () => window.electronAPI.minimize());
document.getElementById('max-btn')!.addEventListener('click', () => window.electronAPI.maximizeToggle());
document.getElementById('close-btn')!.addEventListener('click', () => window.electronAPI.close());

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
                window.electronAPI.reloadShell(shellMap[item]);
                terminal.clear();
            });
        }
        menuDropdown.appendChild(div);
    });

    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menuDropdown.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (menuDropdown.classList.contains('show')) {
            if (!menuDropdown.contains(e.target as Node) && e.target !== menuBtn) {
                menuDropdown.classList.remove('show');
            }
        }
    });
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const [shells, savedFontSize] = await Promise.all([
        window.electronAPI.getShells(),
        window.electronAPI.getFontSize()
    ]);
    currentFontSize = savedFontSize;
    terminal.options.fontSize = currentFontSize;
    initializeDropdownMenu({ shells });
});

initializeTerminal();
setupEventHandlers();

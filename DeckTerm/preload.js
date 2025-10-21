/**
 * DeckTerm Preload Script
 * Provides window management functionality to the renderer process
 */

const { remote } = require('electron');

// Get reference to the current window
const currentWindow = remote.BrowserWindow.getFocusedWindow();

/**
 * Expose window management functions to renderer process
 */
window.windowManager = {
    /**
     * Safely close the current window
     */
    closeWindow: () => {
        if (currentWindow && !currentWindow.isDestroyed()) {
            currentWindow.close();
        }
    },

    /**
     * Minimize the current window
     */
    minimizeWindow: () => {
        if (currentWindow && !currentWindow.isDestroyed()) {
            currentWindow.minimize();
        }
    },

    /**
     * Toggle window maximize state
     */
    toggleMaximize: () => {
        if (currentWindow && !currentWindow.isDestroyed()) {
            if (currentWindow.isMaximized()) {
                currentWindow.unmaximize();
            } else {
                currentWindow.maximize();
            }
        }
    }
};
# DeckTerm

A terminal emulator built with Electron that supports remote control via Streamdeck Plugin through WebSocket connections.

<img src="DeckTerm/build/DeckTerm.png" alt="DeckTerm Terminal" width="300">

## Features

- 🚀 Fast and responsive terminal emulation
- 🎨 Dark theme
- 🔄 Remote control capabilities via WebSocket
- 💾 Persistent window state and configuration
- 🖥️ Cross-platform support (Windows, macOS, Linux)
- 🎮 Stream Deck integration for quick command execution
- 🔌 Customizable Stream Deck actions

## Architecture

DeckTerm is built using three main components:

1. **Terminal UI (xterm.js)**
   - Provides the terminal interface
   - Handles text rendering and input capture
   - Supports terminal colors and formatting

2. **Shell Process (node-pty)**
   - Manages the actual terminal process
   - Supports various shells (Git Bash, cmd, bash, etc.)
   - Handles command execution

3. **Remote Control (WebSocket)**
   - Enables external control of the terminal
   - Allows sending commands remotely
   - Supports multiple client connections

# DeckTerm Application
## Installation

1. Install the DeckTerm application via one of the released installers

## Configuration

DeckTerm can be customized through a configuration file:

1. Create a `config.json` file at:
   - Windows: `%APPDATA%\DeckTerm\config.json`
   - macOS/Linux: `~/.config/DeckTerm/config.json`

2. Add your preferred shell configuration:
   ```json
   {
     "customPath": "C:\\Program Files\\Git\\bin\\bash.exe"
   }
   ```

Default paths:
- Windows: Git Bash (`"C:\\WINDOWS\\system32\\cmd.exe"`)
- macOS/Linux: Bash (`/bin/bash`)

# Stream Deck Integration

DeckTerm comes with a built-in Stream Deck plugin that makes it easy to control your terminal right from your Stream Deck device.

## Installing the Stream Deck Plugin

1. Find the plugin in the `StreamDeck SDK/deck-term/` directory
2. Double-click the `com.cedfro.deck-term.streamDeckPlugin` file to install
3. Stream Deck will automatically recognize the plugin

## Creating Custom Actions

1. Drag the DeckTerm action onto your Stream Deck
2. Configure the action with any terminal command:
   - Git commands: `git status`, `git pull`, `git push`
   - Directory navigation: `cd /your/path`
   - Custom shell commands: `npm start`, `docker ps`
   - Any valid terminal command!

## Example Use Cases

- One-click git operations
- Quick directory switching
- Project startup commands
- Server control (start/stop)
- Build commands
- Custom scripts

# WebSocket API

The Stream Deck plugin uses DeckTerm's WebSocket API (port 3000) to communicate with the terminal. You can also use this API for your own integrations:

```javascript
// Execute a command
{
    "cmd": "command",
    "terminalcommand": "git status"
}

// Change directory
{
    "cmd": "open",
    "path": "/path/to/directory"
}
```

This makes it easy to:
- Create your own custom integrations
- Automate terminal commands
- Control DeckTerm from other applications

## Development

Built with:
- Electron - Desktop application framework
- xterm.js - Terminal emulator
- node-pty - Shell process management
- WebSocket - Remote control capabilities

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
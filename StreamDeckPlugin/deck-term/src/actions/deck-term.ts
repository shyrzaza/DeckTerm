import streamDeck, { action, KeyDownEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { WebSocket } from "ws";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Returns the path to DeckTerm's ws-token.json, matching the userData
 * directory that Electron resolves for the app on each platform.
 */
function getTokenPath(): string {
    const platform = os.platform();
    if (platform === 'win32') {
        return path.join(process.env['APPDATA']!, 'DeckTerm', 'ws-token.json');
    } else if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'DeckTerm', 'ws-token.json');
    } else {
        return path.join(os.homedir(), '.config', 'DeckTerm', 'ws-token.json');
    }
}

/**
 * Reads the authentication token written by DeckTerm on startup.
 * Returns null if the file is missing or unreadable.
 */
function readToken(): string | null {
    try {
        const data = JSON.parse(fs.readFileSync(getTokenPath(), 'utf-8')) as { token?: string };
        return data.token ?? null;
    } catch {
        return null;
    }
}


@action({ UUID: "com.cedfro.deck-term.terminalcommand" })
export class TerminalCommandAction extends SingletonAction<TerminalCommandSettings> {
    override onWillAppear(ev: WillAppearEvent<TerminalCommandSettings>): void | Promise<void> {
        return ev.action.setTitle("Terminal Command");
    }

    override async onKeyDown(ev: KeyDownEvent<TerminalCommandSettings>): Promise<void> {
        const token = readToken();
        if (!token) {
            streamDeck.logger.error("DeckTerm: could not read auth token from", getTokenPath());
            return;
        }

        const ws = new WebSocket("ws://localhost:3000");

        ws.on("open", () => {
            const { terminalcommand = "" } = ev.payload.settings;

            // Authenticate first, then send the command.
            ws.send(JSON.stringify({ auth: token }));
            ws.send(JSON.stringify({ cmd: "command", terminalcommand }));
            ws.close();
        });

        ws.on("error", (err: unknown) => {
            streamDeck.logger.error("WebSocket error:", err);
        });
    }
}

type TerminalCommandSettings = {
    terminalcommand: string;
};


@action({ UUID: "com.cedfro.deck-term.openterminal" })
export class OpenTerminalAction extends SingletonAction<OpenGitBashSettings> {
    override onWillAppear(ev: WillAppearEvent<OpenGitBashSettings>): void | Promise<void> {
        return ev.action.setTitle("Open Terminal");
    }

    override async onKeyDown(ev: KeyDownEvent<OpenGitBashSettings>): Promise<void> {
        const token = readToken();
        if (!token) {
            streamDeck.logger.error("DeckTerm: could not read auth token from", getTokenPath());
            return;
        }

        const ws = new WebSocket("ws://localhost:3000");

        ws.on("open", () => {
            const { path: targetPath = "" } = ev.payload.settings;

            // Authenticate first, then send the command.
            ws.send(JSON.stringify({ auth: token }));
            ws.send(JSON.stringify({ cmd: "open", path: targetPath }));
            ws.close();
        });

        ws.on("error", (err: unknown) => {
            streamDeck.logger.error("WebSocket error:", err);
        });
    }
}

type OpenGitBashSettings = {
    path: string;
};

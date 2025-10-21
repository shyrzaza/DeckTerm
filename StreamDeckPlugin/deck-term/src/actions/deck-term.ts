import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { WebSocket } from "ws";


@action({ UUID: "com.cedfro.deck-term.terminalcommand" })
export class TerminalCommandAction extends SingletonAction<GitBashSettings> {
    override onWillAppear(ev: WillAppearEvent<GitBashSettings>): void | Promise<void> {
        return ev.action.setTitle("Terminal Command");
    }

    override async onKeyDown(ev: KeyDownEvent<GitBashSettings>): Promise<void> {
        // Connect to the WebSocket server
        const ws = new WebSocket("ws://localhost:3000");

        ws.on("open", () => {
            let { terminalcommand = "" } = ev.payload.settings;
            let cmd = "command";

            let message = JSON.stringify({
                cmd: cmd,
                terminalcommand: terminalcommand
            });


            ws.send(message);
            ws.close();
        });

        ws.on("error", (err:unknown) => {
            console.error("WebSocket error:", err);
        });
    }
}

type GitBashSettings = {
    terminalcommand: string;
};


@action({ UUID: "com.cedfro.deck-term.openterminal" })
export class OpenTerminalAction extends SingletonAction<OpenGitBashSettings> {
    override onWillAppear(ev: WillAppearEvent<OpenGitBashSettings>): void | Promise<void> {
        return ev.action.setTitle("Open Terminal");
    }

    override async onKeyDown(ev: KeyDownEvent<OpenGitBashSettings>): Promise<void> {
        // Connect to the WebSocket server
        const ws = new WebSocket("ws://localhost:3000");

        ws.on("open", () => {
            let { path = "" } = ev.payload.settings;
            let cmd = "open";

            let message = JSON.stringify({
                cmd: cmd,
                path: path
            });


            ws.send(message);
            ws.close();
        });

        ws.on("error", (err:unknown) => {
            console.error("WebSocket error:", err);
        });
    }
}

type OpenGitBashSettings = {
    path: string;
};

import { SERVER_PORT } from "../../shared/src/constants";
import { encode, decodeServer, type InputState, type RestoreState, type ServerMsg } from "../../shared/src/protocol";
import { isSolo } from "./mode";

export class Net {
  onMsg: (m: ServerMsg) => void = () => {};
  onClose: () => void = () => {};
  private ws: WebSocket | null = null;
  private worker: Worker | null = null;

  connect(): Promise<void> {
    if (isSolo) return this.connectSolo();
    const url = import.meta.env.DEV
      ? `ws://${location.hostname}:${SERVER_PORT}`
      : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("connection failed"));
      ws.onclose = () => this.onClose();
      ws.onmessage = (e) => {
        const msg = decodeServer(String(e.data));
        if (msg) this.onMsg(msg);
      };
    });
  }

  /** SOLO: the server is a web worker on this device; "network" is postMessage. */
  private connectSolo(): Promise<void> {
    return new Promise((resolve) => {
      const w = new Worker(new URL("./soloWorker.ts", import.meta.url), { type: "module" });
      this.worker = w;
      w.onerror = (e) => console.error("solo worker error:", e.message, e.filename, e.lineno);
      w.onmessage = (e: MessageEvent) => {
        const m = e.data as { t: string; data?: string };
        if (m.t === "ready") resolve();
        else if (m.t === "msg") {
          const msg = decodeServer(String(m.data));
          if (msg) {
            const g = globalThis as unknown as { __soloMsgs?: Record<string, number> };
            (g.__soloMsgs ??= {})[msg.t] = ((g.__soloMsgs[msg.t] ?? 0) as number) + 1;
            this.onMsg(msg);
          }
        } else if (m.t === "close") this.onClose();
      };
      w.postMessage({ t: "start" });
    });
  }

  sendHello(name: string, skin: string, key: string, restore?: RestoreState): void {
    this.send(encode({ t: "hello", name, skin, key, restore }));
  }

  sendInput(input: InputState): void {
    this.send(encode({ t: "input", input }));
  }

  sendUnstuck(): void {
    this.send(encode({ t: "unstuck" }));
  }

  sendPing(c: number): void {
    this.send(encode({ t: "ping", c }));
  }

  sendBlockEdit(x: number, y: number, z: number, b: number): void {
    this.send(encode({ t: "blockEdit", x, y, z, b }));
  }

  private send(data: string): void {
    if (this.worker) this.worker.postMessage({ t: "msg", data });
    else if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }
}

import { SERVER_PORT } from "../../shared/src/constants";
import { encode, decodeServer, type InputState, type ServerMsg } from "../../shared/src/protocol";

export class Net {
  onMsg: (m: ServerMsg) => void = () => {};
  onClose: () => void = () => {};
  private ws: WebSocket | null = null;

  connect(): Promise<void> {
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

  sendHello(name: string, car: string): void {
    this.send(encode({ t: "hello", name, car }));
  }

  sendInput(input: InputState): void {
    this.send(encode({ t: "input", input }));
  }

  private send(data: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }
}

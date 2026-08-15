import type { WebSocket as WsSocket } from "ws";
import { Game } from "../../server/src/game";

/**
 * SOLO worker: the ENTIRE authoritative game server — world gen, Rapier
 * physics, 49 bots, combat — running in a web worker inside the page. The
 * main thread's Net speaks to it over postMessage through a faked socket,
 * so the client code path is byte-identical to online play. Used by the
 * mobile APK and any `?solo` build; no network is ever touched.
 */
class FakeWs {
  /** Game.send/broadcast gate on `readyState === WebSocket.OPEN` (1). */
  readyState = 1;
  private handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  on(ev: string, cb: (...args: unknown[]) => void): void {
    const list = this.handlers.get(ev) ?? [];
    list.push(cb);
    this.handlers.set(ev, list);
  }
  deliver(ev: string, ...args: unknown[]): void {
    for (const cb of this.handlers.get(ev) ?? []) cb(...args);
  }
  // server → client
  send(data: string): void {
    postMessage({ t: "msg", data });
  }
  close(): void {
    postMessage({ t: "close" });
  }
}

let socket: FakeWs | null = null;

onmessage = (e: MessageEvent) => {
  const m = e.data as { t: string; data?: string };
  if (m.t === "start" && !socket) {
    console.log("[solo] worker booting…");
    // EXPLORE: peaceful solo planet exploration — just you, no bots
    Game.create({ explore: true, slots: 1 })
      .then((game) => {
        console.log("[solo] world ready");
        socket = new FakeWs();
        game.onConnection(socket as unknown as WsSocket);
        postMessage({ t: "ready" });
      })
      .catch((err) => {
        console.error("[solo] boot failed:", err);
        postMessage({ t: "close" });
      });
  } else if (m.t === "msg" && socket) {
    socket.deliver("message", m.data);
  }
};

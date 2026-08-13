// Browser shim for the `ws` package: the solo worker feeds Game.onConnection
// a faked duck-typed socket; real socket servers never start in a browser.
export class WebSocketServer {
  constructor() {
    throw new Error("WebSocketServer is not available in the browser");
  }
}
export const WebSocket = globalThis.WebSocket as unknown;

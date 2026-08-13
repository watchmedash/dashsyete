// Browser shim: player ids come from the platform WebCrypto.
export default {
  randomUUID: (): string => globalThis.crypto.randomUUID(),
};

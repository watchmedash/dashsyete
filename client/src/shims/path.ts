// Browser shim: minimal path ops for code bundled into the solo worker.
export default {
  dirname: (p: string): string => p.split(/[\\/]/).slice(0, -1).join("/") || ".",
  resolve: (...parts: string[]): string => parts.join("/"),
  join: (...parts: string[]): string => parts.join("/"),
  extname: (p: string): string => (p.includes(".") ? "." + p.split(".").pop() : ""),
};

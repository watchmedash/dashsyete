const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dashEditor", {
  /** Write the exported map JSON straight into shared/src/customMap.json. */
  saveCustomMap: (json) => ipcRenderer.invoke("save-custom-map", json),
});

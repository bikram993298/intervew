const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("auth", {
  submit: (username, password) => ipcRenderer.invoke("auth-submit", username, password),
  quit:   ()                   => ipcRenderer.invoke("auth-quit"),
});

const NATIVE_HOST_NAME = "com.ghostwriter.host";

let nativePort = null;

function warmUpServer() {
  // Kicks off the native messaging host, which ensures the local Ghost
  // Writer server is running (spawning it --managed if needed). No retry
  // logic here: Phase 2's idle timer inside the managed server handles
  // shutdown on its own, and the next connectNative() call (next toolbar
  // click, or next "sidebar" port connect) starts a fresh attempt anyway.
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    nativePort.onDisconnect.addListener(() => {
      console.log("Ghost Writer native host disconnected", chrome.runtime.lastError);
    });
  } catch (err) {
    console.log("Ghost Writer: failed to connect native host", err);
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  // Must await setOptions() before open() -- otherwise the two calls race
  // and the panel can load with the manifest's untagged default path
  // instead of the tab-scoped one, silently defeating the tab binding.
  await chrome.sidePanel.setOptions({ tabId: tab.id, path: `sidebar.html?tabId=${tab.id}`, enabled: true });
  chrome.sidePanel.open({ tabId: tab.id });
  warmUpServer();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "sidebar") {
    // Side panel was (re)opened without a fresh toolbar click (e.g. Chrome
    // restored it) — warm up the server here too.
    warmUpServer();
  }
});

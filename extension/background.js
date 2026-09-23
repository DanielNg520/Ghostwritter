chrome.action.onClicked.addListener((tab) => {
  // Both calls are fired without awaiting (awaiting risks losing the user
  // gesture open() needs). setOptions() goes first so a tab previously
  // disabled by the onActivated listener below is re-enabled before open().
  chrome.sidePanel.setOptions({ tabId: tab.id, path: `sidebar.html?tabId=${tab.id}`, enabled: true }).catch((err) => {
    console.log("Ghost Writer: sidePanel.setOptions() failed", err);
  });
  chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
    console.log("Ghost Writer: sidePanel.open() failed", err);
  });
});

// Stateless on purpose: the service worker is killed when idle, so an
// in-memory "bound tabs" set would be empty on wake-up and wrongly disable a
// bound tab. A tab is bound iff its per-tab options path carries its own id.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const { path } = await chrome.sidePanel.getOptions({ tabId });
    if (path && path.endsWith(`?tabId=${tabId}`)) return;
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
  } catch (err) {
    console.log("Ghost Writer: onActivated handler failed", err);
  }
});

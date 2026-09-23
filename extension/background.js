chrome.action.onClicked.addListener((tab) => {
  // open() must run synchronously within this click handler -- Chrome
  // requires it to be called inside the user-gesture call stack, and
  // awaiting setOptions() first risks losing that window. setOptions() is
  // fired right after instead: both calls reach Chrome's extension IPC in
  // the order sent, so the tab-scoped path lands before the panel content
  // actually renders, without blocking on the gesture-sensitive open().
  chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
    console.log("Ghost Writer: sidePanel.open() failed", err);
  });
  chrome.sidePanel.setOptions({ tabId: tab.id, path: `sidebar.html?tabId=${tab.id}`, enabled: true }).catch((err) => {
    console.log("Ghost Writer: sidePanel.setOptions() failed", err);
  });
});

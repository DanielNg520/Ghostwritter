// Generic page scraper for "General Writer" mode. Works on any site.
//
// This is injected via chrome.scripting.executeScript({ func: scrapePageContent })
// rather than being registered as a static content script, so it only needs the
// "activeTab" permission (already granted) instead of broad host_permissions.
//
// IMPORTANT: chrome.scripting requires the injected function to be fully
// self-contained (no references to outer closures/variables) since it is
// serialized and executed in the page's context. Keep this a pure function.
function scrapePageContent() {
  const title = document.title;

  const source =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.body;

  const clone = source.cloneNode(true);
  clone.querySelectorAll("script, style, nav, header, footer, noscript").forEach((el) => {
    el.remove();
  });

  // NOTE: clone is detached from the document, so `.innerText` (which needs
  // a rendered layout box) always returns "" here in Chrome. Use
  // `.textContent` and collapse whitespace ourselves instead.
  const raw = clone.textContent || "";
  const text = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000);

  return { title, text };
}

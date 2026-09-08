function scrapeProductData() {
  const title = document.querySelector("#productTitle")?.textContent.trim() ?? "";

  const featureBullets = document.querySelector("#feature-bullets");
  let details = "";

  if (featureBullets) {
    let items = featureBullets.querySelectorAll("ul li span.a-list-item");
    if (items.length === 0) {
      items = featureBullets.querySelectorAll("ul li");
    }

    details = Array.from(items)
      .map((item) => item.textContent.trim())
      .filter((text) => text.length > 0)
      .join("\n");
  }

  return { title, details };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "scrapeProductData") {
    sendResponse(scrapeProductData());
    return true;
  }
});

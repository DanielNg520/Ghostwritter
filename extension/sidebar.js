const commentInput = document.getElementById("comment");
const generateBtn = document.getElementById("generate-btn");
const loading = document.getElementById("loading");
const output = document.getElementById("output");
const statusMessage = document.getElementById("status-message");
const settingsBtn = document.getElementById("settings-btn");

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

generateBtn.addEventListener("click", async () => {
  statusMessage.textContent = "";
  generateBtn.disabled = true;
  loading.hidden = false;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const { title, details } = await chrome.tabs.sendMessage(tab.id, {
      action: "scrapeProductData",
    });

    const comment = commentInput.value;

    const { providerSettings } = await chrome.storage.local.get("providerSettings");
    const provider = providerSettings?.activeProvider ?? "agy";
    const apiKey =
      provider === "openrouter" ? providerSettings?.openrouter?.apiKey ?? "" :
      provider === "groq" ? providerSettings?.groq?.apiKey ?? "" :
      provider === "local" ? providerSettings?.local?.apiKey ?? "" : "";
    const model =
      provider === "openrouter" ? providerSettings?.openrouter?.model ?? "" :
      provider === "groq" ? providerSettings?.groq?.model ?? "" :
      provider === "local" ? providerSettings?.local?.model ?? "" : "";
    const endpoint =
      provider === "local" ? providerSettings?.local?.endpoint ?? "" : "";

    const response = await fetch("http://localhost:8000/generate-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_title: title,
        product_details: details,
        user_comment: comment,
        provider,
        api_key: apiKey,
        model,
        endpoint,
      }),
    });

    if (!response.ok) throw new Error("Request failed");

    const data = await response.json();
    output.value = data.review;
    if (data.provider_warning) {
      statusMessage.textContent = data.provider_warning;
    }
  } catch (err) {
    statusMessage.textContent = "Make sure the background server is running!";
  } finally {
    loading.hidden = true;
    generateBtn.disabled = false;
  }
});

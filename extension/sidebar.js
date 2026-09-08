// Tells background.js the side panel is open so it can warm up the local
// server via native messaging (covers panel restore without a fresh
// toolbar click; the toolbar click itself already triggers warm-up too).
try {
  chrome.runtime.connect({ name: "sidebar" });
} catch (err) {
  console.log("Ghost Writer: could not open sidebar port", err);
}

const commentInput = document.getElementById("comment");
const generateBtn = document.getElementById("generate-btn");
const loading = document.getElementById("loading");
const output = document.getElementById("output");
const statusMessage = document.getElementById("status-message");
const settingsBtn = document.getElementById("settings-btn");

const modeReviewBtn = document.getElementById("mode-review-btn");
const modeGeneralBtn = document.getElementById("mode-general-btn");
const reviewSection = document.getElementById("review-section");
const generalSection = document.getElementById("general-section");
const categorySelect = document.getElementById("category-select");
const promptInput = document.getElementById("prompt");

let currentMode = "review"; // "review" | "general"

function setMode(mode) {
  currentMode = mode;
  const isReview = mode === "review";

  reviewSection.hidden = !isReview;
  generalSection.hidden = isReview;

  modeReviewBtn.classList.toggle("active", isReview);
  modeGeneralBtn.classList.toggle("active", !isReview);

  generateBtn.textContent = isReview ? "Generate Review" : "Generate Writing";
}

modeReviewBtn.addEventListener("click", () => setMode("review"));
modeGeneralBtn.addEventListener("click", () => setMode("general"));

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// Shared provider/api-key/model/endpoint lookup used by both modes.
async function getProviderSettings() {
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

  return { provider, apiKey, model, endpoint };
}

async function generateReview() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { title, details } = await chrome.tabs.sendMessage(tab.id, {
    action: "scrapeProductData",
  });

  const comment = commentInput.value;
  const { provider, apiKey, model, endpoint } = await getProviderSettings();

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
}

async function generateWriting() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scrapePageContent,
  });
  const { title, text } = results[0].result;

  const prompt = promptInput.value;
  const category = categorySelect.value;
  const { provider, apiKey, model, endpoint } = await getProviderSettings();

  const response = await fetch("http://localhost:8000/generate-writing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      page_title: title,
      page_text: text,
      user_prompt: prompt,
      category,
      provider,
      api_key: apiKey,
      model,
      endpoint,
    }),
  });

  if (!response.ok) throw new Error("Request failed");

  const data = await response.json();
  output.value = data.writing;
  if (data.provider_warning) {
    statusMessage.textContent = data.provider_warning;
  }
}

generateBtn.addEventListener("click", async () => {
  statusMessage.textContent = "";
  generateBtn.disabled = true;
  loading.hidden = false;

  try {
    if (currentMode === "review") {
      await generateReview();
    } else {
      await generateWriting();
    }
  } catch (err) {
    statusMessage.textContent = "Make sure the background server is running!";
  } finally {
    loading.hidden = true;
    generateBtn.disabled = false;
  }
});

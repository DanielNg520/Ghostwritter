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
const progressFill = document.getElementById("progress-fill");
const progressEta = document.getElementById("progress-eta");

// No streaming endpoint exists server-side, so there's no real completion
// percentage to report. Instead we keep a rolling history of how long past
// generations actually took (per mode, since review/general have different
// prompt shapes) and animate the bar against that estimate, capped short of
// 100% until the response actually lands. Falls back to a generic default
// estimate until enough history exists.
const DEFAULT_ESTIMATE_MS = 12000;
const HISTORY_LIMIT = 8;

async function getDurationEstimate(mode) {
  const { genDurations } = await chrome.storage.local.get("genDurations");
  const history = genDurations?.[mode];
  if (!history || history.length === 0) return DEFAULT_ESTIMATE_MS;
  return history.reduce((sum, ms) => sum + ms, 0) / history.length;
}

async function recordDuration(mode, durationMs) {
  const { genDurations } = await chrome.storage.local.get("genDurations");
  const history = genDurations?.[mode] ?? [];
  history.push(durationMs);
  if (history.length > HISTORY_LIMIT) history.shift();
  await chrome.storage.local.set({
    genDurations: { ...genDurations, [mode]: history },
  });
}

let progressTimer = null;

async function startProgress(mode) {
  const estimateMs = await getDurationEstimate(mode);
  const startTime = Date.now();
  progressFill.style.width = "0%";
  progressEta.textContent = "";

  progressTimer = setInterval(() => {
    const elapsed = Date.now() - startTime;

    if (elapsed < estimateMs) {
      // On pace: fill toward 90% by the estimated finish time, with a real
      // countdown — this part of the estimate is trustworthy.
      progressFill.style.width = `${(elapsed / estimateMs) * 90}%`;
      progressEta.textContent = `~${Math.round((estimateMs - elapsed) / 1000)}s left`;
      return;
    }

    // Past the estimate: review mode's refine loop can legitimately chain
    // several more slow agy calls, so there's no real ETA left to show.
    // Creep the bar asymptotically toward 99% instead of claiming "almost
    // done" — a flat, honest "still working" beats a false countdown that
    // makes a slow-but-healthy request look hung.
    const overrun = elapsed - estimateMs;
    progressFill.style.width = `${99 - 9 * Math.exp(-overrun / 20000)}%`;
    const elapsedSec = Math.round(elapsed / 1000);
    progressEta.textContent = `still working… (${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s)`;
  }, 150);

  return startTime;
}

function stopProgress(startTime, mode, succeeded) {
  clearInterval(progressTimer);
  progressTimer = null;
  progressEta.textContent = "";
  if (succeeded) {
    progressFill.style.width = "100%";
    recordDuration(mode, Date.now() - startTime);
  } else {
    progressFill.style.width = "0%";
  }
}

const modeReviewBtn = document.getElementById("mode-review-btn");
const modeGeneralBtn = document.getElementById("mode-general-btn");
const reviewSection = document.getElementById("review-section");
const generalSection = document.getElementById("general-section");
const categorySelect = document.getElementById("category-select");
const promptInput = document.getElementById("prompt");
const providerSelect = document.getElementById("provider-select");

// agy/claude_code are local CLIs, always usable. openrouter/groq/local need
// credentials — either saved in this extension's Settings page, or (for
// openrouter/groq only) a default from the server's encrypted secrets file.
// Populates the quick-switcher with only what's actually usable right now,
// so picking an option never silently falls back to something else.
async function initProviderSelect() {
  const { providerSettings, serverProviderDefaults } = await chrome.storage.local.get([
    "providerSettings",
    "serverProviderDefaults",
  ]);

  // The server is usually still cold-starting (native-messaging warm-up is
  // async) right when this runs on panel open, so a failed fetch here does
  // NOT mean openrouter/groq are actually unconfigured — fall back to the
  // last known-good result instead of guessing false, or a real credential
  // would flicker "not set up" and get silently swapped back to agy on
  // almost every panel open.
  let serverDefaults = serverProviderDefaults ?? { openrouter: false, groq: false };
  try {
    const res = await fetch("http://localhost:8000/provider-defaults");
    if (res.ok) {
      serverDefaults = await res.json();
      chrome.storage.local.set({ serverProviderDefaults: serverDefaults });
    }
  } catch {
    // Server unreachable right now — use the cached result from last time.
  }

  const available = {
    agy: true,
    claude_code: true,
    openrouter: !!(providerSettings?.openrouter?.apiKey && providerSettings?.openrouter?.model) || !!serverDefaults.openrouter,
    groq: !!(providerSettings?.groq?.apiKey && providerSettings?.groq?.model) || !!serverDefaults.groq,
    local: !!(providerSettings?.local?.endpoint && providerSettings?.local?.model),
  };

  for (const option of providerSelect.options) {
    const isAvailable = available[option.value] ?? false;
    option.disabled = !isAvailable;
    option.textContent = option.textContent.replace(/ — not set up$/, "") + (isAvailable ? "" : " — not set up");
  }

  const saved = providerSettings?.activeProvider;
  providerSelect.value = available[saved] ? saved : "agy";
}

providerSelect.addEventListener("change", async () => {
  const { providerSettings } = await chrome.storage.local.get("providerSettings");
  await chrome.storage.local.set({
    providerSettings: { ...providerSettings, activeProvider: providerSelect.value },
  });
});

initProviderSelect();

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

// Shared provider/api-key/model/endpoint lookup used by both modes. The
// quick-switcher (#provider-select) is the source of truth for *which*
// provider to use — it's kept in sync with chrome.storage on every change
// (see initProviderSelect() above), but reading it directly here means a
// mid-session switch takes effect on the very next click with no reload.
async function getProviderSettings() {
  const { providerSettings } = await chrome.storage.local.get("providerSettings");
  const provider = providerSelect.value || providerSettings?.activeProvider || "agy";
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

  if (!response.ok) throw new Error(await extractErrorDetail(response));

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

  if (!response.ok) throw new Error(await extractErrorDetail(response));

  const data = await response.json();
  output.value = data.writing;
  if (data.provider_warning) {
    statusMessage.textContent = data.provider_warning;
  }
}

// Pulls FastAPI's {"detail": "..."} out of a non-ok response so the status
// message can show what actually went wrong, instead of a generic string.
async function extractErrorDetail(response) {
  try {
    const data = await response.json();
    if (data?.detail) return data.detail;
  } catch {
    // response body wasn't JSON — fall through to the generic message below
  }
  return `Request failed (HTTP ${response.status})`;
}

generateBtn.addEventListener("click", async () => {
  statusMessage.textContent = "";
  generateBtn.disabled = true;
  loading.hidden = false;
  const startTime = await startProgress(currentMode);

  try {
    if (currentMode === "review") {
      await generateReview();
    } else {
      await generateWriting();
    }
    stopProgress(startTime, currentMode, true);
  } catch (err) {
    stopProgress(startTime, currentMode, false);
    // A fetch()-level network failure (server unreachable) throws a bare
    // TypeError with no useful message; every other failure — a non-ok HTTP
    // response, or chrome.tabs.sendMessage rejecting when not on an Amazon
    // page — carries a real message worth showing instead of guessing.
    statusMessage.textContent =
      err instanceof TypeError
        ? "Make sure the background server is running!"
        : err.message;
  } finally {
    setTimeout(() => {
      loading.hidden = true;
    }, 200);
    generateBtn.disabled = false;
  }
});

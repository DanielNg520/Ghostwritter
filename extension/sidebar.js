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
const exportPdfBtn = document.getElementById("export-pdf-btn");

const boundTabId = (() => {
  const match = new URLSearchParams(location.search).get("tabId");
  if (!match) return null;
  const parsed = Number(match);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
})();

// A panel can end up here without a ?tabId= if it wasn't opened via the
// toolbar click (e.g. Chrome's own side-panel switcher, which uses the
// manifest's untagged default path) — scrapeActiveTab()/generateReview()
// already refuse to act in that case, so explain why instead of leaving
// the panel silently inert.
if (boundTabId === null) {
  statusMessage.textContent = "Open Ghost Writer from the toolbar icon on the tab you want to use.";
}

// The server runs generation as a background job (POST .../start returns a
// job_id) and reports its actual pipeline stage on each poll, so the bar
// reflects real state — never a time-based guess. Stage order matches
// server.py's _run_review_job/_run_writing_job: an initial "writing" call,
// then "scoring" (ai_score), then — only if the score's still too AI-sounding
// — "rewriting" and back to "scoring" again, up to max_attempts times.
const STAGE_LABELS = {
  writing: "Writing",
  scoring: "Checking AI score",
  rewriting: "Rewriting",
};
const STAGE_FILL_PCT = { writing: 15, scoring: 50, rewriting: 80 };
const POLL_INTERVAL_MS = 500;

function renderStage(stage, attempt, maxAttempts) {
  progressFill.style.width = `${STAGE_FILL_PCT[stage] ?? 15}%`;
  const label = STAGE_LABELS[stage] ?? stage;
  progressEta.textContent = attempt > 0 ? `${label} (attempt ${attempt}/${maxAttempts})…` : `${label}…`;
}

function resetProgress() {
  progressFill.style.width = "0%";
  progressEta.textContent = "";
}

// Starts the job, polls its real progress until the server reports it done,
// and returns the final result payload (or throws, same as a plain fetch).
async function runJob(kind, payload) {
  const startRes = await fetch(`http://localhost:8000/generate-${kind}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!startRes.ok) throw new Error(await extractErrorDetail(startRes));
  const { job_id } = await startRes.json();

  while (true) {
    const res = await fetch(`http://localhost:8000/generate-${kind}/progress/${job_id}`);
    if (!res.ok) throw new Error(await extractErrorDetail(res));
    const data = await res.json();
    if (data.done) {
      progressFill.style.width = "100%";
      return data;
    }
    renderStage(data.stage, data.attempt, data.max_attempts);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

const modeReviewBtn = document.getElementById("mode-review-btn");
const modeGeneralBtn = document.getElementById("mode-general-btn");
const reviewSection = document.getElementById("review-section");
const generalSection = document.getElementById("general-section");
const categorySelect = document.getElementById("category-select");
const employerInput = document.getElementById("employer-input");
const promptInput = document.getElementById("prompt");
const providerSelect = document.getElementById("provider-select");

// Fetches the real category list from the same /samples endpoint used
// elsewhere, and fills #category-select with it. Falls back to a plain
// "Could not load categories" message when the server is unreachable.
async function populateCategorySelect() {
  try {
    const res = await fetch("http://localhost:8000/samples");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Server sends categories in its own intended display order (see
    // list_sample_categories()) -- Object.keys() preserves that insertion
    // order for string keys, so don't re-sort it alphabetically here.
    const categories = Object.keys(data.categories);
    categorySelect.replaceChildren();

    for (const category of categories) {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = capitalizeCategory(category);
      categorySelect.appendChild(option);
    }
  } catch {
    categorySelect.replaceChildren();
    const option = document.createElement("option");
    option.value = "";
    option.disabled = true;
    option.selected = true;
    option.textContent = "Could not load categories — check the server";
    categorySelect.appendChild(option);
  }
}

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

// Shared by detectJobPageAndConfigure() and generateWriting(): finds the
// bound tab and runs scrapePageContent in it. Returns null instead of
// throwing when the tab isn't scriptable (chrome://, no activeTab grant
// left after a tab switch, etc.) — callers decide whether that's fatal.
async function scrapeActiveTab() {
  if (boundTabId === null) return null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: boundTabId },
      func: scrapePageContent,
    });
    return results[0]?.result ?? null;
  } catch {
    return null;
  }
}

// Runs once when the panel opens, using the activeTab grant from the
// toolbar click that opened it. Detects a job posting (via
// scrapePageContent's siteType) and switches the panel straight to
// Cover Letter mode so opening a job page and hitting Generate "just
// works" without manually flipping mode/category first. Best-effort:
// fails silently on tabs it can't script — the panel just stays on its
// defaults.
async function detectJobPageAndConfigure() {
  try {
    const scraped = await scrapeActiveTab();
    if (scraped?.siteType !== "job") return;

    setMode("general");
    if ([...categorySelect.options].some((option) => option.value === "cover_letter")) {
      categorySelect.value = "cover_letter";
    }
    if (!promptInput.value.trim()) {
      promptInput.value = "Write a tailored cover letter for this job based on the job description above.";
    }
    statusMessage.textContent = "Job posting detected — switched to Cover Letter mode.";
  } catch {
    // Not scriptable right now — leave the panel on its current mode/category.
  }
}

// Populate the real category list first so detectJobPageAndConfigure() can
// reliably check for "cover_letter", then run the job-page detection.
async function initPanel() {
  await populateCategorySelect();
  await detectJobPageAndConfigure();
}

initPanel();

let currentMode = "review"; // "review" | "general"

function setMode(mode) {
  currentMode = mode;
  const isReview = mode === "review";

  reviewSection.hidden = !isReview;
  generalSection.hidden = isReview;

  modeReviewBtn.classList.toggle("active", isReview);
  modeGeneralBtn.classList.toggle("active", !isReview);

  generateBtn.textContent = isReview ? "Generate Review" : "Generate Writing";

  if (isReview) {
    exportPdfBtn.hidden = true;
  }
}

modeReviewBtn.addEventListener("click", () => setMode("review"));
modeGeneralBtn.addEventListener("click", () => setMode("general"));

// A cover letter's PDF is only valid for the category it was generated
// under -- switching category without regenerating must not leave a stale
// export available for the new (unmatched) category.
categorySelect.addEventListener("change", () => {
  exportPdfBtn.hidden = true;
});

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
  if (boundTabId === null) {
    throw new Error("This panel isn't bound to a tab — reopen it from the toolbar icon.");
  }
  const { title, details } = await chrome.tabs.sendMessage(boundTabId, {
    action: "scrapeProductData",
  });

  const comment = commentInput.value;
  const { provider, apiKey, model, endpoint } = await getProviderSettings();

  const data = await runJob("review", {
    product_title: title,
    product_details: details,
    user_comment: comment,
    provider,
    api_key: apiKey,
    model,
    endpoint,
  });

  output.value = data.review;
  if (data.provider_warning) {
    statusMessage.textContent = data.provider_warning;
  }
}

async function generateWriting() {
  const scraped = await scrapeActiveTab();
  if (!scraped) throw new Error("Could not read the current page — try a different tab.");
  const { title, text, employer } = scraped;

  employerInput.value = employer || "";

  const prompt = promptInput.value;
  const category = categorySelect.value;
  const { provider, apiKey, model, endpoint } = await getProviderSettings();

  const data = await runJob("writing", {
    page_title: title,
    page_text: text,
    user_prompt: prompt,
    category,
    provider,
    api_key: apiKey,
    model,
    endpoint,
  });

  output.value = data.writing;
  if (data.provider_warning) {
    statusMessage.textContent = data.provider_warning;
  }

  if (category === "cover_letter" && data.writing) {
    exportPdfBtn.hidden = false;
  }
}

async function exportCoverLetterPdf() {
  const employer = employerInput.value.trim();
  const body = output.value.trim();
  if (!body) {
    statusMessage.textContent = "Nothing to export yet — generate a cover letter first.";
    return;
  }

  const { profileInfo } = await chrome.storage.local.get("profileInfo");
  const profile = profileInfo ?? {};

  const doc = new jspdf.jsPDF();
  const margin = 20;
  const bottomMargin = 20;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const textWidth = pageWidth - margin * 2;
  let y = margin;

  const lineHeight = 6;
  const paragraphGap = 8;

  // Wraps to textWidth (using whatever font/size is active on doc right
  // now) and paginates, same as the body text below -- a long address,
  // LinkedIn URL, or employer name must not run past the right margin.
  function drawWrapped(text, startY) {
    const wrapped = doc.splitTextToSize(text, textWidth);
    let localY = startY;
    for (const wLine of wrapped) {
      if (localY + lineHeight > pageHeight - bottomMargin) {
        doc.addPage();
        localY = margin;
      }
      doc.text(wLine, margin, localY);
      localY += lineHeight;
    }
    return localY;
  }

  if (profile.name) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    y = drawWrapped(profile.name, y) + 2;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  const addressParts = [];
  if (profile.address) addressParts.push(profile.address);
  const cityLine = [profile.city, profile.state, profile.zip].filter(Boolean).join(" ");
  if (cityLine) addressParts.push(cityLine);

  for (const part of addressParts) {
    y = drawWrapped(part, y);
  }

  if (profile.phone) {
    y = drawWrapped(profile.phone, y);
  }
  if (profile.email) {
    y = drawWrapped(profile.email, y);
  }
  if (profile.linkedin) {
    y = drawWrapped(profile.linkedin, y);
  }

  y += paragraphGap;

  const today = new Date();
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const dateStr = `${months[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`;
  y = drawWrapped(dateStr, y) + paragraphGap;

  if (employer) {
    y = drawWrapped(employer, y);
  }

  y += paragraphGap;

  const lines = doc.splitTextToSize(body, textWidth);
  for (const line of lines) {
    if (y + lineHeight > pageHeight - bottomMargin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }

  const safeEmployer = (employer || "Cover Letter")
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  doc.save(`${safeEmployer} - Cover Letter.pdf`);
}

exportPdfBtn.addEventListener("click", exportCoverLetterPdf);

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
  resetProgress();
  exportPdfBtn.hidden = true;

  try {
    if (currentMode === "review") {
      await generateReview();
    } else {
      await generateWriting();
    }
  } catch (err) {
    resetProgress();
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

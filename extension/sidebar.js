import { listSampleCategories, readSamplesText } from './lib/samples_store.js';
import { buildContext, buildTextPrompt, buildGeneralistPrompt } from './lib/prompt_builders.js';
import { runGenerationPipeline, MAX_REFINE_ATTEMPTS } from './lib/generation_pipeline.js';

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

// A panel can end up here without a ?tabId= if it wasn't opened via a
// fresh toolbar click -- most commonly Chrome restoring a previously-open
// panel on browser relaunch, which does not replay the click.
// resolveTargetTabId() falls back to querying the current active
// tab in that case, same as this extension did before per-tab binding
// existed -- less strict than boundTabId (a fallback panel does briefly
// re-expose the "acts on whichever tab is active" behavior the binding
// was added to close), but functional is better than inert: a panel that
// refuses to do anything until manually reopened is a worse regression
// for every existing feature (Review mode included) than the narrow
// cross-tab edge case this closes for the common, freshly-opened case.
async function resolveTargetTabId() {
  if (boundTabId !== null) return boundTabId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

// runGenerationPipeline() (lib/generation_pipeline.js) reports its real
// pipeline stage via the onStage callback, so the bar reflects actual
// progress — never a time-based guess. Stage order: an initial "writing"
// call, then "scoring" (aiScore), then — only if the score's still too
// AI-sounding — "rewriting" and back to "scoring" again, up to
// MAX_REFINE_ATTEMPTS times.
const STAGE_LABELS = {
  writing: "Writing",
  scoring: "Checking AI score",
  rewriting: "Rewriting",
};
const STAGE_FILL_PCT = { writing: 15, scoring: 50, rewriting: 80 };

function renderStage(stage, attempt, maxAttempts) {
  progressFill.style.width = `${STAGE_FILL_PCT[stage] ?? 15}%`;
  const label = STAGE_LABELS[stage] ?? stage;
  progressEta.textContent = attempt > 0 ? `${label} (attempt ${attempt}/${maxAttempts})…` : `${label}…`;
}

function resetProgress() {
  progressFill.style.width = "0%";
  progressEta.textContent = "";
}

const modeReviewBtn = document.getElementById("mode-review-btn");
const modeGeneralBtn = document.getElementById("mode-general-btn");
const reviewSection = document.getElementById("review-section");
const generalSection = document.getElementById("general-section");
const categorySelect = document.getElementById("category-select");
const employerInput = document.getElementById("employer-input");
const promptInput = document.getElementById("prompt");
const providerSelect = document.getElementById("provider-select");

// Fetches the real category list from lib/samples_store.js (chrome.storage-
// backed, the same source settings.js's sample panels use) and fills
// #category-select with it.
async function populateCategorySelect() {
  const categories = await listSampleCategories();
  categorySelect.replaceChildren();

  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = capitalizeCategory(category);
    categorySelect.appendChild(option);
  }
}

// openrouter/groq/local all need credentials saved in this extension's
// Settings page. Populates the quick-switcher with only what's actually
// usable right now, so picking an option never silently falls back to
// something else.
async function initProviderSelect() {
  const { providerSettings } = await chrome.storage.local.get(["providerSettings"]);

  const available = {
    openrouter: !!(providerSettings?.openrouter?.apiKey && providerSettings?.openrouter?.model),
    groq: !!(providerSettings?.groq?.apiKey && providerSettings?.groq?.model),
    local: !!(providerSettings?.local?.endpoint && providerSettings?.local?.model),
  };

  for (const option of providerSelect.options) {
    const isAvailable = available[option.value] ?? false;
    option.disabled = !isAvailable;
    option.textContent = option.textContent.replace(/ — not set up$/, "") + (isAvailable ? "" : " — not set up");
  }

  const saved = providerSettings?.activeProvider;
  providerSelect.value = available[saved] ? saved : "openrouter";
}

providerSelect.addEventListener("change", async () => {
  const { providerSettings } = await chrome.storage.local.get("providerSettings");
  await chrome.storage.local.set({
    providerSettings: { ...providerSettings, activeProvider: providerSelect.value },
  });
});

initProviderSelect();

// Shared by detectJobPageAndConfigure() and generateWriting(): resolves
// the target tab via resolveTargetTabId() (bound tab, or the active-tab
// fallback) and runs scrapePageContent in it. Returns null instead of
// throwing when there's no target tab, or it isn't scriptable (chrome://,
// no activeTab grant left after a tab switch, etc.) — callers decide
// whether that's fatal.
async function scrapeActiveTab() {
  const tabId = await resolveTargetTabId();
  if (tabId === null) return null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
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
  const provider = providerSelect.value || providerSettings?.activeProvider || "openrouter";
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
  const tabId = await resolveTargetTabId();
  if (tabId === null) {
    throw new Error("Could not find a tab to read — try reopening the panel from the toolbar icon.");
  }
  const { title, details } = await chrome.tabs.sendMessage(tabId, {
    action: "scrapeProductData",
  });

  const comment = commentInput.value;
  const { provider, apiKey, model, endpoint } = await getProviderSettings();
  const config = { apiKey, model, endpoint };

  const { rulesText, memoryText, personalizationText } = await chrome.storage.local.get(["rulesText", "memoryText", "personalizationText"]);
  const contextBlock = buildContext(rulesText || "", memoryText || "", personalizationText || "");

  const samplesText = await readSamplesText("review");

  const prompt = buildTextPrompt(title, details, comment, contextBlock, samplesText);

  const { text } = await runGenerationPipeline({
    prompt,
    contextBlock,
    provider,
    config,
    onStage: (stage, attempt) => renderStage(stage, attempt ?? 0, MAX_REFINE_ATTEMPTS),
  });

  output.value = text;
  progressFill.style.width = "100%";
}

async function generateWriting() {
  const scraped = await scrapeActiveTab();
  if (!scraped) throw new Error("Could not read the current page — try a different tab.");
  const { title, text: pageText, employer } = scraped;

  employerInput.value = employer || "";

  const userPrompt = promptInput.value;
  const category = categorySelect.value;
  const { provider, apiKey, model, endpoint } = await getProviderSettings();
  const config = { apiKey, model, endpoint };

  const { rulesText, memoryText, personalizationText } = await chrome.storage.local.get(["rulesText", "memoryText", "personalizationText"]);
  const contextBlock = buildContext(rulesText || "", memoryText || "", personalizationText || "");

  const samplesText = await readSamplesText(category);

  const prompt = buildGeneralistPrompt(title, pageText, userPrompt, category, contextBlock, samplesText);

  const { text: resultText } = await runGenerationPipeline({
    prompt,
    contextBlock,
    provider,
    config,
    onStage: (stage, attempt) => renderStage(stage, attempt ?? 0, MAX_REFINE_ATTEMPTS),
  });

  output.value = resultText;
  progressFill.style.width = "100%";

  if (category === "cover_letter" && resultText) {
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

// A module script's top-level function declarations aren't attached to
// `window` the way a classic script's are (unlike before sidebar.js became
// a module) — tests/browser/smoke_test.py drives these directly via
// page.evaluate(), so they need an explicit hook.
window.scrapeActiveTab = scrapeActiveTab;
window.exportCoverLetterPdf = exportCoverLetterPdf;

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
        ? "Network error — check your connection and provider settings."
        : err.message;
  } finally {
    setTimeout(() => {
      loading.hidden = true;
    }, 200);
    generateBtn.disabled = false;
  }
});

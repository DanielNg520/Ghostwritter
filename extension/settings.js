import { listSampleCategories, listSamples, saveSample, deleteSample } from './lib/samples_store.js';

const generationProviderSelect = document.getElementById('generation-provider-select');
const scoringProviderSelect = document.getElementById('scoring-provider-select');
const localEndpoint = document.getElementById('local-endpoint');
const localModel = document.getElementById('local-model');
const localEffort = document.getElementById('local-effort');
const localApiKey = document.getElementById('local-api-key');
const openrouterApiKey = document.getElementById('openrouter-api-key');
const openrouterModel = document.getElementById('openrouter-model');
const openrouterEffort = document.getElementById('openrouter-effort');
const groqApiKey = document.getElementById('groq-api-key');
const groqModel = document.getElementById('groq-model');
const groqEffort = document.getElementById('groq-effort');
const saveBtn = document.getElementById('save-btn');
const settingsStatus = document.getElementById('settings-status');

chrome.storage.local.get('providerSettings').then((result) => {
  const settings = result.providerSettings;

  generationProviderSelect.value = settings?.generationProvider || 'openrouter';
  scoringProviderSelect.value = settings?.scoringProvider || '';

  openrouterApiKey.value = settings?.openrouter?.apiKey ?? '';
  openrouterModel.value = settings?.openrouter?.model ?? '';
  openrouterEffort.value = settings?.openrouter?.effort ?? '';
  groqApiKey.value = settings?.groq?.apiKey ?? '';
  groqModel.value = settings?.groq?.model ?? '';
  groqEffort.value = settings?.groq?.effort ?? '';
  localEndpoint.value = settings?.local?.endpoint ?? '';
  localModel.value = settings?.local?.model ?? '';
  localEffort.value = settings?.local?.effort ?? '';
  localApiKey.value = settings?.local?.apiKey ?? '';
});

saveBtn.addEventListener('click', () => {
  const providerSettings = {
    generationProvider: generationProviderSelect.value,
    scoringProvider: scoringProviderSelect.value,
    openrouter: {
      apiKey: openrouterApiKey.value,
      model: openrouterModel.value,
      effort: openrouterEffort.value.trim(),
    },
    groq: {
      apiKey: groqApiKey.value,
      model: groqModel.value,
      effort: groqEffort.value.trim(),
    },
    local: {
      endpoint: localEndpoint.value,
      model: localModel.value,
      effort: localEffort.value.trim(),
      apiKey: localApiKey.value,
    },
  };

  chrome.storage.local.set({ providerSettings }).then(() => {
    settingsStatus.textContent = 'Settings saved.';
  });
});

const profileName = document.getElementById('profile-name');
const profileEmail = document.getElementById('profile-email');
const profilePhone = document.getElementById('profile-phone');
const profileAddress = document.getElementById('profile-address');
const profileCity = document.getElementById('profile-city');
const profileState = document.getElementById('profile-state');
const profileZip = document.getElementById('profile-zip');
const profileLinkedin = document.getElementById('profile-linkedin');
const saveProfileBtn = document.getElementById('save-profile-btn');
const profileStatus = document.getElementById('profile-status');

chrome.storage.local.get('profileInfo').then((result) => {
  const profile = result.profileInfo;
  profileName.value = profile?.name ?? '';
  profileEmail.value = profile?.email ?? '';
  profilePhone.value = profile?.phone ?? '';
  profileAddress.value = profile?.address ?? '';
  profileCity.value = profile?.city ?? '';
  profileState.value = profile?.state ?? '';
  profileZip.value = profile?.zip ?? '';
  profileLinkedin.value = profile?.linkedin ?? '';
});

saveProfileBtn.addEventListener('click', () => {
  const profileInfo = {
    name: profileName.value.trim(),
    email: profileEmail.value.trim(),
    phone: profilePhone.value.trim(),
    address: profileAddress.value.trim(),
    city: profileCity.value.trim(),
    state: profileState.value.trim(),
    zip: profileZip.value.trim(),
    linkedin: profileLinkedin.value.trim(),
  };

  chrome.storage.local.set({ profileInfo }).then(() => {
    profileStatus.textContent = 'Profile saved.';
  });
});

const rulesText = document.getElementById('rules-text');
const memoryText = document.getElementById('memory-text');
const personalizationText = document.getElementById('personalization-text');
const saveRulesMemoryBtn = document.getElementById('save-rules-memory-btn');
const rulesMemoryStatus = document.getElementById('rules-memory-status');

chrome.storage.local.get(['rulesText', 'memoryText', 'personalizationText']).then((result) => {
  rulesText.value = result.rulesText ?? '';
  memoryText.value = result.memoryText ?? '';
  personalizationText.value = result.personalizationText ?? '';
});

saveRulesMemoryBtn.addEventListener('click', () => {
  chrome.storage.local.set({
    rulesText: rulesText.value,
    memoryText: memoryText.value,
    personalizationText: personalizationText.value,
  }).then(() => {
    rulesMemoryStatus.textContent = 'Rules & Memory saved.';
  });
});

// --- Writing Samples manager (Phase 5) ---
// Category panels are generated dynamically from lib/samples_store.js's
// category list rather than hand-written 7x in settings.html, to avoid
// near-duplicate markup drift.

const samplesSection = document.getElementById('samples-section');
const samplesStatus = document.getElementById('samples-status');

function buildCategoryPanels(categories) {
  categories.forEach((category) => {
    const panel = document.createElement('div');
    panel.className = 'sample-panel';
    panel.innerHTML = `
      <h2>${capitalizeCategory(category)}</h2>
      <ul id="samples-list-${category}" class="samples-list"></ul>
      <div class="sample-upload-row">
        <label for="sample-file-${category}">Upload file (.txt or .md)</label>
        <input type="file" id="sample-file-${category}" accept=".txt,.md" data-category="${category}">
      </div>
      <div class="sample-paste-row">
        <label for="sample-name-${category}">Sample name</label>
        <input type="text" id="sample-name-${category}" placeholder="Sample name" data-category="${category}" class="sample-name-input">
        <label for="sample-text-${category}">Paste text</label>
        <textarea id="sample-text-${category}" placeholder="Paste sample text here..." data-category="${category}" class="sample-text-input"></textarea>
        <button type="button" data-category="${category}" class="add-sample-btn">Add Sample</button>
      </div>
      <div class="sample-panel-message" id="sample-message-${category}"></div>
    `;
    samplesSection.appendChild(panel);

    const fileInput = document.getElementById(`sample-file-${category}`);
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        await addSample(category, file.name, reader.result);
        fileInput.value = '';
      };
      reader.readAsText(file);
    });

    const addBtn = document.querySelector(`.add-sample-btn[data-category="${category}"]`);
    addBtn.addEventListener('click', async () => {
      const nameInput = document.getElementById(`sample-name-${category}`);
      const textInput = document.getElementById(`sample-text-${category}`);
      const filename = nameInput.value.trim();
      const content = textInput.value.trim();

      if (!filename || !content) {
        setSampleMessage(category, 'Please provide both a sample name and some text.');
        return;
      }

      setSampleMessage(category, '');
      const ok = await addSample(category, filename, content);
      if (ok) {
        nameInput.value = '';
        textInput.value = '';
      }
    });
  });
}

function renderSampleList(category, filenames) {
  const list = document.getElementById(`samples-list-${category}`);
  list.innerHTML = '';
  if (!filenames || filenames.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'samples-empty';
    empty.textContent = 'No samples yet.';
    list.appendChild(empty);
    return;
  }
  filenames.forEach((filename) => {
    const item = document.createElement('li');
    item.className = 'sample-item';

    const name = document.createElement('span');
    name.className = 'sample-filename';
    name.textContent = filename;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'sample-delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => removeSample(category, filename));

    item.appendChild(name);
    item.appendChild(deleteBtn);
    list.appendChild(item);
  });
}

async function loadAllSamples() {
  const categoryNames = await listSampleCategories();
  buildCategoryPanels(categoryNames);
  for (const category of categoryNames) {
    const filenames = await listSamples(category);
    renderSampleList(category, filenames);
  }
  samplesStatus.textContent = '';
}

function setSampleMessage(category, message) {
  const el = document.getElementById(`sample-message-${category}`);
  if (el) {
    el.textContent = message;
  }
}

async function removeSample(category, filename) {
  await deleteSample(category, filename);
  const filenames = await listSamples(category);
  renderSampleList(category, filenames);
}

async function addSample(category, filename, content) {
  await saveSample(category, filename, content);
  const filenames = await listSamples(category);
  renderSampleList(category, filenames);
  return true;
}

loadAllSamples();

const importFile = document.getElementById('import-file');
const importStatus = document.getElementById('import-status');

importFile.addEventListener('change', async () => {
  try {
    const data = JSON.parse(await importFile.files[0].text());
    const update = {};
    for (const key of ['rulesText', 'memoryText', 'personalizationText']) {
      if (typeof data[key] === 'string') update[key] = data[key];
    }
    if (data.samples && typeof data.samples === 'object') {
      const { samples = {} } = await chrome.storage.local.get('samples');
      for (const [category, files] of Object.entries(data.samples)) {
        samples[category] = { ...(samples[category] || {}), ...files };
      }
      update.samples = samples;
    }
    await chrome.storage.local.set(update);
    importStatus.textContent = `Imported: ${Object.keys(update).join(', ') || 'nothing'}. Reloading…`;
    setTimeout(() => location.reload(), 600);
  } catch (err) {
    importStatus.textContent = `Import failed: ${err.message}`;
  }
});

// Setup status: reflects what's actually in chrome.storage.local, re-rendered on every change.
const statusList = document.getElementById('status-list');

async function renderStatus() {
  const d = await chrome.storage.local.get(['providerSettings', 'profileInfo', 'rulesText', 'memoryText', 'personalizationText', 'samples']);
  const ps = d.providerSettings || {};
  const gen = ps.generationProvider || 'openrouter';
  const score = ps.scoringProvider || gen;
  const providerRow = (name, label) => {
    const c = ps[name] || {};
    const ready = name === 'local' ? !!(c.endpoint && c.model) : !!(c.apiKey && c.model);
    const bits = [c.model ? `model: ${c.model}` : 'no model', name === 'local' ? (c.endpoint ? 'endpoint set' : 'no endpoint') : (c.apiKey ? 'key set' : 'no key')];
    if (c.effort) bits.push(`effort: ${c.effort}`);
    const roles = [name === gen ? 'generates' : '', name === score ? 'scores' : ''].filter(Boolean).join(' + ');
    return [ready, `${label}${roles ? ` (${roles})` : ''}`, bits.join(', ')];
  };
  const profileFilled = Object.values(d.profileInfo || {}).filter(Boolean).length;
  const sampleCounts = Object.entries(d.samples || {})
    .map(([c, files]) => [c, Object.values(files || {}).filter(Boolean).length])
    .filter(([, n]) => n > 0);
  const sampleTotal = sampleCounts.reduce((a, [, n]) => a + n, 0);

  const rows = [
    providerRow('openrouter', 'OpenRouter'),
    providerRow('groq', 'Groq'),
    providerRow('local', 'Local model'),
    [!!d.rulesText?.trim(), 'Rules', d.rulesText?.trim() ? 'set' : 'empty (optional)'],
    [!!d.memoryText?.trim(), 'Memory', d.memoryText?.trim() ? 'set' : 'empty (optional)'],
    [!!d.personalizationText?.trim(), 'About Me', d.personalizationText?.trim() ? 'set' : 'empty (optional)'],
    [profileFilled > 0, 'Profile (cover-letter PDF letterhead)', profileFilled ? `${profileFilled} field(s) set` : 'empty \u2014 needed for PDF export'],
    [sampleTotal > 0, 'Writing samples', sampleTotal ? sampleCounts.map(([c, n]) => `${capitalizeCategory(c)} ${n}`).join(', ') : 'none'],
    [!!d.samples?.cover_letter && Object.keys(d.samples.cover_letter).length > 0, 'Cover Letter samples', d.samples?.cover_letter && Object.keys(d.samples.cover_letter).length ? 'set' : 'none \u2014 cover letters will sound generic'],
  ];
  statusList.replaceChildren(...rows.map(([ok, label, detail]) => {
    const li = document.createElement('li');
    li.className = ok ? 'status-ok' : 'status-todo';
    li.textContent = `${ok ? '\u2713' : '\u25CB'} ${label}: ${detail}`;
    return li;
  }));
}

chrome.storage.onChanged.addListener(renderStatus);
renderStatus();

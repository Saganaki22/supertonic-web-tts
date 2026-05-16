import {
  loadTextToSpeech,
  loadVoiceStyle,
  writeWavFile,
  HF_BASE
} from './helper.js';

// Voice definitions
const VOICES = [
  { id: 'M1', type: 'Male', label: 'M1' },
  { id: 'M2', type: 'Male', label: 'M2' },
  { id: 'M3', type: 'Male', label: 'M3' },
  { id: 'M4', type: 'Male', label: 'M4' },
  { id: 'M5', type: 'Male', label: 'M5' },
  { id: 'F1', type: 'Female', label: 'F1' },
  { id: 'F2', type: 'Female', label: 'F2' },
  { id: 'F3', type: 'Female', label: 'F3' },
  { id: 'F4', type: 'Female', label: 'F4' },
  { id: 'F5', type: 'Female', label: 'F5' },
];

const CACHE_NAME = 'supersonic-tts-v1';

// State
let textToSpeech = null;
let currentStyle = null;
let selectedVoice = 'M1';
let audioBlobUrl = null;
let sampleAudio = null;
let playingVoiceId = null;

// ── Cache Layer ──
const _origFetch = window.fetch;
window.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : input.url;
  if (url && url.startsWith(HF_BASE)) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) return cached;
      const response = await _origFetch(input, init);
      if (response.ok) await cache.put(url, response.clone());
      return response;
    } catch { /* fall through */ }
  }
  return _origFetch(input, init);
};

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileName(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch { return url; }
}

async function getCacheEntries() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  const entries = [];
  for (const req of keys) {
    const res = await cache.match(req);
    const blob = await res.blob();
    entries.push({ url: req.url, name: getFileName(req.url), size: blob.size });
  }
  return entries;
}

async function deleteCacheEntry(url) {
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(url);
}

async function clearAllCache() {
  await caches.delete(CACHE_NAME);
}

async function renderCacheUI() {
  const entries = await getCacheEntries();
  const totalSize = entries.reduce((s, e) => s + e.size, 0);
  const cacheToggle = document.getElementById('cacheToggle');
  const cacheCount = document.getElementById('cacheCount');
  const cacheList = document.getElementById('cacheList');
  const cacheTotal = document.getElementById('cacheTotal');

  if (cacheCount) cacheCount.textContent = entries.length;
  if (cacheTotal) cacheTotal.textContent = formatBytes(totalSize);
  if (!cacheList) return;

  cacheList.innerHTML = entries.length === 0
    ? '<div class="cache-empty">No cached files</div>'
    : entries.map(e => `
      <div class="cache-item" data-url="${e.url}">
        <span class="cache-name">${e.name}</span>
        <span class="cache-size">${formatBytes(e.size)}</span>
        <button class="cache-delete" data-url="${e.url}" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `).join('');

  cacheList.querySelectorAll('.cache-delete').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await deleteCacheEntry(btn.dataset.url);
      renderCacheUI();
    });
  });
}

// DOM
const voiceGrid = document.getElementById('voiceGrid');
const langSelect = document.getElementById('langSelect');
const textInput = document.getElementById('textInput');
const stepsInput = document.getElementById('stepsInput');
const speedInput = document.getElementById('speedInput');
const generateBtn = document.getElementById('generateBtn');
const downloadBtn = document.getElementById('downloadBtn');
const pasteBtn = document.getElementById('pasteBtn');
const statusBadge = document.getElementById('statusBadge');
const statusBadgeText = document.getElementById('statusBadgeText');
const progressSection = document.getElementById('progressSection');
const progressLabel = document.getElementById('progressLabel');
const progressPct = document.getElementById('progressPct');
const progressFill = document.getElementById('progressFill');
const resultArea = document.getElementById('resultArea');
const placeholder = document.getElementById('placeholder');
const resultCard = document.getElementById('resultCard');
const audioPlayer = document.getElementById('audioPlayer');
const audioDuration = document.getElementById('audioDuration');
const genTime = document.getElementById('genTime');
const errorBox = document.getElementById('errorBox');

// Build voice grid
function buildVoiceGrid() {
  voiceGrid.innerHTML = '';
  VOICES.forEach(voice => {
    const card = document.createElement('div');
    card.className = `voice-card${voice.id === selectedVoice ? ' active' : ''}`;
    card.dataset.voice = voice.id;
    card.innerHTML = `
      <span class="voice-id">${voice.label}</span>
      <span class="voice-type">${voice.type}</span>
      <button class="play-sample" data-voice="${voice.id}" title="Play sample">
        <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.play-sample')) return;
      selectVoice(voice.id);
    });
    voiceGrid.appendChild(card);
  });

  // Sample play buttons
  voiceGrid.querySelectorAll('.play-sample').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playSample(btn.dataset.voice);
    });
  });
}

function selectVoice(voiceId) {
  selectedVoice = voiceId;
  voiceGrid.querySelectorAll('.voice-card').forEach(c => {
    c.classList.toggle('active', c.dataset.voice === voiceId);
  });
  loadVoice(voiceId);
}

async function loadVoice(voiceId) {
  try {
    const url = `${HF_BASE}/voice_styles/${voiceId}.json`;
    currentStyle = await loadVoiceStyle([url]);
  } catch (err) {
    showError(`Failed to load voice ${voiceId}: ${err.message}`);
  }
}

function updatePlayButtons() {
  voiceGrid.querySelectorAll('.play-sample').forEach(btn => {
    const isPlaying = btn.dataset.voice === playingVoiceId;
    btn.innerHTML = isPlaying
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    btn.classList.toggle('playing', isPlaying);
  });
}

function playSample(voiceId) {
  // If same voice is playing, stop it
  if (playingVoiceId === voiceId && sampleAudio) {
    sampleAudio.pause();
    sampleAudio = null;
    playingVoiceId = null;
    updatePlayButtons();
    return;
  }

  // Stop any currently playing sample
  if (sampleAudio) {
    sampleAudio.pause();
    sampleAudio = null;
  }

  const audio = new Audio(`${import.meta.env.BASE_URL}${voiceId}.wav`);
  sampleAudio = audio;
  playingVoiceId = voiceId;
  updatePlayButtons();

  audio.play().catch(() => {
    sampleAudio = null;
    playingVoiceId = null;
    updatePlayButtons();
  });

  audio.addEventListener('ended', () => {
    if (sampleAudio === audio) {
      sampleAudio = null;
      playingVoiceId = null;
      updatePlayButtons();
    }
  });
}

// Paste button
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    textInput.value = text;
  } catch {
    showError('Clipboard access denied. Paste manually with Ctrl+V.');
  }
});

// Status
function setStatus(text, type = 'loading') {
  statusBadge.className = `status-badge ${type}`;
  statusBadgeText.textContent = text;
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
  setTimeout(() => errorBox.classList.add('hidden'), 8000);
}

function hideError() {
  errorBox.classList.add('hidden');
}

// Progress
function showProgress(label, pct) {
  progressSection.classList.remove('hidden');
  progressLabel.textContent = label;
  progressPct.textContent = pct + '%';
  progressFill.style.width = pct + '%';
}

function hideProgress() {
  progressSection.classList.add('hidden');
}

// Initialize models
async function init() {
  generateBtn.disabled = true;
  setStatus('Loading models...', 'loading');

  const onnxDir = `${HF_BASE}/onnx`;
  let provider = 'wasm';

  try {
    try {
      const result = await loadTextToSpeech(onnxDir, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all'
      }, (name, current, total) => {
        setStatus(`Loading ${name} (${current}/${total})...`, 'loading');
      });
      textToSpeech = result.textToSpeech;
      provider = 'webgpu';
    } catch {
      const result = await loadTextToSpeech(onnxDir, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      }, (name, current, total) => {
        setStatus(`Loading ${name} (${current}/${total})...`, 'loading');
      });
      textToSpeech = result.textToSpeech;
    }

    setStatus(`Ready (${provider.toUpperCase()})`, 'ready');
    generateBtn.disabled = false;

    // Load default voice
    await loadVoice('M1');
  } catch (err) {
    setStatus('Failed to load', 'error');
    showError(`Model loading failed: ${err.message}`);
    console.error(err);
  }
}

// Generate
generateBtn.addEventListener('click', async () => {
  const text = textInput.value.trim();
  if (!text) { showError('Enter some text first.'); return; }
  if (!textToSpeech) { showError('Models not loaded yet.'); return; }
  if (!currentStyle) { showError('Voice not loaded.'); return; }

  const startTime = Date.now();
  generateBtn.disabled = true;
  hideError();
  placeholder.classList.add('hidden');
  resultCard.classList.add('hidden');
  showProgress('Initializing...', 0);

  try {
    const totalStep = parseInt(stepsInput.value) || 8;
    const speed = parseFloat(speedInput.value) || 1.05;
    const lang = langSelect.value;

    const { wav, duration } = await textToSpeech.call(text, lang, currentStyle, totalStep, speed, 0.3,
      (step, total) => {
        const pct = Math.round((step / total) * 100);
        showProgress(`Denoising step ${step}/${total}`, pct);
      }
    );

    showProgress('Encoding audio...', 100);

    const wavLen = Math.floor(textToSpeech.sampleRate * duration[0]);
    const wavBuffer = writeWavFile(wav.slice(0, wavLen), textToSpeech.sampleRate);

    if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    audioBlobUrl = URL.createObjectURL(blob);

    audioPlayer.src = audioBlobUrl;
    audioDuration.textContent = `${duration[0].toFixed(2)}s`;
    genTime.textContent = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    placeholder.classList.add('hidden');
    resultCard.classList.remove('hidden');
    hideProgress();
  } catch (err) {
    hideProgress();
    showError(`Generation failed: ${err.message}`);
    placeholder.classList.remove('hidden');
    console.error(err);
  } finally {
    generateBtn.disabled = false;
  }
});

// Download
downloadBtn.addEventListener('click', () => {
  if (!audioBlobUrl) return;
  const a = document.createElement('a');
  a.href = audioBlobUrl;
  a.download = `tts_${selectedVoice}_${Date.now()}.wav`;
  a.click();
});

// Boot
buildVoiceGrid();
window.addEventListener('load', () => {
  init();
  renderCacheUI();

  // Cache panel toggle
  const cacheToggle = document.getElementById('cacheToggle');
  const cachePanel = document.getElementById('cachePanel');
  if (cacheToggle && cachePanel) {
    cacheToggle.addEventListener('click', () => {
      cachePanel.classList.toggle('open');
      renderCacheUI();
    });
  }

  // Clear all cache
  const clearAllBtn = document.getElementById('clearAllCache');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async () => {
      await clearAllCache();
      renderCacheUI();
    });
  }
});

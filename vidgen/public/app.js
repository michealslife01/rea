const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'vidgen-draft';

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
    body: options.body && JSON.stringify(options.body),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

// ---------- Status ----------

let status;
async function loadStatus() {
  status = await api('/api/status');
  const chip = (on, label, hint) =>
    `<span class="chip ${on ? 'on' : ''}" title="${on ? 'Configured' : hint}">${on ? '●' : '○'} ${label}</span>`;
  $('status').innerHTML = [
    chip(status.claude, 'AI script', 'Add ANTHROPIC_API_KEY to .env'),
    chip(status.voice, 'Voiceover', 'Add ELEVENLABS_API_KEY to .env'),
    chip(status.footage, 'Stock footage', 'Add PEXELS_API_KEY to .env'),
    chip(status.musicTracks > 0, `Music (${status.musicTracks})`, 'Put MP3 files in the music folder'),
  ].join('');
  $('tone').innerHTML = status.tones.map((t) => `<option>${t}</option>`).join('');
  $('format').innerHTML = status.formats
    .map((f) => `<option value="${f}">${{ '9:16': 'Vertical 9:16', '16:9': 'Wide 16:9', '1:1': 'Square 1:1' }[f]}</option>`)
    .join('');
  if (!status.voice) {
    $('voice').checked = false;
    $('voice').disabled = true;
    $('voice').parentElement.title = 'Add ELEVENLABS_API_KEY to .env to enable';
  }
}

// ---------- Script editor ----------

function addScene(scene = { narration: '', visual: '' }) {
  const node = $('scene-template').content.firstElementChild.cloneNode(true);
  node.querySelector('.narration').value = scene.narration;
  node.querySelector('.visual').value = scene.visual;
  node.querySelector('.remove').onclick = () => {
    node.remove();
    saveDraft();
  };
  $('scenes').append(node);
  return node;
}

function readScript() {
  return {
    title: $('title').value.trim(),
    scenes: [...$('scenes').children].map((li) => ({
      narration: li.querySelector('.narration').value.trim(),
      visual: li.querySelector('.visual').value.trim(),
    })),
  };
}

function showScript(script) {
  $('title').value = script.title || '';
  $('scenes').replaceChildren();
  for (const scene of script.scenes) addScene(scene);
  $('script-card').hidden = false;
  updateEstimate();
}

function updateEstimate() {
  const words = readScript().scenes.reduce((n, s) => n + (s.narration.match(/\S+/g)?.length ?? 0), 0);
  $('estimate').textContent = words ? `· ${words} words, about ${Math.round(words / 2.5)} seconds` : '';
}

function saveDraft() {
  updateEstimate();
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ prompt: $('prompt').value, ...readScript() }));
  } catch {
    // Storage can be unavailable (private window); drafts are just a convenience.
  }
}

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!draft) return;
    $('prompt').value = draft.prompt || '';
    if (draft.scenes?.length) showScript(draft);
  } catch {
    // Ignore a missing or corrupt draft.
  }
}

$('write').onclick = async () => {
  const button = $('write');
  $('script-error').hidden = true;
  if (!$('prompt').value.trim()) {
    $('script-error').textContent = 'Describe your video idea first.';
    $('script-error').hidden = false;
    return;
  }
  button.disabled = true;
  button.textContent = 'Writing…';
  try {
    const script = await api('/api/script', {
      method: 'POST',
      body: { prompt: $('prompt').value, seconds: Number($('seconds').value), tone: $('tone').value },
    });
    showScript(script);
    saveDraft();
    $('script-card').scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    $('script-error').textContent = error.message;
    $('script-error').hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Write script with AI';
  }
};

$('write-myself').onclick = () => {
  if ($('script-card').hidden) showScript({ title: '', scenes: [] });
  addScene().querySelector('.narration').focus();
};

$('add-scene').onclick = () => addScene().querySelector('.narration').focus();
$('scenes').addEventListener('input', saveDraft);
$('title').addEventListener('input', saveDraft);
$('prompt').addEventListener('input', saveDraft);

// ---------- Rendering ----------

$('render').onclick = async () => {
  const script = readScript();
  script.scenes = script.scenes.filter((s) => s.narration);
  const button = $('render');
  button.disabled = true;
  $('job-card').hidden = false;
  $('job-error').hidden = true;
  $('job-result').hidden = true;
  $('job-progress').hidden = false;
  $('bar-fill').style.width = '0%';
  $('job-step').textContent = 'Starting…';
  $('job-card').scrollIntoView({ behavior: 'smooth' });
  try {
    const { id } = await api('/api/render', {
      method: 'POST',
      body: { ...script, format: $('format').value, voice: $('voice').checked },
    });
    await followJob(id);
  } catch (error) {
    $('job-progress').hidden = true;
    $('job-error').textContent = error.message;
    $('job-error').hidden = false;
  } finally {
    button.disabled = false;
  }
};

async function followJob(id) {
  for (;;) {
    const job = await api(`/api/jobs/${id}`);
    $('bar-fill').style.width = `${Math.round(job.progress * 100)}%`;
    $('job-step').textContent = job.step;
    if (job.status === 'error') throw new Error(job.error);
    if (job.status === 'done') {
      showResult(job.video);
      loadLibrary();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const fileName = (video) => `${(video.title || 'video').replace(/[^\w\- ]+/g, '').trim() || 'video'}.mp4`;

function showResult(video) {
  $('job-progress').hidden = true;
  $('job-result').hidden = false;
  $('result-video').src = `/videos/${video.id}/video.mp4`;
  $('result-download').href = `/videos/${video.id}/video.mp4`;
  $('result-download').download = fileName(video);
  const notes = [...video.notes];
  if (video.footage.length) {
    notes.push(`Footage from Pexels by ${[...new Set(video.footage.map((f) => f.author).filter(Boolean))].join(', ')}.`);
  }
  $('result-notes').innerHTML = notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('');
}

// ---------- Library ----------

async function loadLibrary() {
  const videos = await api('/api/videos');
  $('library-empty').hidden = videos.length > 0;
  $('library').innerHTML = videos
    .map(
      (v) => `<div class="tile" data-id="${v.id}">
        <img src="/videos/${v.id}/thumb.jpg" alt="">
        <div class="meta">
          <strong title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</strong>
          <div class="actions">
            <span>${v.format} · ${Math.round(v.duration)}s</span>
            <span><a href="/videos/${v.id}/video.mp4" download="${escapeHtml(fileName(v))}">Save</a>
            <button class="icon delete" title="Delete video" aria-label="Delete video">✕</button></span>
          </div>
        </div>
      </div>`,
    )
    .join('');
  for (const tile of $('library').children) {
    const video = videos.find((v) => v.id === tile.dataset.id);
    tile.querySelector('img').onclick = () => {
      $('job-card').hidden = false;
      $('job-error').hidden = true;
      showResult(video);
      $('job-card').scrollIntoView({ behavior: 'smooth' });
    };
    tile.querySelector('.delete').onclick = async () => {
      if (!confirm(`Delete "${video.title}"?`)) return;
      await api(`/api/videos/${video.id}`, { method: 'DELETE' });
      loadLibrary();
    };
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

await loadStatus();
restoreDraft();
loadLibrary();

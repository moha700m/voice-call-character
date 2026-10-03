const API = 'https://api.vibi.pro';

const state = {
  apiKey: '',
  provider: 'elevenlabs',
  models: [],
  voices: [],
  recorder: null,
  stream: null,
  chunks: [],
  recordingStartedAt: 0,
};

const $ = (id) => document.getElementById(id);
const els = {
  apiKey: $('apiKey'), connect: $('connect'), disconnect: $('disconnect'), connectionBadge: $('connectionBadge'),
  connectMsg: $('connectMsg'), workspace: $('workspace'), provider: $('provider'), model: $('model'), voice: $('voice'),
  previewVoice: $('previewVoice'), voiceMeta: $('voiceMeta'), ttsText: $('ttsText'), speak: $('speak'), ttsMsg: $('ttsMsg'),
  ttsProgress: $('ttsProgress'), audio: $('audio'), record: $('record'), stop: $('stop'), sttMsg: $('sttMsg'),
  sttProgress: $('sttProgress'), transcript: $('transcript'), copyTranscript: $('copyTranscript'),
};

function setMessage(el, text = '', type = '') {
  el.textContent = text;
  el.className = `message${text ? ' show' : ''}${type ? ` ${type}` : ''}`;
}

function setProgress(el, value = 0) {
  el.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function errorText(data, fallback) {
  if (!data) return fallback;
  if (typeof data === 'string') return data.slice(0, 300);
  return data.detail || data.error || data.message || fallback;
}

async function vibi(path, options = {}) {
  if (!state.apiKey) throw new Error('أدخل مفتاح Vibi أول.');
  const headers = new Headers(options.headers || {});
  headers.set('xi-api-key', state.apiKey);
  if (options.json !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(`${API}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    mode: 'cors',
  });
  const contentType = response.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) data = await response.json().catch(() => null);
  else data = await response.text().catch(() => '');
  if (!response.ok) throw new Error(errorText(data, `Vibi HTTP ${response.status}`));
  return data;
}

async function waitForHistory(id, progressEl, messageEl) {
  const started = Date.now();
  while (Date.now() - started < 90000) {
    const task = await vibi(`/v1/history/${encodeURIComponent(id)}`);
    const progress = Number(task.progress || 0);
    setProgress(progressEl, progress || (task.status === 'processing' ? 55 : 18));
    if (task.status === 'completed') {
      setProgress(progressEl, 100);
      return task;
    }
    if (task.status === 'failed') throw new Error(errorText(task, 'فشل توليد الصوت.'));
    setMessage(messageEl, task.status === 'processing' ? 'Vibi يجهز الصوت…' : 'تم إرسال الطلب، ننتظر Vibi…');
    await new Promise((r) => setTimeout(r, 900));
  }
  throw new Error('انتهت مهلة انتظار الصوت من Vibi.');
}

async function waitForTranscription(taskId) {
  const started = Date.now();
  while (Date.now() - started < 90000) {
    const task = await vibi(`/v1/speech-to-text/${encodeURIComponent(taskId)}`);
    const progress = Number(task.progress || 0);
    setProgress(els.sttProgress, progress || (task.status === 'processing' ? 55 : 18));
    if (task.status === 'completed') {
      setProgress(els.sttProgress, 100);
      return task;
    }
    if (task.status === 'failed') throw new Error(task.detail_error || errorText(task, 'فشل تحويل الصوت إلى نص.'));
    setMessage(els.sttMsg, task.status === 'processing' ? 'Vibi يسمع التسجيل ويفرغه…' : 'تم رفع التسجيل إلى Vibi…');
    await new Promise((r) => setTimeout(r, 900));
  }
  throw new Error('انتهت مهلة انتظار التفريغ من Vibi.');
}

function normalizedModels(data) {
  return Array.isArray(data) ? data : Array.isArray(data?.models) ? data.models : [];
}

function normalizedVoices(data, provider) {
  if (provider === 'minimax') return data?.voice_list || data?.voices || [];
  return data?.voices || data?.voice_list || [];
}

function voiceLabel(v) {
  return v.name || v.voice_name || v.uniq_id || v.voice_id || 'Voice';
}

function voiceId(v) {
  return String(v.voice_id || v.uniq_id || v.id || '');
}

function previewUrl(v) {
  return v.preview_url || v.sample_audio || v.audio_url || v.demo_audio || '';
}

function describeVoice(v) {
  const bits = [v.gender, v.age, v.accent, v.language, v.use_case, v.descriptive].filter(Boolean);
  return bits.join(' · ') || v.description || 'صوت من مكتبة Vibi';
}

async function loadProviderCatalog() {
  els.provider.disabled = true;
  els.model.disabled = true;
  els.voice.disabled = true;
  els.speak.disabled = true;
  setMessage(els.ttsMsg, 'جاري تحميل الأصوات والموديلات من Vibi…');
  try {
    const provider = state.provider;
    const modelPath = provider === 'minimax' ? '/v1/models?provider=minimax' : '/v1/models';
    const voicePath = provider === 'minimax'
      ? '/v1/minimax/system-voices?page=0&page_size=50&language=Arabic&gender=male'
      : '/v1/shared-voices?page=0&page_size=50&sort=cloned_by_count&category=high_quality&gender=male&required_languages=ar&use_cases%5B%5D=conversational';

    const [modelsData, voicesData] = await Promise.all([vibi(modelPath), vibi(voicePath)]);
    state.models = normalizedModels(modelsData);
    state.voices = normalizedVoices(voicesData, provider);

    if (!state.voices.length && provider === 'elevenlabs') {
      const fallback = await vibi('/v1/shared-voices?page=0&page_size=50&sort=trending&gender=male&required_languages=ar');
      state.voices = normalizedVoices(fallback, provider);
    }

    els.model.innerHTML = '';
    for (const m of state.models) {
      const option = document.createElement('option');
      option.value = m.model_id || m.id || '';
      option.textContent = m.name ? `${m.name} · ${option.value}` : option.value;
      els.model.appendChild(option);
    }
    const preferred = provider === 'minimax' ? 'speech-2.8-turbo' : 'eleven_multilingual_v2';
    if ([...els.model.options].some((o) => o.value === preferred)) els.model.value = preferred;

    els.voice.innerHTML = '';
    for (const v of state.voices) {
      const id = voiceId(v);
      if (!id) continue;
      const option = document.createElement('option');
      option.value = id;
      option.textContent = voiceLabel(v);
      els.voice.appendChild(option);
    }

    if (!els.voice.options.length) throw new Error('ما لقيت أصوات عربية مناسبة بهذا الفلتر.');
    updateVoiceMeta();
    setMessage(els.ttsMsg, `جاهز: ${state.voices.length} صوت من Vibi.`, 'ok');
  } catch (error) {
    setMessage(els.ttsMsg, error.message || String(error), 'error');
  } finally {
    els.provider.disabled = false;
    els.model.disabled = false;
    els.voice.disabled = false;
    els.speak.disabled = false;
  }
}

async function connect() {
  const key = els.apiKey.value.trim();
  if (!key) return setMessage(els.connectMsg, 'حط API Key حق Vibi.', 'error');
  state.apiKey = key;
  els.connect.disabled = true;
  setMessage(els.connectMsg, 'أتحقق من Vibi…');
  try {
    const languages = await vibi('/v1/languages');
    const hasArabic = Array.isArray(languages) && languages.some((x) => String(x.code).toLowerCase() === 'ar');
    if (!hasArabic) throw new Error('اتصلنا، لكن Arabic غير ظاهر ضمن لغات الحساب.');
    els.apiKey.value = '';
    els.apiKey.placeholder = 'المفتاح موجود بالذاكرة المؤقتة فقط';
    els.connectionBadge.textContent = 'Vibi متصل';
    els.connectionBadge.className = 'badge ok';
    els.workspace.classList.remove('hidden');
    els.disconnect.classList.remove('hidden');
    setMessage(els.connectMsg, 'تم الاتصال مباشرة بـ api.vibi.pro. المفتاح ما ينحفظ في الموقع.', 'ok');
    await loadProviderCatalog();
  } catch (error) {
    state.apiKey = '';
    setMessage(els.connectMsg, error.message || String(error), 'error');
  } finally {
    els.connect.disabled = false;
  }
}

function disconnect() {
  state.apiKey = '';
  state.models = [];
  state.voices = [];
  els.workspace.classList.add('hidden');
  els.disconnect.classList.add('hidden');
  els.connectionBadge.textContent = 'Vibi غير متصل';
  els.connectionBadge.className = 'badge';
  els.apiKey.placeholder = 'sk_…';
  setMessage(els.connectMsg, 'تم مسح المفتاح من ذاكرة الصفحة.', 'ok');
}

function currentVoice() {
  return state.voices.find((v) => voiceId(v) === els.voice.value);
}

function updateVoiceMeta() {
  const v = currentVoice();
  els.voiceMeta.textContent = v ? describeVoice(v) : '';
}

async function generateSpeech() {
  const text = els.ttsText.value.trim();
  const voice = els.voice.value;
  const model = els.model.value;
  if (!text) return setMessage(els.ttsMsg, 'اكتب النص اللي تبي سايبر ينطقه.', 'error');
  if (!voice || !model) return setMessage(els.ttsMsg, 'اختر الصوت والموديل.', 'error');

  els.speak.disabled = true;
  setProgress(els.ttsProgress, 8);
  setMessage(els.ttsMsg, 'أرسل النص إلى Vibi…');
  try {
    const provider = state.provider;
    const body = {
      text,
      provider,
      model_id: model,
      language_code: provider === 'minimax' ? 'Arabic' : 'ar',
      export_transcript: false,
      voice_settings: provider === 'minimax'
        ? { speed: 1.03, pitch: 0, vol: 1 }
        : { stability: 0.44, similarity_boost: 0.8, style: 0.12, use_speaker_boost: true, speed: 1.03 },
    };
    const queued = await vibi(`/v1/text-to-speech/${encodeURIComponent(voice)}`, { method: 'POST', json: body });
    const id = queued.id || queued.task_id;
    if (!id) throw new Error('Vibi ما رجع Task ID.');
    const task = await waitForHistory(id, els.ttsProgress, els.ttsMsg);
    const rawUrl = task.result?.audio_url || task.audio_url;
    if (!rawUrl) throw new Error('المهمة اكتملت لكن ما رجع رابط الصوت.');
    const url = new URL(rawUrl, API).href;
    els.audio.src = url;
    els.audio.classList.remove('hidden');
    await els.audio.play().catch(() => {});
    setMessage(els.ttsMsg, `تم من Vibi · خصم ${task.credits_deducted ?? '—'} رصيد`, 'ok');
  } catch (error) {
    setProgress(els.ttsProgress, 0);
    setMessage(els.ttsMsg, error.message || String(error), 'error');
  } finally {
    els.speak.disabled = false;
  }
}

function recorderMime() {
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  return candidates.find((x) => window.MediaRecorder?.isTypeSupported?.(x)) || '';
}

function filenameForMime(mime) {
  if (mime.includes('mp4')) return 'recording.m4a';
  if (mime.includes('ogg')) return 'recording.ogg';
  return 'recording.webm';
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return setMessage(els.sttMsg, 'المتصفح هذا ما يدعم تسجيل المايك بالطريقة المطلوبة.', 'error');
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    state.chunks = [];
    const mimeType = recorderMime();
    state.recorder = mimeType ? new MediaRecorder(state.stream, { mimeType }) : new MediaRecorder(state.stream);
    state.recorder.ondataavailable = (event) => { if (event.data?.size) state.chunks.push(event.data); };
    state.recorder.onstop = submitRecording;
    state.recorder.start(250);
    state.recordingStartedAt = Date.now();
    els.record.disabled = true;
    els.stop.disabled = false;
    setProgress(els.sttProgress, 6);
    setMessage(els.sttMsg, 'أسجل الآن… تكلم براحتك ثم اضغط وقف.');
  } catch (error) {
    setMessage(els.sttMsg, error.message || 'ما قدرت أوصل للمايك.', 'error');
  }
}

function stopRecording() {
  if (!state.recorder || state.recorder.state === 'inactive') return;
  state.recorder.stop();
  state.stream?.getTracks().forEach((track) => track.stop());
  els.stop.disabled = true;
  setMessage(els.sttMsg, 'أرفع التسجيل إلى Vibi…');
}

async function submitRecording() {
  const mime = state.recorder?.mimeType || 'audio/webm';
  const blob = new Blob(state.chunks, { type: mime });
  state.recorder = null;
  state.stream = null;
  if (blob.size < 1000) {
    els.record.disabled = false;
    return setMessage(els.sttMsg, 'التسجيل قصير جدًا، جرّب مرة ثانية.', 'error');
  }
  setProgress(els.sttProgress, 12);
  try {
    const form = new FormData();
    form.append('file', blob, filenameForMime(mime));
    form.append('language_code', 'ar');
    form.append('timestamps_granularity', 'none');
    form.append('tag_audio_events', 'false');
    const queued = await vibi('/v1/speech-to-text', { method: 'POST', body: form });
    const taskId = queued.task_id || queued.id;
    if (!taskId) throw new Error('Vibi ما رجع Task ID للتفريغ.');
    const task = await waitForTranscription(taskId);
    const text = task.result?.text?.trim();
    if (!text) throw new Error('التفريغ اكتمل لكن النص فاضي.');
    els.transcript.textContent = text;
    els.copyTranscript.disabled = false;
    setMessage(els.sttMsg, `تم التفريغ من Vibi · ${Math.round(task.audio_duration_secs || 0)} ثانية`, 'ok');
  } catch (error) {
    setProgress(els.sttProgress, 0);
    setMessage(els.sttMsg, error.message || String(error), 'error');
  } finally {
    els.record.disabled = false;
  }
}

els.connect.addEventListener('click', connect);
els.disconnect.addEventListener('click', disconnect);
els.apiKey.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
els.provider.addEventListener('change', async () => { state.provider = els.provider.value; await loadProviderCatalog(); });
els.voice.addEventListener('change', updateVoiceMeta);
els.previewVoice.addEventListener('click', async () => {
  const v = currentVoice();
  const url = v && previewUrl(v);
  if (!url) return setMessage(els.ttsMsg, 'الصوت هذا ما عنده Preview جاهز.', 'error');
  els.audio.src = url;
  els.audio.classList.remove('hidden');
  await els.audio.play().catch(() => {});
});
els.speak.addEventListener('click', generateSpeech);
els.record.addEventListener('click', startRecording);
els.stop.addEventListener('click', stopRecording);
els.copyTranscript.addEventListener('click', async () => {
  const text = els.transcript.textContent.trim();
  if (!text) return;
  await navigator.clipboard?.writeText(text).catch(() => {});
  setMessage(els.sttMsg, 'نسخت النص.', 'ok');
});

window.addEventListener('beforeunload', () => {
  state.apiKey = '';
  state.stream?.getTracks().forEach((track) => track.stop());
});

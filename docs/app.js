const BRIDGE_ORIGIN = 'https://elevenlabs-voice-call-al26uz.v2.appdeploy.ai';
const BRIDGE_URL = `${BRIDGE_ORIGIN}/?bridge=1`;
const VIBI_BASE = 'https://api.vibi.pro';
const BRIDGE_REQUEST_SOURCE = 'cyber-vibi-parent';
const BRIDGE_RESPONSE_SOURCE = 'cyber-vibi-bridge';

const state = {
  provider: 'elevenlabs',
  models: [],
  voices: [],
  recorder: null,
  stream: null,
  chunks: [],
  bridgeFrame: null,
  bridgeReady: false,
};

const bridgePending = new Map();
let resolveBridgeReady;
let rejectBridgeReady;
const bridgeReadyPromise = new Promise((resolve, reject) => {
  resolveBridgeReady = resolve;
  rejectBridgeReady = reject;
});

const $ = (id) => document.getElementById(id);
const els = {
  connectionBadge: $('connectionBadge'), connectMsg: $('connectMsg'), reconnect: $('reconnect'), workspace: $('workspace'),
  provider: $('provider'), model: $('model'), voice: $('voice'), previewVoice: $('previewVoice'), voiceMeta: $('voiceMeta'),
  ttsText: $('ttsText'), speak: $('speak'), ttsMsg: $('ttsMsg'), ttsProgress: $('ttsProgress'), audio: $('audio'),
  record: $('record'), stop: $('stop'), sttMsg: $('sttMsg'), sttProgress: $('sttProgress'), transcript: $('transcript'),
  copyTranscript: $('copyTranscript'),
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
  return data.detail || data.detail_error || data.error || data.message || fallback;
}

function createBridge() {
  if (state.bridgeFrame) return;

  const frame = document.createElement('iframe');
  frame.src = BRIDGE_URL;
  frame.title = 'Vibi secure bridge';
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;border:0;opacity:0;pointer-events:none';
  state.bridgeFrame = frame;
  document.body.appendChild(frame);

  window.setTimeout(() => {
    if (!state.bridgeReady) rejectBridgeReady(new Error('تعذر تشغيل الجسر الآمن مع Vibi.'));
  }, 15000);
}

window.addEventListener('message', (event) => {
  if (event.origin !== BRIDGE_ORIGIN || event.source !== state.bridgeFrame?.contentWindow) return;
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  if (message.source === `${BRIDGE_RESPONSE_SOURCE}-ready`) {
    if (!state.bridgeReady) {
      state.bridgeReady = true;
      resolveBridgeReady();
    }
    return;
  }

  if (message.source !== BRIDGE_RESPONSE_SOURCE || typeof message.id !== 'string') return;
  const pending = bridgePending.get(message.id);
  if (!pending) return;
  bridgePending.delete(message.id);
  clearTimeout(pending.timer);

  if (message.ok) pending.resolve(message.data);
  else pending.reject(new Error(errorText(message, 'فشل طلب Backend.')));
});

async function proxy(action, payload = {}) {
  createBridge();
  await bridgeReadyPromise;

  const target = state.bridgeFrame?.contentWindow;
  if (!target) throw new Error('الجسر الآمن غير متاح.');

  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      bridgePending.delete(id);
      reject(new Error('انتهت مهلة الاتصال بالـBackend الآمن.'));
    }, 30000);

    bridgePending.set(id, { resolve, reject, timer });
    target.postMessage(
      { source: BRIDGE_REQUEST_SOURCE, id, payload: { action, ...payload } },
      BRIDGE_ORIGIN,
    );
  });
}

function normalizedModels(data) {
  return Array.isArray(data) ? data : Array.isArray(data?.models) ? data.models : [];
}

function normalizedVoices(data, provider) {
  return provider === 'minimax' ? (data?.voice_list || data?.voices || []) : (data?.voices || data?.voice_list || []);
}

function voiceId(v) {
  return String(v.voice_id || v.uniq_id || v.id || '');
}

function voiceLabel(v) {
  return v.name || v.voice_name || v.uniq_id || v.voice_id || 'Voice';
}

function previewUrl(v) {
  return v.preview_url || v.sample_audio || v.audio_url || v.demo_audio || '';
}

function describeVoice(v) {
  const bits = [v.gender, v.age, v.accent, v.language, v.use_case, v.descriptive].filter(Boolean);
  if (Array.isArray(v.tag_list)) bits.push(...v.tag_list.slice(0, 4));
  return bits.join(' · ') || v.description || 'صوت من مكتبة Vibi';
}

async function waitForHistory(id) {
  const started = Date.now();
  while (Date.now() - started < 90000) {
    const task = await proxy('history', { id });
    setProgress(els.ttsProgress, Number(task.progress || 0) || (task.status === 'processing' ? 55 : 18));
    if (task.status === 'completed') return task;
    if (task.status === 'failed') throw new Error(errorText(task, 'فشل توليد الصوت.'));
    setMessage(els.ttsMsg, task.status === 'processing' ? 'Vibi يجهز الصوت…' : 'تم إرسال الطلب، ننتظر Vibi…');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('انتهت مهلة انتظار الصوت من Vibi.');
}

async function waitForTranscription(taskId) {
  const started = Date.now();
  while (Date.now() - started < 90000) {
    const task = await proxy('stt.get', { taskId });
    setProgress(els.sttProgress, Number(task.progress || 0) || (task.status === 'processing' ? 55 : 18));
    if (task.status === 'completed') return task;
    if (task.status === 'failed') throw new Error(errorText(task, 'فشل تحويل الصوت إلى نص.'));
    setMessage(els.sttMsg, task.status === 'processing' ? 'Vibi يسمع التسجيل ويفرغه…' : 'تم رفع التسجيل إلى Vibi…');
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error('انتهت مهلة انتظار التفريغ من Vibi.');
}

function currentVoice() {
  return state.voices.find((voice) => voiceId(voice) === els.voice.value);
}

function updateVoiceMeta() {
  const voice = currentVoice();
  els.voiceMeta.textContent = voice ? describeVoice(voice) : '';
}

async function loadProviderCatalog() {
  els.provider.disabled = true;
  els.model.disabled = true;
  els.voice.disabled = true;
  els.speak.disabled = true;
  setMessage(els.ttsMsg, 'جاري تحميل الأصوات والموديلات من Vibi…');
  try {
    const provider = state.provider;
    const [modelsData, voicesData] = await Promise.all([
      proxy('models', { provider }),
      proxy('voices', { provider }),
    ]);
    state.models = normalizedModels(modelsData);
    state.voices = normalizedVoices(voicesData, provider);

    els.model.innerHTML = '';
    for (const model of state.models) {
      const option = document.createElement('option');
      option.value = model.model_id || model.id || '';
      option.textContent = model.name ? `${model.name} · ${option.value}` : option.value;
      if (option.value) els.model.appendChild(option);
    }
    const preferred = provider === 'minimax' ? 'speech-2.8-turbo' : 'eleven_multilingual_v2';
    if ([...els.model.options].some((option) => option.value === preferred)) els.model.value = preferred;

    els.voice.innerHTML = '';
    for (const voice of state.voices) {
      const id = voiceId(voice);
      if (!id) continue;
      const option = document.createElement('option');
      option.value = id;
      option.textContent = voiceLabel(voice);
      els.voice.appendChild(option);
    }
    if (!els.voice.options.length) throw new Error('ما لقيت أصوات عربية مناسبة داخل Vibi بهذا الفلتر.');
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
  els.reconnect.disabled = true;
  els.connectionBadge.textContent = 'جاري الاتصال…';
  els.connectionBadge.className = 'badge';
  setMessage(els.connectMsg, 'أتحقق من Backend الآمن…');
  try {
    const status = await proxy('status');
    if (!status?.ready) throw new Error('Backend غير جاهز.');
    if (!status?.configured) {
      els.workspace.classList.add('hidden');
      els.connectionBadge.textContent = 'بانتظار Secret';
      els.connectionBadge.className = 'badge warn';
      setMessage(els.connectMsg, 'Backend شغال، لكن VIBI_API_KEY ما انحفظ في الخادم إلى الآن.', 'error');
      return;
    }
    const languages = await proxy('languages', { provider: 'elevenlabs' });
    const hasArabic = Array.isArray(languages) && languages.some((item) => String(item.code).toLowerCase() === 'ar');
    if (!hasArabic) throw new Error('Vibi متصل، لكن العربية غير ظاهرة ضمن لغات الحساب.');
    els.connectionBadge.textContent = 'Vibi متصل';
    els.connectionBadge.className = 'badge ok';
    els.workspace.classList.remove('hidden');
    setMessage(els.connectMsg, 'تم الاتصال عبر Backend الآمن. المفتاح غير موجود في المتصفح أو GitHub.', 'ok');
    await loadProviderCatalog();
  } catch (error) {
    els.workspace.classList.add('hidden');
    els.connectionBadge.textContent = 'خطأ اتصال';
    els.connectionBadge.className = 'badge warn';
    setMessage(els.connectMsg, error.message || String(error), 'error');
  } finally {
    els.reconnect.disabled = false;
  }
}

async function generateSpeech() {
  const text = els.ttsText.value.trim();
  const voiceIdValue = els.voice.value;
  const modelId = els.model.value;
  if (!text || !voiceIdValue || !modelId) return setMessage(els.ttsMsg, 'اختر الصوت والموديل واكتب النص.', 'error');

  els.speak.disabled = true;
  setProgress(els.ttsProgress, 8);
  setMessage(els.ttsMsg, 'أرسل النص إلى Vibi عبر Backend…');
  try {
    const queued = await proxy('tts', { provider: state.provider, voiceId: voiceIdValue, modelId, text });
    const id = queued.id || queued.task_id;
    if (!id) throw new Error('Vibi ما رجع Task ID.');
    const task = await waitForHistory(id);
    setProgress(els.ttsProgress, 100);
    const rawUrl = task.result?.audio_url || task.audio_url;
    if (!rawUrl) throw new Error('المهمة اكتملت لكن ما رجع رابط الصوت.');
    els.audio.src = new URL(rawUrl, VIBI_BASE).href;
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
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || '';
}

function filenameForMime(mime) {
  if (mime.includes('mp4')) return 'recording.m4a';
  if (mime.includes('ogg')) return 'recording.ogg';
  return 'recording.webm';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('تعذر قراءة التسجيل.'));
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(blob);
  });
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
    els.record.disabled = true;
    els.stop.disabled = false;
    setProgress(els.sttProgress, 6);
    setMessage(els.sttMsg, 'أسجل الآن… تكلم ثم اضغط وقف.');
  } catch (error) {
    setMessage(els.sttMsg, error.message || 'ما قدرت أوصل للمايك.', 'error');
  }
}

function stopRecording() {
  if (!state.recorder || state.recorder.state === 'inactive') return;
  state.recorder.stop();
  state.stream?.getTracks().forEach((track) => track.stop());
  els.stop.disabled = true;
  setMessage(els.sttMsg, 'أجهز التسجيل لرفعه إلى Vibi…');
}

async function submitRecording() {
  const mimeType = state.recorder?.mimeType || 'audio/webm';
  const blob = new Blob(state.chunks, { type: mimeType });
  state.recorder = null;
  state.stream = null;
  els.record.disabled = false;
  if (blob.size < 1000) return setMessage(els.sttMsg, 'التسجيل قصير جدًا، جرّب مرة ثانية.', 'error');

  setProgress(els.sttProgress, 12);
  try {
    const dataBase64 = await blobToBase64(blob);
    const queued = await proxy('stt.submit', {
      dataBase64,
      mimeType,
      filename: filenameForMime(mimeType),
    });
    const taskId = queued.task_id || queued.id;
    if (!taskId) throw new Error('Vibi ما رجع Task ID للتفريغ.');
    const task = await waitForTranscription(taskId);
    setProgress(els.sttProgress, 100);
    const text = task.result?.text || task.text || '';
    els.transcript.textContent = text || 'اكتملت المهمة لكن ما رجع نص.';
    els.copyTranscript.disabled = !text;
    setMessage(els.sttMsg, `تم التفريغ عبر Vibi · خصم ${task.credits_deducted ?? '—'} رصيد`, 'ok');
  } catch (error) {
    setProgress(els.sttProgress, 0);
    setMessage(els.sttMsg, error.message || String(error), 'error');
  }
}

function previewVoice() {
  const voice = currentVoice();
  const url = voice ? previewUrl(voice) : '';
  if (!url) return setMessage(els.ttsMsg, 'الصوت هذا ما عنده عينة جاهزة؛ جرّب TTS.', 'error');
  els.audio.src = url;
  els.audio.classList.remove('hidden');
  els.audio.play().catch(() => {});
}

els.reconnect.addEventListener('click', connect);
els.provider.addEventListener('change', async () => {
  state.provider = els.provider.value;
  await loadProviderCatalog();
});
els.voice.addEventListener('change', updateVoiceMeta);
els.previewVoice.addEventListener('click', previewVoice);
els.speak.addEventListener('click', generateSpeech);
els.record.addEventListener('click', startRecording);
els.stop.addEventListener('click', stopRecording);
els.copyTranscript.addEventListener('click', async () => {
  const text = els.transcript.textContent || '';
  if (!text) return;
  await navigator.clipboard.writeText(text).catch(() => {});
  setMessage(els.sttMsg, 'تم نسخ النص.', 'ok');
});

window.addEventListener('beforeunload', () => {
  state.stream?.getTracks().forEach((track) => track.stop());
  for (const pending of bridgePending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('تم إغلاق الصفحة.'));
  }
  bridgePending.clear();
});

createBridge();
void connect();

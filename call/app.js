const $ = (id) => document.getElementById(id);
const els = { state: $("stateLabel"), avatar: $("avatar"), wave: $("wave"), heard: $("heard"), start: $("start"), end: $("end"), log: $("log") };

const session = { active: false, turn: 0, busy: false, stream: null, recorder: null, chunks: [], audio: null, voice: null, messages: [], context: null, analyser: null, raf: 0, voicedAt: 0, startedAt: 0, hotFrames: 0 };

function stage(name, detail) {
  const line = `[STAGE] ${name}${detail === undefined ? "" : " " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`;
  console.log(line);
  els.log.textContent = `${line}\n${els.log.textContent}`.slice(0, 4000);
}

function setState(state, label) {
  els.avatar.dataset.state = state;
  els.wave.dataset.state = state;
  els.state.textContent = label;
}

async function vibi(action, payload = {}) {
  const body = { action, ...payload };
  const preview = { ...body, dataBase64: body.dataBase64 ? `[base64 ${body.dataBase64.length}]` : undefined };
  stage("sending request", { url: "/api/vibi", method: "POST", headers: { "Content-Type": "application/json" }, payload: preview });
  const response = await fetch("/api/vibi", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  stage("response", { action, status: response.status, body: data });
  if (!response.ok) {
    const error = new Error(data?.error || data?.message || data?.detail || text || `HTTP ${response.status}`);
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}

function preferredMime() {
  return ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
}

function encodeWav(buffer, sampleRate = 16000) {
  const length = Math.max(1, Math.floor(buffer.duration * sampleRate));
  const ratio = buffer.sampleRate / sampleRate;
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const index = Math.min(buffer.length - 1, Math.floor(i * ratio));
    let sample = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) sample += buffer.getChannelData(channel)[index] || 0;
    sample /= buffer.numberOfChannels;
    pcm[i] = Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 0x8000 : 0x7fff);
  }
  const out = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(out);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, pcm.length * 2, true);
  new Int16Array(out, 44).set(pcm);
  return new Blob([out], { type: "audio/wav" });
}

async function toAcceptedAudio(blob) {
  stage("recording stopped", { size: blob.size, mimeType: blob.type || "empty" });
  const context = session.context || new AudioContext();
  if (context.state === "suspended") await context.resume();
  try {
    const decoded = await context.decodeAudioData((await blob.arrayBuffer()).slice(0));
    const wav = encodeWav(decoded, 16000);
    stage("audio encoding", { from: blob.type, to: "audio/wav", bytes: wav.size, filename: "speech.wav" });
    return wav;
  } catch (error) {
    stage("audio encoding", { failed: error.message, fallback: blob.type });
    throw new Error("تسجيل Safari غير صالح وتم رفض تحويله. أعد الكلام لثانية أطول.");
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("تعذر قراءة التسجيل"));
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.readAsDataURL(blob);
  });
}

async function poll(kind, id) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const task = kind === "history" ? await vibi("history", { id }) : await vibi("stt.get", { taskId: id });
    if (task.status === "completed") return task;
    if (task.status === "failed") throw new Error(task.error || task.detail_error || task.message || "فشلت العملية");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("انتهت مهلة انتظار Vibi");
}

const SAUDI_VOICE = { voiceId: "Ywuz3KyW2N5pqKNpwcCL", modelId: "eleven_v3_conversational", name: "Eid" };

async function ensureVoice() {
  session.voice = SAUDI_VOICE;
  stage("voice selected", session.voice);
  return session.voice;
}

async function transcribe(blob) {
  const accepted = await toAcceptedAudio(blob);
  const dataBase64 = await blobToBase64(accepted);
  stage("sending STT request", { mimeType: accepted.type, filename: "speech.wav", bytes: accepted.size });
  const queued = await vibi("stt.submit", { dataBase64, mimeType: "audio/wav", filename: "speech.wav", provider: "elevenlabs" });
  stage("STT response", queued);
  const taskId = queued.task_id || queued.id;
  if (!taskId) throw new Error("Vibi لم يرجع رقم مهمة التفريغ");
  const task = await poll("stt", taskId);
  stage("STT response", { status: task.status, text: task.result?.text || task.text });
  return String(task.result?.text || task.text || task.transcript || "").trim();
}

async function chat(text) {
  session.messages.push({ role: "user", content: text });
  session.messages = session.messages.slice(-12);
  const data = await vibi("chat", { messages: session.messages });
  stage("chat response", data);
  const reply = String(data.text || "").trim();
  if (!reply) throw new Error("سايبر ما رجع رد");
  session.messages.push({ role: "assistant", content: reply });
  return reply;
}

async function speak(text, turn) {
  const voice = await ensureVoice();
  const queued = await vibi("tts", { provider: "elevenlabs", ...voice, text });
  stage("TTS response", queued);
  const id = queued.id || queued.task_id;
  if (!id) throw new Error("Vibi لم يرجع رقم مهمة الصوت");
  const task = await poll("history", id);
  stage("TTS response", { status: task.status, audio: task.result?.audio_url || task.audio_url });
  const raw = task.result?.audio_url || task.audio_url;
  if (!raw) throw new Error("Vibi لم يرجع ملف الصوت");
  if (!session.active || turn !== session.turn) return;
  const url = new URL(raw, "https://api.vibi.pro").href;
  setState("speaking", "سايبر يتكلم");
  els.heard.textContent = text;
  const audio = session.audio || new Audio();
  audio.setAttribute("playsinline", "true");
  session.audio = audio;
  audio.src = url;
  setState("speaking", "سايبر يتكلم");
  els.heard.textContent = text;
  await audio.play();
  await new Promise((resolve) => { audio.onended = resolve; audio.onerror = resolve; });
}

function explain(error) {
  const message = String(error?.message || error || "");
  if (/not allowed by the user agent|denied permission|NotAllowedError/i.test(message)) {
    return "المتصفح الداخلي في Grok منع المايك أو تشغيل الصوت. افتح الرابط في Safari واسمح بالمايك.";
  }
  return error?.body ? `${message} · ${JSON.stringify(error.body)}` : message;
}

function unlockAudio() {
  const audio = session.audio || new Audio();
  audio.setAttribute("playsinline", "true");
  audio.preload = "auto";
  session.audio = audio;
  audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
  return audio.play().then(() => { audio.pause(); audio.currentTime = 0; }).catch(() => {});
}
function stopRecorder() {
  if (session.recorder?.state === "recording") session.recorder.stop();
}

function startRecorder() {
  if (!session.stream || session.recorder?.state === "recording" || session.busy) return;
  session.chunks = [];
  const mimeType = preferredMime();
  const recorder = mimeType ? new MediaRecorder(session.stream, { mimeType }) : new MediaRecorder(session.stream);
  recorder.ondataavailable = (event) => { if (event.data?.size) session.chunks.push(event.data); };
  recorder.onstop = () => { void finishRecording(recorder.mimeType || mimeType || "audio/webm"); };
  session.recorder = recorder;
  recorder.start();
  session.startedAt = Date.now();
  stage("recording started", { mimeType: recorder.mimeType || mimeType, timeslice: null });
}

async function finishRecording(mimeType) {
  const blob = new Blob(session.chunks, { type: mimeType });
  session.recorder = null;
  if (!session.active || blob.size < 1200) return;
  const turn = ++session.turn;
  session.busy = true;
  try {
    setState("processing", "سايبر يسمع كلامك");
    const text = await transcribe(blob);
    if (!session.active || turn !== session.turn || !text) return;
    els.heard.textContent = `أنت: ${text}`;
    setState("processing", "سايبر يرد عليك");
    const reply = await chat(text);
    if (!session.active || turn !== session.turn) return;
    await speak(reply, turn);
  } catch (error) {
    if (turn !== session.turn) return;
    setState("error", "صار خطأ");
    els.heard.textContent = explain(error);
  } finally {
    if (turn === session.turn) session.busy = false;
    if (session.active && turn === session.turn && els.avatar.dataset.state !== "error") setState("listening", "سايبر يسمعك");
  }
}

function monitor() {
  if (!session.active || !session.analyser) return;
  const data = new Uint8Array(session.analyser.fftSize);
  session.analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const value of data) { const n = (value - 128) / 128; sum += n * n; }
  const rms = Math.sqrt(sum / data.length);
  const now = Date.now();
  if (rms > (session.busy || session.audio ? 0.06 : 0.032)) {
    session.hotFrames += 1;
    session.voicedAt = now;
    if (session.audio && session.hotFrames >= 5) {
      session.turn += 1;
      session.audio.pause();
      session.audio.src = "";
      session.busy = false;
      setState("listening", "قاطعت سايبر · يسمعك");
    }
    if (!session.busy && session.recorder?.state !== "recording" && session.hotFrames >= 3) startRecorder();
  } else {
    session.hotFrames = 0;
    if (session.recorder?.state === "recording" && now - session.voicedAt > 450 && now - session.startedAt > 380) stopRecorder();
  }
  session.raf = requestAnimationFrame(monitor);
}

async function startCall() {
  els.start.disabled = true;
  setState("processing", "أجهز الاتصال");
  const unlocked = unlockAudio();
  try {
    const status = await vibi("status");
    if (!status?.configured) throw new Error("مفتاح Vibi غير مربوط بالخادم");
    await unlocked;
    session.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    session.context = new AudioContext();
    await session.context.resume();
    session.analyser = session.context.createAnalyser();
    session.analyser.fftSize = 1024;
    session.context.createMediaStreamSource(session.stream).connect(session.analyser);
    session.active = true;
    session.messages = [];
    els.start.classList.add("hidden");
    els.end.classList.remove("hidden");
    setState("listening", "سايبر يسمعك");
    els.heard.textContent = "تكلم طبيعي… إذا سكت شوي بيرد عليك لحاله.";
    ensureVoice().catch((error) => stage("voice selected", error.message));
    monitor();
  } catch (error) {
    setState("error", "تعذر بدء الاتصال");
    els.heard.textContent = explain(error);
    els.start.disabled = false;
  }
}

function endCall() {
  session.active = false;
  session.turn += 1;
  cancelAnimationFrame(session.raf);
  stopRecorder();
  session.audio?.pause();
  session.stream?.getTracks().forEach((track) => track.stop());
  session.context?.close().catch(() => {});
  session.stream = null;
  session.context = null;
  session.analyser = null;
  els.start.disabled = false;
  els.start.classList.remove("hidden");
  els.end.classList.add("hidden");
  setState("idle", "انتهى الاتصال");
  els.heard.textContent = "إذا ودك نكمل، دق على سايبر مرة ثانية.";
}

els.start.addEventListener("click", startCall);
els.end.addEventListener("click", endCall);

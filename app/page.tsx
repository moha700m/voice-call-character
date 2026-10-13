'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CYBER_PERSONA } from './personas';

type CallState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
type Message = { role: 'user' | 'assistant'; content: string };
type Persona = { name: string; style: string; instructions: string; voiceURI: string };
type VoiceProvider = 'openrouter' | 'elevenlabs' | 'device';
type ConnectionConfig = {
  provider: VoiceProvider;
  openRouterKey: string;
  elevenLabsKey: string;
  voiceId: string;
  aiModel: string;
  ttsModel: string;
};

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
};

const DEFAULT_PERSONA: Persona = CYBER_PERSONA;
const PERSONA_STORAGE_KEY = 'voice-character-persona-v2';
const CONNECTION_STORAGE_KEY = 'majlis-voice-connection-v1';
const DEFAULT_CONNECTION: ConnectionConfig = {
  provider: 'openrouter',
  openRouterKey: '',
  elevenLabsKey: '',
  voiceId: 'george',
  aiModel: 'openai/gpt-5.6-luna',
  ttsModel: 'elevenlabs/eleven-v4-turbo',
};

const STATE_LABEL: Record<CallState, string> = {
  idle: 'جاهز للمكالمة',
  listening: 'أسمعك…',
  thinking: 'أفكر…',
  speaking: 'أتكلم…',
  error: 'صار خطأ',
};

export default function Home() {
  const [callActive, setCallActive] = useState(false);
  const [callState, setCallState] = useState<CallState>('idle');
  const [muted, setMuted] = useState(false);
  const [interim, setInterim] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [persona, setPersona] = useState<Persona>(DEFAULT_PERSONA);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [manualText, setManualText] = useState('');
  const [speechSupported, setSpeechSupported] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const [connection, setConnection] = useState<ConnectionConfig>(DEFAULT_CONNECTION);
  const [connectionStatus, setConnectionStatus] = useState('غير مربوط');
  const [testingConnection, setTestingConnection] = useState(false);

  const recognitionRef = useRef<RecognitionLike | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTextRef = useRef('');
  const callActiveRef = useRef(false);
  const mutedRef = useRef(false);
  const stateRef = useRef<CallState>('idle');
  const messagesRef = useRef<Message[]>([]);
  const personaRef = useRef<Persona>(DEFAULT_PERSONA);
  const connectionRef = useRef<ConnectionConfig>(DEFAULT_CONNECTION);

  const updateState = useCallback((next: CallState) => {
    stateRef.current = next;
    setCallState(next);
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PERSONA_STORAGE_KEY);
      if (stored) {
        const parsed = { ...DEFAULT_PERSONA, ...JSON.parse(stored) } as Persona;
        personaRef.current = parsed;
        setPersona(parsed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(CONNECTION_STORAGE_KEY);
      if (stored) {
        const parsed = { ...DEFAULT_CONNECTION, ...JSON.parse(stored) } as ConnectionConfig;
        connectionRef.current = parsed;
        setConnection(parsed);
        setConnectionStatus('محفوظ في الجلسة');
      }
    } catch {}
  }, []);

  function updateConnection(next: ConnectionConfig) {
    connectionRef.current = next;
    setConnection(next);
    sessionStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(next));
    setConnectionStatus('محفوظ في الجلسة');
  }


  function toBase64Url(bytes: Uint8Array) {
    let binary = '';
    bytes.forEach((value) => { binary += String.fromCharCode(value); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function randomToken(size = 32) {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return toBase64Url(bytes);
  }

  async function sha256Base64Url(value: string) {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return toBase64Url(new Uint8Array(digest));
  }

  async function connectOpenRouter() {
    setConnectionStatus('جاري فتح OpenRouter…');
    const verifier = randomToken(48);
    const state = randomToken(24);
    const challenge = await sha256Base64Url(verifier);

    sessionStorage.setItem('openrouter_pkce_verifier', verifier);
    sessionStorage.setItem('openrouter_oauth_state', state);

    const callback = new URL(window.location.origin + window.location.pathname);
    callback.searchParams.set('oauth', 'openrouter');
    callback.searchParams.set('state', state);

    const authUrl = new URL('https://openrouter.ai/auth');
    authUrl.searchParams.set('callback_url', callback.toString());
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    window.location.assign(authUrl.toString());
  }

  function disconnectOpenRouter() {
    const next = { ...connectionRef.current, provider: 'openrouter' as const, openRouterKey: '' };
    connectionRef.current = next;
    setConnection(next);
    sessionStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(next));
    sessionStorage.removeItem('openrouter_pkce_verifier');
    sessionStorage.removeItem('openrouter_oauth_state');
    setConnectionStatus('غير مربوط');
  }

  async function testConnection() {
    const current = connectionRef.current;
    if (current.provider === 'device') {
      setConnectionStatus('صوت الجهاز جاهز');
      return;
    }
    setTestingConnection(true);
    setConnectionStatus('جاري اختبار الربط...');
    try {
      const response = await fetch('/api/connect/test', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(current.openRouterKey ? { 'x-openrouter-key': current.openRouterKey } : {}),
          ...(current.elevenLabsKey ? { 'x-elevenlabs-key': current.elevenLabsKey } : {}),
        },
        body: JSON.stringify({ provider: current.provider }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'فشل الربط');
      setConnectionStatus('متصل - ' + (data.label || current.provider));
    } catch (error) {
      setConnectionStatus(error instanceof Error ? error.message : 'فشل الربط');
    } finally {
      setTestingConnection(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const oauth = params.get('oauth');
    if (oauth !== 'openrouter' || !code) return;

    const expectedState = sessionStorage.getItem('openrouter_oauth_state');
    const returnedState = params.get('state');
    const verifier = sessionStorage.getItem('openrouter_pkce_verifier');

    const cleanUrl = window.location.origin + window.location.pathname;

    if (!verifier || !expectedState || expectedState !== returnedState) {
      setConnectionStatus('تعذر التحقق من جلسة الربط');
      window.history.replaceState({}, '', cleanUrl);
      return;
    }

    setConnectionStatus('جاري إكمال الربط…');

    fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: 'S256',
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.key) throw new Error(data.error || 'فشل إكمال ربط OpenRouter');
        const next: ConnectionConfig = {
          ...connectionRef.current,
          provider: 'openrouter',
          openRouterKey: data.key,
          ttsModel: 'elevenlabs/eleven-v4-turbo',
        };
        connectionRef.current = next;
        setConnection(next);
        sessionStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(next));
        setConnectionStatus('متصل تلقائيًا بـ OpenRouter');
        sessionStorage.removeItem('openrouter_pkce_verifier');
        sessionStorage.removeItem('openrouter_oauth_state');
        window.history.replaceState({}, '', cleanUrl);
      })
      .catch((error) => {
        setConnectionStatus(error instanceof Error ? error.message : 'فشل الربط');
        window.history.replaceState({}, '', cleanUrl);
      });
  }, []);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  useEffect(() => {
    if (!callActive) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [callActive]);

  const stopRecognition = useCallback(() => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    try {
      recognitionRef.current?.stop();
    } catch {}
  }, []);

  const beginListening = useCallback(() => {
    if (!callActiveRef.current || mutedRef.current || stateRef.current === 'speaking' || stateRef.current === 'thinking') return;
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      setSpeechSupported(false);
      return;
    }

    if (!recognitionRef.current) {
      const recognition = new Recognition() as RecognitionLike;
      recognition.lang = 'ar-SA';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        let partial = '';
        let finalText = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = String(result[0]?.transcript || '').trim();
          if (result.isFinal) finalText += `${text} `;
          else partial += `${text} `;
        }
        setInterim(partial.trim());
        if (finalText.trim()) {
          pendingTextRef.current = `${pendingTextRef.current} ${finalText}`.trim();
          if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
          turnTimerRef.current = setTimeout(() => {
            const text = pendingTextRef.current.trim();
            pendingTextRef.current = '';
            setInterim('');
            if (text) window.dispatchEvent(new CustomEvent('voice-turn', { detail: text }));
          }, 1250);
        }
      };

      recognition.onerror = (event: any) => {
        if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
          setSpeechSupported(false);
          updateState('error');
        }
      };

      recognition.onend = () => {
        if (callActiveRef.current && !mutedRef.current && stateRef.current === 'listening') {
          restartTimerRef.current = setTimeout(() => {
            try {
              recognitionRef.current?.start();
            } catch {}
          }, 260);
        }
      };

      recognitionRef.current = recognition;
    }

    updateState('listening');
    try {
      recognitionRef.current.start();
    } catch {}
  }, [updateState]);

  const speak = useCallback(
    async (text: string) => {
      stopRecognition();
      updateState('speaking');

      const finish = () => {
        if (!callActiveRef.current) return;
        updateState('listening');
        setTimeout(beginListening, 180);
      };

      const browserFallback = () => {
        if (!('speechSynthesis' in window)) {
          finish();
          return;
        }

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ar-SA';
        utterance.rate = 0.96;
        utterance.pitch = 1.02;

        const selected = voices.find(
          (voice) => voice.voiceURI === personaRef.current.voiceURI,
        );
        const arabic = voices.find((voice) =>
          voice.lang.toLowerCase().startsWith('ar'),
        );
        if (selected || arabic) utterance.voice = selected || arabic || null;

        utterance.onend = finish;
        utterance.onerror = finish;
        window.speechSynthesis.speak(utterance);
      };

      try {
        const current = connectionRef.current;
        if (current.provider === 'device') {
          browserFallback();
          return;
        }

        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(current.openRouterKey ? { 'x-openrouter-key': current.openRouterKey } : {}),
            ...(current.elevenLabsKey ? { 'x-elevenlabs-key': current.elevenLabsKey } : {}),
          },
          body: JSON.stringify({
            text,
            provider: current.provider,
            voiceId: current.voiceId,
            ttsModel: current.ttsModel,
          }),
        });

        if (!response.ok) {
          throw new Error('TTS request failed: ' + response.status);
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const audio = new Audio(objectUrl);
        audio.preload = 'auto';

        audio.onended = () => {
          URL.revokeObjectURL(objectUrl);
          finish();
        };

        audio.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          browserFallback();
        };

        await audio.play();
      } catch (error) {
        console.error('eleven_v4_tts_failed', error);
        browserFallback();
      }
    },
    [beginListening, stopRecognition, updateState, voices],
  );

  const submitTurn = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || stateRef.current === 'thinking') return;
      stopRecognition();
      updateState('thinking');
      const nextMessages: Message[] = [...messagesRef.current, { role: 'user' as const, content: clean }].slice(-18);
      messagesRef.current = nextMessages;
      setMessages(nextMessages);

      try {
        const current = connectionRef.current;
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(current.openRouterKey ? { 'x-openrouter-key': current.openRouterKey } : {}),
          },
          body: JSON.stringify({
            messages: nextMessages,
            persona: personaRef.current,
            aiModel: current.aiModel,
          }),
        });
        const data = (await response.json()) as { text?: string; error?: string };
        if (!response.ok || !data.text) throw new Error(data.error || 'response failed');
        const withReply: Message[] = [...nextMessages, { role: 'assistant' as const, content: data.text }].slice(-18);
        messagesRef.current = withReply;
        setMessages(withReply);
        speak(data.text);
      } catch (error) {
        console.error(error);
        updateState('error');
        setTimeout(() => {
          if (callActiveRef.current) {
            updateState('listening');
            beginListening();
          }
        }, 1200);
      }
    },
    [beginListening, speak, stopRecognition, updateState],
  );

  useEffect(() => {
    const listener = (event: Event) => submitTurn((event as CustomEvent<string>).detail);
    window.addEventListener('voice-turn', listener);
    return () => window.removeEventListener('voice-turn', listener);
  }, [submitTurn]);

  async function startCall() {
    setSeconds(0);
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch {
      setSpeechSupported(false);
    }
    callActiveRef.current = true;
    setCallActive(true);
    mutedRef.current = false;
    setMuted(false);
    updateState('listening');
    setTimeout(beginListening, 180);
  }

  function endCall() {
    callActiveRef.current = false;
    setCallActive(false);
    setInterim('');
    pendingTextRef.current = '';
    if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    try {
      recognitionRef.current?.abort();
    } catch {}
    window.speechSynthesis?.cancel();
    updateState('idle');
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) stopRecognition();
    else if (callActiveRef.current) {
      updateState('listening');
      setTimeout(beginListening, 120);
    }
  }

  function savePersona(next: Persona) {
    personaRef.current = next;
    setPersona(next);
    localStorage.setItem(PERSONA_STORAGE_KEY, JSON.stringify(next));
  }

  function sendManual(event: FormEvent) {
    event.preventDefault();
    if (!manualText.trim()) return;
    const text = manualText;
    setManualText('');
    submitTurn(text);
  }

  const duration = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const lastMessages = messages.slice(-5);

  return (
    <main className="shell">
      <section className={`call-card ${callActive ? 'active' : ''}`}>
        <header className="topbar">
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="إعدادات الشخصية">⋯</button>
          <div className="security-pill"><span className="dot" /> مكالمة خاصة</div>
          <div className="spacer" />
        </header>

        <div className="hero">
          <div className={`avatar ${callState}`} aria-hidden="true">
            <div className="avatar-core">{persona.name.trim().charAt(0) || 'س'}</div>
            <div className="ring ring-one" />
            <div className="ring ring-two" />
          </div>
          <h1>{persona.name || 'سايبر'}</h1>
          <p className={`state state-${callState}`}>{callActive ? STATE_LABEL[callState] : 'شخصيتك الصوتية'}</p>
          {callActive && <div className="timer">{duration}</div>}
        </div>

        <div className="transcript" aria-live="polite">
          {lastMessages.length === 0 && !interim ? (
            <p className="empty-copy">{callActive ? 'تكلم براحتك… ما راح يرد إلا بعد ما تخلص.' : 'اضغط اتصال وابدأ الكلام بشكل طبيعي.'}</p>
          ) : (
            <>
              {lastMessages.map((message, index) => (
                <div className={`bubble ${message.role}`} key={`${index}-${message.content.slice(0, 10)}`}>
                  <span>{message.role === 'user' ? 'أنت' : persona.name}</span>
                  <p>{message.content}</p>
                </div>
              ))}
              {interim && <div className="live-caption">{interim}</div>}
            </>
          )}
        </div>

        {!speechSupported && callActive && (
          <form className="manual-input" onSubmit={sendManual}>
            <input value={manualText} onChange={(event) => setManualText(event.target.value)} placeholder="الميكروفون غير متاح — اكتب هنا" />
            <button type="submit">إرسال</button>
          </form>
        )}

        <div className="controls">
          {callActive ? (
            <>
              <button className={`control mute ${muted ? 'selected' : ''}`} onClick={toggleMute}>
                <span>{muted ? '⌁' : '◉'}</span><small>{muted ? 'تشغيل المايك' : 'كتم'}</small>
              </button>
              <button className="hangup" onClick={endCall} aria-label="إنهاء المكالمة"><span>×</span></button>
              <button className="control" onClick={() => setSettingsOpen(true)}>
                <span>⚙</span><small>الشخصية</small>
              </button>
            </>
          ) : (
            <button className="call-button" onClick={startCall}><span>●</span> اتصال الآن</button>
          )}
        </div>

        <footer>ربط من داخل الموقع · OpenRouter / ElevenLabs · Eleven v4 Turbo</footer>
      </section>

      {settingsOpen && (
        <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)}>
          <section className="settings-panel">
            <div className="panel-head"><div><small>تخصيص</small><h2>الشخصية</h2></div><button onClick={() => setSettingsOpen(false)}>×</button></div>
            <label>الاسم<input value={persona.name} onChange={(event) => savePersona({ ...persona, name: event.target.value })} maxLength={40} /></label>
            <label>أسلوب الكلام<textarea value={persona.style} onChange={(event) => savePersona({ ...persona, style: event.target.value })} rows={3} /></label>
            <label>تعليمات الشخصية<textarea value={persona.instructions} onChange={(event) => savePersona({ ...persona, instructions: event.target.value })} rows={12} /></label>
            <label>صوت الجهاز
              <select value={persona.voiceURI} onChange={(event) => savePersona({ ...persona, voiceURI: event.target.value })}>
                <option value="">تلقائي — أفضل صوت عربي متاح</option>
                {voices.map((voice) => <option value={voice.voiceURI} key={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}
              </select>
            </label>
            <div className="provider-note">
              <strong>مركز الربط</strong>
              <p>اربط حسابك بضغطة واحدة. ما تحتاج تنسخ أو تلصق API Key.</p>
            </div>

            <div className="provider-note">
              <strong>OpenRouter + ElevenLabs v4 Turbo</strong>
              <p>هذا الربط يشغل المحادثة وElevenLabs v4 Turbo بنفس الحساب.</p>
            </div>

            {connection.openRouterKey ? (
              <>
                <div className="provider-note"><strong>الحالة</strong><p>متصل تلقائيًا بـ OpenRouter</p></div>
                <button className="done" type="button" onClick={disconnectOpenRouter}>فصل OpenRouter</button>
              </>
            ) : (
              <button className="done" type="button" onClick={connectOpenRouter}>ربط OpenRouter تلقائيًا</button>
            )}

            <label>مودل المحادثة
              <select
                value={connection.aiModel}
                onChange={(event) => updateConnection({ ...connection, aiModel: event.target.value })}
              >
                <option value="openai/gpt-5.6-luna">GPT-5.6 Luna · سريع</option>
                <option value="openai/gpt-5.6-sol">GPT-5.6 Sol · أقوى</option>
                <option value="openai/chat-latest">GPT Chat Latest</option>
              </select>
            </label>

            <label>مودل الصوت
              <select
                value={connection.ttsModel}
                onChange={(event) => updateConnection({ ...connection, ttsModel: event.target.value })}
              >
                <option value="elevenlabs/eleven-v4-turbo">Eleven v4 Turbo · للمحادثات</option>
                <option value="elevenlabs/eleven-v4">Eleven v4 · جودة أعلى</option>
                <option value="elevenlabs/eleven-v3-conversational">Eleven v3 Conversational</option>
              </select>
            </label>

            <label>الصوت
              <input
                value={connection.voiceId}
                onChange={(event) => updateConnection({ ...connection, voiceId: event.target.value })}
                placeholder="george"
              />
            </label>

            <button className="done" type="button" onClick={testConnection} disabled={testingConnection || !connection.openRouterKey}>
              {testingConnection ? 'جاري الاختبار…' : 'اختبار الربط'}
            </button>

            <div className="provider-note"><strong>الحالة</strong><p>{connectionStatus}</p></div>
            <div className="provider-note">
              <strong>ElevenLabs مباشر</strong>
              <p>ElevenLabs لا يوفر OAuth عام لتطبيقات TTS الخارجية حاليًا؛ لذلك الربط التلقائي للصوت يتم عبر OpenRouter.</p>
            </div>
            <button className="done" onClick={() => setSettingsOpen(false)}>تم</button>
          </section>
        </div>
      )}
    </main>
  );
}

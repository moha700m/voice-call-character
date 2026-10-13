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

      const data = (await response.json()) as { ok?: boolean; label?: string; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || 'فشل الربط');
      setConnectionStatus('متصل - ' + (data.label || current.provider));
    } catch (error) {
      setConnectionStatus(error instanceof Error ? error.message : 'فشل الربط');
    } finally {
      setTestingConnection(false);
    }
  }

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
    (text: string) => {
      if (!('speechSynthesis' in window)) {
        updateState('listening');
        beginListening();
        return;
      }
      stopRecognition();
      window.speechSynthesis.cancel();
      updateState('speaking');

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ar-SA';
      utterance.rate = 0.96;
      utterance.pitch = 1.02;
      const selected = voices.find((voice) => voice.voiceURI === personaRef.current.voiceURI);
      const arabic = voices.find((voice) => voice.lang.toLowerCase().startsWith('ar'));
      if (selected || arabic) utterance.voice = selected || arabic || null;

      const finish = () => {
        if (!callActiveRef.current) return;
        updateState('listening');
        setTimeout(beginListening, 180);
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
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

        <footer>انتظار ذكي قبل الرد · عربي سعودي · GPT‑5.6 Luna</footer>
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
              <p>اختر المزود واربطه من هنا. المفاتيح تبقى داخل جلسة هذا المتصفح ولا تُكتب داخل كود الموقع.</p>
            </div>

            <label>طريقة إخراج الصوت
              <select
                value={connection.provider}
                onChange={(event) => updateConnection({ ...connection, provider: event.target.value as VoiceProvider })}
              >
                <option value="openrouter">OpenRouter · ElevenLabs</option>
                <option value="elevenlabs">ElevenLabs مباشر</option>
                <option value="device">صوت الجهاز</option>
              </select>
            </label>

            <label>OpenRouter API Key
              <input
                type="password"
                autoComplete="off"
                value={connection.openRouterKey}
                onChange={(event) => updateConnection({ ...connection, openRouterKey: event.target.value })}
                placeholder="sk-or-v1-..."
              />
            </label>

            <label>مودل المحادثة عبر OpenRouter
              <select
                value={connection.aiModel}
                onChange={(event) => updateConnection({ ...connection, aiModel: event.target.value })}
              >
                <option value="openai/gpt-5.6-luna">GPT-5.6 Luna · سريع</option>
                <option value="openai/gpt-5.6-sol">GPT-5.6 Sol · أقوى</option>
                <option value="openai/chat-latest">GPT Chat Latest</option>
              </select>
            </label>

            <label>مودل الصوت عبر OpenRouter
              <select
                value={connection.ttsModel}
                onChange={(event) => updateConnection({ ...connection, ttsModel: event.target.value })}
              >
                <option value="elevenlabs/eleven-v4-turbo">Eleven v4 Turbo · محادثات</option>
                <option value="elevenlabs/eleven-v4">Eleven v4 · أعلى جودة</option>
                <option value="elevenlabs/eleven-v3-conversational">Eleven v3 Conversational</option>
              </select>
            </label>

            <label>ElevenLabs API Key مباشر
              <input
                type="password"
                autoComplete="off"
                value={connection.elevenLabsKey}
                onChange={(event) => updateConnection({ ...connection, elevenLabsKey: event.target.value })}
                placeholder="xi-..."
              />
            </label>

            <label>{connection.provider === 'elevenlabs' ? 'ElevenLabs Voice ID' : 'Voice / Voice ID'}
              <input
                value={connection.voiceId}
                onChange={(event) => updateConnection({ ...connection, voiceId: event.target.value })}
                placeholder={connection.provider === 'elevenlabs' ? 'مثال: 21m00Tcm4TlvDq8ikWAM' : 'george'}
              />
            </label>

            <button
              className="done"
              type="button"
              onClick={testConnection}
              disabled={testingConnection}
            >
              {testingConnection ? 'جاري الاختبار…' : 'اختبار الربط'}
            </button>

            <div className="provider-note"><strong>الحالة</strong><p>{connectionStatus}</p></div>
            <button className="done" onClick={() => setSettingsOpen(false)}>تم</button>
          </section>
        </div>
      )}
    </main>
  );
}

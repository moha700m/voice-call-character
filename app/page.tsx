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
  const [voiceTestStatus, setVoiceTestStatus] = useState('');
  const [openRouterConnected, setOpenRouterConnected] = useState(false);

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
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeAudioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const audioAbortRef = useRef<AbortController | null>(null);
  const playbackTokenRef = useRef(0);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micSinkRef = useRef<GainNode | null>(null);
  const micFramesRef = useRef<Float32Array[]>([]);
  const micPreRollRef = useRef<Float32Array[]>([]);
  const micSpeechActiveRef = useRef(false);
  const micLastVoiceAtRef = useRef(0);
  const micSpeechStartedAtRef = useRef(0);
  const micSampleRateRef = useRef(48000);
  const transcriptionBusyRef = useRef(false);

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
        const parsed = {
          ...DEFAULT_CONNECTION,
          ...JSON.parse(stored),
          openRouterKey: '',
        } as ConnectionConfig;
        connectionRef.current = parsed;
        setConnection(parsed);
        sessionStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(parsed));
        setConnectionStatus('تم تحميل الإعدادات');
      }
    } catch {}
  }, []);

  function updateConnection(next: ConnectionConfig) {
    const sanitized = { ...next, openRouterKey: '' };
    connectionRef.current = sanitized;
    setConnection(sanitized);
    sessionStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(sanitized));
    setConnectionStatus('تم حفظ الإعدادات');
  }


  function connectOpenRouter() {
    setConnectionStatus('جاري فتح OpenRouter…');
    window.location.assign('/api/auth/openrouter/start');
  }

  async function disconnectOpenRouter() {
    try {
      await fetch('/api/auth/openrouter/disconnect', { method: 'POST' });
    } finally {
      setOpenRouterConnected(false);
      const next = {
        ...connectionRef.current,
        provider: 'openrouter' as const,
        openRouterKey: '',
      };
      connectionRef.current = next;
      setConnection(next);
      sessionStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(next));
      setConnectionStatus('غير مربوط');
    }
  }

  async function refreshOpenRouterStatus(showStatus = true) {
    try {
      const response = await fetch('/api/auth/openrouter/status', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = (await response.json()) as { connected?: boolean };
      const connected = Boolean(data.connected);
      setOpenRouterConnected(connected);
      if (showStatus) {
        setConnectionStatus(
          connected ? 'متصل تلقائيًا بـ OpenRouter' : 'غير مربوط',
        );
      }
      return connected;
    } catch {
      setOpenRouterConnected(false);
      if (showStatus) setConnectionStatus('تعذر قراءة حالة الربط');
      return false;
    }
  }

  async function testConnection() {
    const current = connectionRef.current;
    if (current.provider === 'device') {
      setConnectionStatus('صوت الجهاز جاهز');
      return;
    }

    setTestingConnection(true);
    setConnectionStatus('جاري اختبار الربط…');
    try {
      const response = await fetch('/api/connect/test', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          ...(current.elevenLabsKey
            ? { 'x-elevenlabs-key': current.elevenLabsKey }
            : {}),
        },
        body: JSON.stringify({ provider: current.provider }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        label?: string;
        error?: string;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'فشل الربط');
      }
      if (current.provider === 'openrouter') setOpenRouterConnected(true);
      setConnectionStatus('متصل · ' + (data.label || current.provider));
    } catch (error) {
      if (current.provider === 'openrouter') setOpenRouterConnected(false);
      setConnectionStatus(
        error instanceof Error ? error.message : 'فشل الربط',
      );
    } finally {
      setTestingConnection(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected') === 'openrouter';
    const connectError = params.get('connect_error');

    refreshOpenRouterStatus(false).then((status) => {
      if (connected && status) {
        setConnectionStatus('متصل تلقائيًا بـ OpenRouter');
        setSettingsOpen(true);
      } else if (connectError) {
        setConnectionStatus('فشل ربط OpenRouter. اضغط ربط وحاول مرة ثانية.');
        setSettingsOpen(true);
      } else {
        setConnectionStatus(status ? 'متصل تلقائيًا بـ OpenRouter' : 'غير مربوط');
      }
    });

    if (connected || connectError) {
      window.history.replaceState({}, '', window.location.pathname);
    }
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

  const getAudioContext = useCallback(() => {
    const AudioContextClass = (
      window.AudioContext || (window as any).webkitAudioContext
    ) as typeof AudioContext | undefined;

    if (!AudioContextClass) throw new Error('Web Audio غير مدعوم على هذا المتصفح.');

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass({ latencyHint: 'interactive' });
    }

    return audioContextRef.current;
  }, []);

  const unlockAudioOutput = useCallback(async () => {
    const context = getAudioContext();
    if (context.state === 'suspended') await context.resume();

    const silentBuffer = context.createBuffer(1, 1, 24000);
    const source = context.createBufferSource();
    source.buffer = silentBuffer;
    source.connect(context.destination);
    source.start();
    source.stop(context.currentTime + 0.001);
  }, [getAudioContext]);

  const stopAssistantAudio = useCallback(() => {
    playbackTokenRef.current += 1;
    audioAbortRef.current?.abort();
    audioAbortRef.current = null;

    for (const source of activeAudioSourcesRef.current) {
      try { source.stop(); } catch {}
    }
    activeAudioSourcesRef.current = [];
    window.speechSynthesis?.cancel();
  }, []);

  const playPcmStream = useCallback(
    async (response: Response, token: number) => {
      const context = getAudioContext();
      if (context.state === 'suspended') await context.resume();
      if (!response.body) throw new Error('لم يصل بث صوتي من المزود.');

      const reader = response.body.getReader();
      let nextStart = Math.max(context.currentTime + 0.06, context.currentTime);
      let carryByte: number | null = null;
      let scheduled = false;

      while (true) {
        if (token !== playbackTokenRef.current) {
          try { await reader.cancel(); } catch {}
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;

        let bytes = value;
        if (carryByte !== null) {
          const merged = new Uint8Array(value.byteLength + 1);
          merged[0] = carryByte;
          merged.set(value, 1);
          bytes = merged;
          carryByte = null;
        }

        if (bytes.byteLength % 2 === 1) {
          carryByte = bytes[bytes.byteLength - 1];
          bytes = bytes.slice(0, -1);
        }

        const sampleCount = bytes.byteLength / 2;
        if (!sampleCount) continue;

        const audioBuffer = context.createBuffer(1, sampleCount, 24000);
        const channel = audioBuffer.getChannelData(0);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        for (let index = 0; index < sampleCount; index += 1) {
          channel[index] = view.getInt16(index * 2, true) / 32768;
        }

        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(context.destination);
        source.start(nextStart);
        activeAudioSourcesRef.current.push(source);
        source.onended = () => {
          activeAudioSourcesRef.current = activeAudioSourcesRef.current.filter(
            (item) => item !== source,
          );
        };

        nextStart += audioBuffer.duration;
        scheduled = true;
      }

      if (!scheduled) throw new Error('وصل رد صوتي فارغ.');

      const remainingMs = Math.max(0, (nextStart - context.currentTime) * 1000);
      await new Promise((resolve) => setTimeout(resolve, remainingMs + 40));
    },
    [getAudioContext],
  );

  const playEncodedAudio = useCallback(
    async (response: Response, token: number) => {
      const context = getAudioContext();
      if (context.state === 'suspended') await context.resume();

      const encoded = await response.arrayBuffer();
      if (!encoded.byteLength) throw new Error('وصل رد صوتي فارغ.');

      const decoded = await context.decodeAudioData(encoded.slice(0));
      if (token !== playbackTokenRef.current) return;

      const source = context.createBufferSource();
      source.buffer = decoded;
      source.connect(context.destination);
      activeAudioSourcesRef.current.push(source);

      await new Promise<void>((resolve) => {
        source.onended = () => {
          activeAudioSourcesRef.current = activeAudioSourcesRef.current.filter(
            (item) => item !== source,
          );
          resolve();
        };
        source.start();
      });
    },
    [getAudioContext],
  );

  const fetchAndPlayVoice = useCallback(
    async (text: string) => {
      const current = connectionRef.current;
      if (current.provider === 'openrouter' && !openRouterConnected) {
        const connected = await refreshOpenRouterStatus(false);
        if (!connected) throw new Error('اربط OpenRouter أولًا.');
      }

      await unlockAudioOutput();
      audioAbortRef.current?.abort();
      const controller = new AbortController();
      audioAbortRef.current = controller;

      const token = ++playbackTokenRef.current;
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(current.elevenLabsKey ? { 'x-elevenlabs-key': current.elevenLabsKey } : {}),
        },
        body: JSON.stringify({
          text,
          provider: current.provider,
          voiceId: current.voiceId,
          ttsModel: current.ttsModel,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = '';
        try {
          const payload = await response.json();
          detail = payload?.error || '';
        } catch {
          detail = await response.text().catch(() => '');
        }
        throw new Error(detail || ('فشل الصوت: ' + response.status));
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('audio/pcm')) {
        await playPcmStream(response, token);
      } else {
        await playEncodedAudio(response, token);
      }
    },
    [openRouterConnected, playEncodedAudio, playPcmStream, unlockAudioOutput],
  );

  async function testSpeakerOutput() {
    setVoiceTestStatus('جاري اختبار السماعة…');
    try {
      await unlockAudioOutput();
      const context = getAudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.24);
      await new Promise((resolve) => setTimeout(resolve, 280));
      setVoiceTestStatus('السماعة شغالة ✓');
    } catch (error) {
      setVoiceTestStatus(error instanceof Error ? error.message : 'فشل اختبار السماعة');
    }
  }

  async function testCyberVoice() {
    setVoiceTestStatus('جاري اختبار Eleven v4 Turbo…');
    try {
      stopAssistantAudio();
      await fetchAndPlayVoice('هلا والله، اختبار الصوت شغال. إذا سمعتني فالمكالمة جاهزة.');
      setVoiceTestStatus('صوت سايبر شغال ✓');
    } catch (error) {
      console.error('voice_test_failed', error);
      setVoiceTestStatus(error instanceof Error ? error.message : 'فشل اختبار صوت سايبر');
    }
  }

  const stopRecognition = useCallback(() => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    try {
      recognitionRef.current?.stop();
    } catch {}
  }, []);

  const beginListening = useCallback(() => {
    if (!callActiveRef.current || mutedRef.current) return;
    updateState('listening');
  }, [updateState]);

  const encodeWav = useCallback(
    (frames: Float32Array[], sampleRate: number) => {
      let totalSamples = 0;
      for (const frame of frames) totalSamples += frame.length;

      const buffer = new ArrayBuffer(44 + totalSamples * 2);
      const view = new DataView(buffer);
      const writeString = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i += 1) {
          view.setUint8(offset + i, value.charCodeAt(i));
        }
      };

      writeString(0, 'RIFF');
      view.setUint32(4, 36 + totalSamples * 2, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, totalSamples * 2, true);

      let offset = 44;
      for (const frame of frames) {
        for (let i = 0; i < frame.length; i += 1) {
          const sample = Math.max(-1, Math.min(1, frame[i]));
          view.setInt16(
            offset,
            sample < 0 ? sample * 0x8000 : sample * 0x7fff,
            true,
          );
          offset += 2;
        }
      }

      return buffer;
    },
    [],
  );

  const submitVoiceFrames = useCallback(
    async (frames: Float32Array[], sampleRate: number) => {
      if (!frames.length || transcriptionBusyRef.current) return;
      transcriptionBusyRef.current = true;
      updateState('thinking');
      setInterim('أفهم كلامك…');

      try {
        const wav = encodeWav(frames, sampleRate);
        const response = await fetch('/api/transcribe', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'content-type': 'audio/wav',
          },
          body: wav,
        });

        const data = (await response.json()) as {
          text?: string;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error || 'تعذر فهم الصوت.');
        }

        const text = data.text?.trim() || '';
        setInterim('');

        if (!text) {
          if (callActiveRef.current && !mutedRef.current) {
            updateState('listening');
          }
          return;
        }

        window.dispatchEvent(
          new CustomEvent('voice-turn', { detail: text }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'تعذر فهم الصوت.';
        console.error('live_transcription_failed', error);
        setInterim(message);
        setVoiceTestStatus(message);

        setTimeout(() => {
          if (callActiveRef.current && !mutedRef.current) {
            setInterim('');
            updateState('listening');
          }
        }, 1000);
      } finally {
        transcriptionBusyRef.current = false;
      }
    },
    [encodeWav, updateState],
  );

  const stopLiveMic = useCallback(() => {
    try {
      micProcessorRef.current?.disconnect();
    } catch {}
    try {
      micSourceRef.current?.disconnect();
    } catch {}
    try {
      micSinkRef.current?.disconnect();
    } catch {}

    micProcessorRef.current = null;
    micSourceRef.current = null;
    micSinkRef.current = null;

    for (const track of micStreamRef.current?.getTracks() || []) {
      try {
        track.stop();
      } catch {}
    }
    micStreamRef.current = null;

    micFramesRef.current = [];
    micPreRollRef.current = [];
    micSpeechActiveRef.current = false;
    transcriptionBusyRef.current = false;
  }, []);

  const startLiveMic = useCallback(async () => {
    stopLiveMic();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });

    micStreamRef.current = stream;

    const context = getAudioContext();
    if (context.state === 'suspended') await context.resume();

    micSampleRateRef.current = context.sampleRate;

    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2048, 1, 1);
    const sink = context.createGain();
    sink.gain.value = 0;

    source.connect(processor);
    processor.connect(sink);
    sink.connect(context.destination);

    micSourceRef.current = source;
    micProcessorRef.current = processor;
    micSinkRef.current = sink;

    const voiceThreshold = 0.018;
    const silenceMs = 520;
    const minSpeechMs = 280;
    const maxSpeechMs = 18000;
    const preRollFrames = 7;

    processor.onaudioprocess = (event) => {
      if (
        !callActiveRef.current ||
        mutedRef.current ||
        stateRef.current !== 'listening' ||
        transcriptionBusyRef.current
      ) {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);

      let energy = 0;
      for (let i = 0; i < copy.length; i += 1) {
        energy += copy[i] * copy[i];
      }
      const rms = Math.sqrt(energy / Math.max(1, copy.length));
      const now = performance.now();

      if (!micSpeechActiveRef.current) {
        micPreRollRef.current.push(copy);
        if (micPreRollRef.current.length > preRollFrames) {
          micPreRollRef.current.shift();
        }
      }

      if (rms >= voiceThreshold) {
        if (!micSpeechActiveRef.current) {
          micSpeechActiveRef.current = true;
          micSpeechStartedAtRef.current = now;
          micFramesRef.current = [...micPreRollRef.current];
          micPreRollRef.current = [];
          setInterim('أسمعك…');
        }

        micLastVoiceAtRef.current = now;
        micFramesRef.current.push(copy);
        return;
      }

      if (!micSpeechActiveRef.current) return;

      micFramesRef.current.push(copy);

      const speechDuration = now - micSpeechStartedAtRef.current;
      const silentFor = now - micLastVoiceAtRef.current;
      const shouldFlush =
        (speechDuration >= minSpeechMs && silentFor >= silenceMs) ||
        speechDuration >= maxSpeechMs;

      if (!shouldFlush) return;

      const frames = micFramesRef.current;
      micFramesRef.current = [];
      micSpeechActiveRef.current = false;
      micPreRollRef.current = [];

      void submitVoiceFrames(frames, micSampleRateRef.current);
    };

    updateState('listening');
  }, [
    getAudioContext,
    stopLiveMic,
    submitVoiceFrames,
    updateState,
  ]);

  const speak = useCallback(
    async (text: string) => {
      updateState('speaking');

      const finish = () => {
        if (!callActiveRef.current) {
          updateState('idle');
          return;
        }
        updateState('listening');
        setTimeout(beginListening, 120);
      };

      const browserFallback = () => {
        if (!('speechSynthesis' in window)) {
          finish();
          return;
        }

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ar-SA';
        utterance.rate = 0.98;
        utterance.pitch = 1.0;

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

        stopAssistantAudio();
        await fetchAndPlayVoice(text);
        finish();
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return;
        console.error('streaming_tts_failed', error);
        setVoiceTestStatus(
          error instanceof Error ? error.message : 'تعذر تشغيل الرد الصوتي',
        );
        browserFallback();
      }
    },
    [
      beginListening,
      fetchAndPlayVoice,
      stopAssistantAudio,
      updateState,
      voices,
    ],
  );

  const submitTurn = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || stateRef.current === 'thinking') return;
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
          },
          credentials: 'same-origin',
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
        const message =
          error instanceof Error ? error.message : 'تعذر إكمال المكالمة.';
        setInterim(message);
        setVoiceTestStatus(message);
        updateState('error');
        setTimeout(() => {
          if (callActiveRef.current) {
            updateState('listening');
            beginListening();
          }
        }, 1200);
      }
    },
    [beginListening, speak, updateState],
  );

  useEffect(() => {
    const listener = (event: Event) => submitTurn((event as CustomEvent<string>).detail);
    window.addEventListener('voice-turn', listener);
    return () => window.removeEventListener('voice-turn', listener);
  }, [submitTurn]);

  async function startCall() {
    setSeconds(0);
    setVoiceTestStatus('');

    if (connectionRef.current.provider === 'openrouter') {
      const connected = await refreshOpenRouterStatus(false);
      if (!connected) {
        setConnectionStatus('اربط OpenRouter أولًا قبل بدء المكالمة.');
        setVoiceTestStatus('المكالمة تحتاج ربط OpenRouter.');
        setSettingsOpen(true);
        updateState('idle');
        return;
      }
    }

    try {
      await unlockAudioOutput();
    } catch (error) {
      setVoiceTestStatus(error instanceof Error ? error.message : 'تعذر تهيئة مخرج الصوت');
    }
    callActiveRef.current = true;
    setCallActive(true);
    mutedRef.current = false;
    setMuted(false);

    try {
      await startLiveMic();
      setSpeechSupported(true);
    } catch (error) {
      console.error('live_mic_start_failed', error);
      setSpeechSupported(false);
      setVoiceTestStatus(
        error instanceof Error ? error.message : 'تعذر تشغيل المايكروفون.',
      );
      updateState('error');
    }
  }

  function endCall() {
    callActiveRef.current = false;
    setCallActive(false);
    setInterim('');
    pendingTextRef.current = '';
    if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    stopLiveMic();
    stopAssistantAudio();
    updateState('idle');
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    for (const track of micStreamRef.current?.getAudioTracks() || []) {
      track.enabled = !next;
    }
    if (!next && callActiveRef.current) {
      updateState('listening');
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
            <p className="empty-copy">{callActive ? 'تكلم طبيعي… المايك مفتوح ويحدد نهاية كلامك تلقائيًا.' : 'اضغط اتصال — المايك يبقى مفتوح مثل مكالمة ويب.'}</p>
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

            {openRouterConnected ? (
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

            <button className="done" type="button" onClick={testConnection} disabled={testingConnection || !openRouterConnected}>
              {testingConnection ? 'جاري الاختبار…' : 'اختبار الربط'}
            </button>

            <button className="done" type="button" onClick={testSpeakerOutput}>
              اختبار السماعة
            </button>

            <button className="done" type="button" onClick={testCyberVoice} disabled={!openRouterConnected}>
              اختبار صوت سايبر
            </button>

            <div className="provider-note"><strong>الصوت</strong><p>{voiceTestStatus || 'جاهز للاختبار'}</p></div>
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

import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const maxDuration = 30;

const ALLOWED_OPENROUTER_MODELS = new Set([
  'elevenlabs/eleven-v4-turbo',
  'elevenlabs/eleven-v4',
  'elevenlabs/eleven-v3-conversational',
]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      text?: unknown;
      provider?: unknown;
      voiceId?: unknown;
      ttsModel?: unknown;
    };

    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 10000) : '';
    const provider = body.provider === 'elevenlabs' ? 'elevenlabs' : 'openrouter';
    const voiceId = typeof body.voiceId === 'string' ? body.voiceId.trim().slice(0, 120) : '';
    const requestedModel =
      typeof body.ttsModel === 'string' && ALLOWED_OPENROUTER_MODELS.has(body.ttsModel)
        ? body.ttsModel
        : 'elevenlabs/eleven-v4-turbo';

    if (!text) return Response.json({ error: 'النص مطلوب.' }, { status: 400 });

    if (provider === 'elevenlabs') {
      const apiKey =
        request.headers.get('x-elevenlabs-key')?.trim() ||
        process.env.ELEVENLABS_API_KEY?.trim();

      if (!apiKey) {
        return Response.json(
          { error: 'أدخل مفتاح ElevenLabs من إعدادات الموقع.' },
          { status: 401 },
        );
      }

      if (!voiceId) {
        return Response.json(
          { error: 'أدخل Voice ID لاستخدام ElevenLabs مباشر.' },
          { status: 400 },
        );
      }

      const upstream = await fetch(
        'https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128',
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model_id: 'eleven_v4_turbo',
            inputs: [{ text: text.slice(0, 2000), voice_id: voiceId }],
          }),
          cache: 'no-store',
        },
      );

      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        console.error('elevenlabs_direct_tts_error', upstream.status, detail.slice(0, 1000));
        return Response.json(
          { error: 'فشل ElevenLabs المباشر. تحقق من المفتاح وVoice ID.' },
          { status: upstream.status },
        );
      }

      return new Response(upstream.body, {
        headers: {
          'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
          'Cache-Control': 'no-store',
          'X-TTS-Provider': 'elevenlabs-direct',
          'X-TTS-Model': 'eleven_v4_turbo',
        },
      });
    }

    const cookieStore = await cookies();
    const apiKey =
      request.headers.get('x-openrouter-key')?.trim() ||
      cookieStore.get('openrouter_key')?.value ||
      process.env.OPENROUTER_API_KEY?.trim();

    if (!apiKey) {
      return Response.json(
        { error: 'OpenRouter غير مربوط. افتح الإعدادات واضغط ربط OpenRouter.' },
        { status: 401 },
      );
    }

    const upstream = await fetch('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'X-Title': 'Majlis Voice Room',
      },
      body: JSON.stringify({
        model: requestedModel,
        input: text,
        voice: voiceId || 'george',
        response_format: 'pcm',
        provider: {
          options: {
            elevenlabs: {
              output_format: 'pcm_24000',
              language_code: 'ar',
            },
          },
        },
      }),
      cache: 'no-store',
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('openrouter_tts_error', upstream.status, detail.slice(0, 1000));
      return Response.json(
        { error: 'فشل OpenRouter TTS. تحقق من المفتاح أو الصوت.' },
        { status: upstream.status },
      );
    }

    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'audio/pcm',
        'Cache-Control': 'no-store, no-transform',
        'X-TTS-Provider': 'openrouter',
        'X-TTS-Model': requestedModel,
        'X-Audio-Sample-Rate': '24000',
        'X-Audio-Channels': '1',
        'X-Audio-Format': 's16le',
      },
    });
  } catch (error) {
    console.error('tts_route_error', error);
    return Response.json({ error: 'تعذر تشغيل الصوت الآن.' }, { status: 500 });
  }
}

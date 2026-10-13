import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const apiKey =
      cookieStore.get('openrouter_key')?.value ||
      process.env.OPENROUTER_API_KEY?.trim();

    if (!apiKey) {
      return Response.json(
        { error: 'OpenRouter غير مربوط.' },
        { status: 401 },
      );
    }

    const audio = await request.arrayBuffer();
    if (audio.byteLength < 2000) {
      return Response.json({ text: '' });
    }

    if (audio.byteLength > 8 * 1024 * 1024) {
      return Response.json(
        { error: 'المقطع الصوتي طويل جدًا.' },
        { status: 413 },
      );
    }

    const base64 = Buffer.from(audio).toString('base64');

    const upstream = await fetch(
      'https://openrouter.ai/api/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'X-Title': 'Majlis Voice Room',
        },
        body: JSON.stringify({
          model: 'openai/whisper-large-v3-turbo',
          input_audio: {
            data: base64,
            format: 'wav',
          },
          language: 'ar',
          temperature: 0,
          response_format: 'json',
        }),
        cache: 'no-store',
      },
    );

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error(
        'openrouter_transcription_error',
        upstream.status,
        detail.slice(0, 1000),
      );
      return Response.json(
        {
          error:
            upstream.status === 401
              ? 'انتهت صلاحية ربط OpenRouter.'
              : 'تعذر فهم الصوت الآن.',
        },
        { status: upstream.status },
      );
    }

    const data = (await upstream.json()) as { text?: string };
    return Response.json({ text: data.text?.trim() || '' });
  } catch (error) {
    console.error('transcription_route_error', error);
    return Response.json(
      { error: 'تعذر معالجة الصوت الآن.' },
      { status: 500 },
    );
  }
}

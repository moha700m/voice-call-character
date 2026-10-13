export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { provider?: unknown };
    const provider = body.provider === 'elevenlabs' ? 'elevenlabs' : 'openrouter';

    if (provider === 'elevenlabs') {
      const key =
        request.headers.get('x-elevenlabs-key')?.trim() ||
        process.env.ELEVENLABS_API_KEY?.trim();

      if (!key) {
        return Response.json({ ok: false, error: 'أدخل مفتاح ElevenLabs.' }, { status: 401 });
      }

      const upstream = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': key },
        cache: 'no-store',
      });

      if (!upstream.ok) {
        return Response.json(
          { ok: false, error: 'مفتاح ElevenLabs غير صالح.' },
          { status: upstream.status },
        );
      }

      return Response.json({ ok: true, label: 'ElevenLabs مباشر' });
    }

    const key =
      request.headers.get('x-openrouter-key')?.trim() ||
      process.env.OPENROUTER_API_KEY?.trim();

    if (!key) {
      return Response.json({ ok: false, error: 'أدخل مفتاح OpenRouter.' }, { status: 401 });
    }

    const upstream = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: 'Bearer ' + key },
      cache: 'no-store',
    });

    if (!upstream.ok) {
      return Response.json(
        { ok: false, error: 'مفتاح OpenRouter غير صالح.' },
        { status: upstream.status },
      );
    }

    return Response.json({ ok: true, label: 'OpenRouter' });
  } catch (error) {
    console.error('connection_test_error', error);
    return Response.json({ ok: false, error: 'تعذر اختبار الربط.' }, { status: 500 });
  }
}

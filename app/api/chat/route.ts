import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const maxDuration = 30;

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type Persona = {
  name?: string;
  style?: string;
  instructions?: string;
};

function cleanMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ChatMessage => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Record<string, unknown>;
      return (
        (candidate.role === 'user' || candidate.role === 'assistant') &&
        typeof candidate.content === 'string'
      );
    })
    .slice(-18)
    .map((item) => ({
      role: item.role,
      content: item.content.slice(0, 1800),
    }));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      messages?: unknown;
      persona?: Persona;
      aiModel?: unknown;
    };

    const messages = cleanMessages(body.messages);
    const persona = body.persona ?? {};
    const name = (persona.name || 'سايبر').slice(0, 40);
    const style = (persona.style || 'سعودي، طبيعي، سريع وعفوي').slice(0, 300);
    const custom = (persona.instructions || '').slice(0, 12000);

    if (!messages.length) {
      return Response.json({ error: 'لا توجد رسالة.' }, { status: 400 });
    }

    const fallbackSystem = `أنت ${name}، شخصية صوتية افتراضية في مكالمة مباشرة. أسلوبك: ${style}.
تحدث بالعربية السعودية الطبيعية ما لم يطلب الطرف الآخر لغة مختلفة.
الرد صوتي؛ لذلك استخدم جملًا قصيرة وطبيعية، غالبًا من جملة واحدة إلى جملتين، بدون Markdown أو عناوين أو قوائم.
لا تكرر كلام المستخدم، ولا تبدأ كل رد بتحية، ولا تطيل الصمت بكلام حشو.
إذا كان الكلام غير واضح اطلب توضيحًا قصيرًا بدل التخمين.
انتظر دورك في الحوار؛ لا تتصرف كأنك قاطعت المتحدث.`;

    const system = custom || fallbackSystem;

    const cookieStore = await cookies();
    const openRouterKey =
      request.headers.get('x-openrouter-key')?.trim() ||
      cookieStore.get('openrouter_key')?.value ||
      process.env.OPENROUTER_API_KEY?.trim();

    if (!openRouterKey) {
      return Response.json(
        { error: 'OpenRouter غير مربوط. افتح الإعدادات واضغط ربط OpenRouter.' },
        { status: 401 },
      );
    }

    const aiModel =
      typeof body.aiModel === 'string' && body.aiModel.trim()
        ? body.aiModel.trim().slice(0, 120)
        : 'openai/gpt-5.6-luna';

    const upstream = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + openRouterKey,
          'Content-Type': 'application/json',
          'X-Title': 'Majlis Voice Room',
        },
        body: JSON.stringify({
          model: aiModel,
          messages: [
            { role: 'system', content: system },
            ...messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          ],
          max_tokens: 110,
          temperature: 0.72,
        }),
        cache: 'no-store',
      },
    );

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error(
        'openrouter_chat_error',
        upstream.status,
        detail.slice(0, 1000),
      );
      return Response.json(
        {
          error:
            upstream.status === 401
              ? 'انتهت صلاحية ربط OpenRouter. اربطه مرة ثانية.'
              : 'تعذر توليد الرد من OpenRouter.',
        },
        { status: upstream.status },
      );
    }

    const payload = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content?.trim() || '';

    if (!text) {
      return Response.json({ error: 'رجع OpenRouter برد فارغ.' }, { status: 502 });
    }

    return Response.json({ text });
  } catch (error) {
    console.error('chat_route_error', error);
    return Response.json({ error: 'تعذر توليد الرد الآن.' }, { status: 500 });
  }
}

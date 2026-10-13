import { generateText } from 'ai';

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
      return (candidate.role === 'user' || candidate.role === 'assistant') && typeof candidate.content === 'string';
    })
    .slice(-18)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 1800) }));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages?: unknown; persona?: Persona; aiModel?: unknown };
    const messages = cleanMessages(body.messages);
    const persona = body.persona ?? {};
    const name = (persona.name || 'ليان').slice(0, 40);
    const style = (persona.style || 'سعودية، هادية، عفوية وطبيعية').slice(0, 300);
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

    const transcript = messages
      .map((message) => `${message.role === 'user' ? 'المتصل' : name}: ${message.content}`)
      .join('\n');

    const openRouterKey =
      request.headers.get('x-openrouter-key')?.trim() ||
      process.env.OPENROUTER_API_KEY?.trim();

    let text = '';

    if (openRouterKey) {
      const aiModel =
        typeof body.aiModel === 'string' && body.aiModel.trim()
          ? body.aiModel.trim().slice(0, 120)
          : 'openai/gpt-5.6-luna';

      const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
            ...messages.map((message) => ({ role: message.role, content: message.content })),
          ],
          max_tokens: 110,
          temperature: 0.72,
        }),
        cache: 'no-store',
      });

      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        console.error('openrouter_chat_error', upstream.status, detail.slice(0, 1000));
        throw new Error('OpenRouter chat failed');
      }

      const payload = (await upstream.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      text = payload.choices?.[0]?.message?.content?.trim() || '';
    } else {
      const result = await generateText({
        model: process.env.AI_MODEL || 'openai/gpt-5.6-luna',
        system,
        prompt: transcript + '\n' + name + ':',
        maxOutputTokens: 110,
        temperature: 0.72,
      });
      text = result.text.trim();
    }

    if (!text) throw new Error('Empty model response');
    return Response.json({ text });
  } catch (error) {
    console.error('chat_route_error', error);
    return Response.json({ error: 'تعذر توليد الرد الآن.' }, { status: 500 });
  }
}

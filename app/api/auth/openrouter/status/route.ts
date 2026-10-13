import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function GET() {
  const cookieStore = await cookies();
  return Response.json({
    connected: Boolean(cookieStore.get('openrouter_key')?.value),
  });
}

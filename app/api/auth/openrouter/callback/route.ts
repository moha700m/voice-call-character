import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const verifier = request.cookies.get('openrouter_pkce')?.value;
  const home = new URL('/', request.url);

  if (!code || !verifier) {
    home.searchParams.set('connect_error', 'openrouter');
    return NextResponse.redirect(home);
  }

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: 'S256',
      }),
      cache: 'no-store',
    });

    const data = (await upstream.json()) as {
      key?: string;
      error?: string | { message?: string };
    };

    if (!upstream.ok || !data.key) {
      console.error('openrouter_oauth_exchange_error', upstream.status, data);
      home.searchParams.set('connect_error', 'openrouter');
      const failed = NextResponse.redirect(home);
      failed.cookies.set('openrouter_pkce', '', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      });
      return failed;
    }

    home.searchParams.set('connected', 'openrouter');
    const response = NextResponse.redirect(home);
    response.cookies.set('openrouter_key', data.key, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });
    response.cookies.set('openrouter_pkce', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return response;
  } catch (error) {
    console.error('openrouter_oauth_callback_error', error);
    home.searchParams.set('connect_error', 'openrouter');
    return NextResponse.redirect(home);
  }
}

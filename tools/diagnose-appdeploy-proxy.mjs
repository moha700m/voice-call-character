import dns from 'node:dns/promises';

const host = 'elevenlabs-voice-call-al26uz.v2.appdeploy.ai';
const url = `https://${host}/api/vibi`;

const report = { dns: null, options: null, post: null };

try {
  report.dns = await dns.lookup(host, { all: true });
} catch (error) {
  report.dns = { error: String(error?.message || error) };
}

try {
  const response = await fetch(url, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://moha700m.github.io',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  report.options = {
    status: response.status,
    url: response.url,
    headers: Object.fromEntries(response.headers.entries()),
    body: (await response.text()).slice(0, 1000),
  };
} catch (error) {
  report.options = { error: String(error?.stack || error) };
}

try {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Origin: 'https://moha700m.github.io',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'status' }),
  });
  report.post = {
    status: response.status,
    url: response.url,
    headers: Object.fromEntries(response.headers.entries()),
    body: (await response.text()).slice(0, 2000),
  };
} catch (error) {
  report.post = { error: String(error?.stack || error) };
}

console.log(JSON.stringify(report, null, 2));
if (report.post?.error || report.options?.error) process.exitCode = 1;

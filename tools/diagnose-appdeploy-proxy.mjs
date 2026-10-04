import dns from 'node:dns/promises';

const host = 'elevenlabs-voice-call-al26uz.v2.appdeploy.ai';
const root = `https://${host}/`;
const apiUrl = `https://${host}/api/vibi`;

const report = { dns: null, root: null, options: null, post: null };

try {
  report.dns = await dns.lookup(host, { all: true });
} catch (error) {
  report.dns = { error: String(error?.message || error) };
}

try {
  const response = await fetch(root, { redirect: 'follow' });
  report.root = {
    status: response.status,
    url: response.url,
    headers: Object.fromEntries(response.headers.entries()),
    bodyStart: (await response.text()).slice(0, 200),
  };
} catch (error) {
  report.root = { error: String(error?.stack || error) };
}

try {
  const response = await fetch(apiUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://moha700m.github.io',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  report.options = {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
  };
} catch (error) {
  report.options = { error: String(error?.stack || error) };
}

try {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { Origin: 'https://moha700m.github.io', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'status' }),
  });
  report.post = {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
  };
} catch (error) {
  report.post = { error: String(error?.stack || error) };
}

console.log(JSON.stringify(report, null, 2));

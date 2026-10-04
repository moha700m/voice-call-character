const BRIDGE = "https://api-v2.appdeploy.ai/app/elevenlabs-voice-call-al26uz/api/vibi";
const BRIDGE_ORIGIN = "https://elevenlabs-voice-call-al26uz.v2.appdeploy.ai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const upstream = await fetch(BRIDGE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: BRIDGE_ORIGIN,
    },
    body: JSON.stringify(req.body || {}),
  });
  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
  res.send(text);
}

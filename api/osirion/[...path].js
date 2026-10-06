const OSIRION = "https://fnapi.osirion.gg";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ success: false, errorMessage: "Method not allowed" });
    return;
  }

  const segments = req.query.path;
  const path = Array.isArray(segments) ? segments.join("/") : segments || "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key === "path") continue;
    if (Array.isArray(value)) value.forEach((part) => params.append(key, part));
    else params.append(key, value);
  }
  const qs = params.toString();
  const target = `${OSIRION}/${path}${qs ? `?${qs}` : ""}`;

  try {
    const upstream = await fetch(target, { headers: { Accept: "application/json" } });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(text);
  } catch {
    res.status(502).json({ success: false, errorMessage: "Could not reach Osirion stats API." });
  }
}

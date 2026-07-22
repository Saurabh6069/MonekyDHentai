// Generates sitemap.xml dynamically from the live Firestore data.
// Runs as a Vercel serverless function — no setup needed beyond deploying this file.

const PROJECT_ID = "monekydhentai";
const SITE_URL = "https://monkey-d-manga.vercel.app";

function decodeValue(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const key of Object.keys(fields || {})) out[key] = decodeValue(fields[key]);
  return out;
}

function escapeXml(str) {
  return String(str).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

export default async function handler(req, res) {
  let series = [];
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/site/data`;
    const r = await fetch(url);
    if (r.ok) {
      const json = await r.json();
      const data = decodeFields(json.fields || {});
      series = (data.series || []).filter(s => s && s.status !== "draft");
    }
  } catch (e) {
    // fall through — still return a sitemap with just the homepage
  }

  const urls = [
    { loc: `${SITE_URL}/`, priority: "1.0" },
    ...series.map(s => ({ loc: `${SITE_URL}/#/series/${s.id}`, priority: "0.8" })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>\n    <loc>${escapeXml(u.loc)}</loc>\n    <priority>${u.priority}</priority>\n  </url>`).join("\n")}
</urlset>`;

  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
  res.status(200).send(xml);
}

// Generates a bot-friendly share page with correct Open Graph tags,
// then redirects real visitors into the actual app.
// Example: /api/share?type=series&id=abc
//          /api/share?type=chapter&seriesId=abc&chapterId=xyz

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
function escapeHtml(str) {
  return String(str).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

export default async function handler(req, res) {
  const { type, id, seriesId, chapterId } = req.query;
  const ua = req.headers["user-agent"] || "";
  const isBot = /facebookexternalhit|Facebot|Twitterbot|Discordbot|WhatsApp|TelegramBot|LinkedInBot|Slackbot|SkypeUriPreview|Pinterest|vkShare|Applebot|Googlebot|bingbot|redditbot/i.test(ua);

  let siteName = "Scroll";
  let title = "Scroll — Webtoon Reader";
  let description = "Vertical stories, one panel at a time.";
  let image = "";
  let destination = SITE_URL + "/";

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/site/data`;
    const r = await fetch(url);
    if (r.ok) {
      const json = await r.json();
      const data = decodeFields(json.fields || {});
      siteName = data.settings?.siteTitle?.trim() || siteName;
      description = data.settings?.tagline?.trim() || description;
      const series = (data.series || []).find(s => s.id === (type === "chapter" ? seriesId : id));

      if (type === "series" && series) {
        title = `${series.title} — ${siteName}`;
        description = series.description?.trim().slice(0, 160) || `Read ${series.title} online on ${siteName}.`;
        image = series.coverUrl || "";
        destination = `${SITE_URL}/#/series/${series.id}`;
      } else if (type === "chapter" && series) {
        const chapter = (data.chapters || []).find(c => c.id === chapterId);
        title = chapter ? `${series.title} — Ep. ${String(chapter.number).padStart(2, "0")} | ${siteName}` : `${series.title} — ${siteName}`;
        description = chapter ? `Read ${series.title} episode ${chapter.number} online on ${siteName}.` : description;
        image = series.coverUrl || "";
        destination = `${SITE_URL}/#/series/${seriesId}/chapter/${chapterId}`;
      }
    }
  } catch (e) {
    // fall through with defaults — visitor still gets redirected to the homepage
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="${escapeHtml(siteName)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
${image ? `<meta property="og:image" content="${escapeHtml(image)}" />
<meta property="og:image:secure_url" content="${escapeHtml(image)}" />
<meta property="og:image:width" content="800" />
<meta property="og:image:height" content="1200" />` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : ""}
${isBot ? "" : `<meta http-equiv="refresh" content="0; url=${escapeHtml(destination)}" />
<script>window.location.replace(${JSON.stringify(destination)});</script>`}
</head>
<body>
<p>${isBot ? escapeHtml(title) : `Redirecting to <a href="${escapeHtml(destination)}">${escapeHtml(title)}</a>…`}</p>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
  res.status(200).send(html);
}

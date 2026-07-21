// Vercel Edge Function — Tracking Pixel متقدم لكراج الأزهران
// GCLID, UTM, ValueTrack, IP enrichment, lead scoring
// يدعم GET (img src) و POST (engagement)

const PIXEL_GIF = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
  0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21,
  0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
  0x01, 0x00, 0x3b,
]);

export const config = { runtime: 'edge' };

const GOOGLE_ADS_CID = '3652624156'; // Azharan CID

// ─── Helpers ────────────────────────────────────────────

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractAttribution(url) {
  const a = {};
  const p = url.searchParams;
  if (p.get('gclid')) a.gclid = p.get('gclid');
  if (p.get('fbclid')) a.fbclid = p.get('fbclid');
  if (p.get('utm_source')) a.utm_source = p.get('utm_source');
  if (p.get('utm_medium')) a.utm_medium = p.get('utm_medium');
  if (p.get('utm_campaign')) a.utm_campaign = p.get('utm_campaign');
  if (p.get('utm_term')) a.utm_term = p.get('utm_term');
  if (p.get('utm_content')) a.utm_content = p.get('utm_content');
  if (p.get('campaign_id')) a.campaign_id = p.get('campaign_id');
  if (p.get('ad_group_id')) a.ad_group_id = p.get('ad_group_id');
  if (p.get('keyword')) a.keyword = p.get('keyword');
  if (p.get('creative')) a.creative = p.get('creative');
  if (p.get('match_type')) a.match_type = p.get('match_type');
  if (p.get('network')) a.network = p.get('network');
  if (p.get('device')) a.device = p.get('device');
  if (p.get('label')) a.label = p.get('label');
  extractReferrer(a, p);
  return a;
}

function extractReferrer(a, p) {
  const ref = p.get('ref') || '';
  if (ref) a.referrer = ref.slice(0, 300);
  // Search keyword from Google referrer
  try {
    const ru = new URL(decodeURIComponent(ref));
    if (ru.hostname.includes('google.') && ru.searchParams.get('q')) {
      a.search_keyword = ru.searchParams.get('q').slice(0, 80);
    }
  } catch {}
}

function detectDevice(ua) {
  const l = ua.toLowerCase();
  const mobile = /mobile|iphone|ipad|android.*mobile|blackberry/i.test(l);
  const tablet = /ipad|android(?!.*mobile)|tablet/i.test(l);
  if (tablet) return '📱 Tablet';
  if (mobile) return '📱 هاتف';
  return '💻 حاسوب';
}

function detectOS(ua) {
  const l = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(l)) return 'iOS';
  if (/mac os x|macintosh/.test(l)) return 'macOS';
  if (/android/.test(l)) return 'Android';
  if (/windows/.test(l)) return 'Windows';
  if (/linux/.test(l)) return 'Linux';
  return '';
}

function detectBrowser(ua) {
  const l = ua.toLowerCase();
  if (/safari/.test(l) && !/chrome|chromium/.test(l)) return 'Safari';
  if (/edg/.test(l)) return 'Edge';
  if (/firefox/.test(l)) return 'Firefox';
  if (/chrome|chromium/.test(l)) return 'Chrome';
  return '';
}

function getLeadScore(a) {
  let s = 0;
  if (a.gclid) s += 30;
  if (a.fbclid) s += 25;
  if (a.utm_campaign) s += 15;
  if (a.utm_term) s += 10;
  if (a.keyword) s += 15;
  if (a.search_keyword) s += 5;
  return Math.min(100, s);
}

function getLabel(a) {
  if (a.gclid) return '📢 إعلان Google';
  if (a.fbclid) return '📢 إعلان فيسبوك';
  if (a.utm_source) return `📢 ${a.utm_source}`;
  return '👤 مباشر / عضوي';
}

function isBot(ua) {
  return /bot|crawl|spider|preview|health|ping|vercel/i.test(ua);
}

// ─── Enrich: Google Ads Campaign Name ───────────────────

async function getGoogleAdsAccessToken() {
  const cid = process.env.GOOGLE_ADS_CLIENT_ID;
  const cs = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const rt = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!cid || !cs || !rt) return null;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${encodeURIComponent(cid)}&client_secret=${encodeURIComponent(cs)}&refresh_token=${encodeURIComponent(rt)}&grant_type=refresh_token`,
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.access_token || null;
  } catch { return null; }
}

async function resolveCampaign(customerId, campaignId, token) {
  const dt = process.env.GOOGLE_ADS_DEV_TOKEN;
  const mcc = process.env.GOOGLE_ADS_MCC_ID || '5565578031';
  if (!dt) return null;
  try {
    const r = await fetch(`https://googleads.googleapis.com/v24/customers/${customerId}/campaigns/${campaignId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'developer-token': dt,
        'login-customer-id': mcc,
      },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.name || null;
  } catch { return null; }
}

async function enrichAndNotify(campaignId, attribution) {
  const token = await getGoogleAdsAccessToken();
  if (!token) return;
  const name = await resolveCampaign(GOOGLE_ADS_CID, campaignId, token);
  if (!name) return;
  const msg = [
    `<b>📋 تفاصيل الحملة — الأزهران</b>`,
    `<b>الحملة:</b> ${escapeHtml(name)}`,
    attribution.keyword ? `<b>الكلمة:</b> ${escapeHtml(attribution.keyword)}` : '',
    `<b>معرّف الحملة:</b> <code>${escapeHtml(campaignId)}</code>`,
  ].filter(Boolean).join('\n');
  await sendTelegram(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID, msg);
}

// ─── Telegram ───────────────────────────────────────────

async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch {}
}

// ─── Main Handler ───────────────────────────────────────

export default async function handler(req) {
  const url = new URL(req.url);
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  // Extract data
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip') || 'غير معروف';
  const ua = req.headers.get('user-agent') || 'غير معروف';
  const referrer = req.headers.get('referer') || '';

  // Bot check
  if (isBot(ua)) {
    return new Response(PIXEL_GIF, {
      status: 200,
      headers: { 'Content-Type': 'image/gif', 'Content-Length': '43', 'Cache-Control': 'public, max-age=86400', ...cors },
    });
  }

  // Attribution from query params or body
  let attribution = {};
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      attribution = extractAttribution(new URL(`http://x?${new URLSearchParams(body).toString()}`));
      if (body.page) attribution.page = body.page;
    } catch {}
  }

  // Merge with URL params
  const urlAttribution = extractAttribution(url);
  attribution = { ...urlAttribution, ...attribution };
  attribution.page = attribution.page || url.searchParams.get('page') || referrer.replace(/https?:\/\/[^\/]+/, '') || '/';

  // IP enrichment via Vercel
  const city = req.headers.get('x-vercel-ip-city') || '';
  const region = req.headers.get('x-vercel-ip-country-region') || '';
  const country = req.headers.get('x-vercel-ip-country') || '';
  const lat = req.headers.get('x-vercel-ip-latitude') || '';
  const lon = req.headers.get('x-vercel-ip-longitude') || '';
  const asn = req.headers.get('x-vercel-ip-as-number') || '';
  const provider = req.headers.get('x-vercel-ip-as-name') || '';

  const location = [city, region, country].filter(Boolean).join('، ') || 'غير متاح';
  const coords = (lat && lon) ? `${lat}, ${lon}` : null;
  const network = provider ? `${escapeHtml(provider)} (<code>${escapeHtml(asn)}</code>)` : (asn ? `<code>${escapeHtml(asn)}</code>` : 'غير متاح');

  // Lead score
  const score = getLeadScore(attribution);
  const label = getLabel(attribution);

  // Build message
  const time = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' +04';
  const pagePath = typeof attribution.page === 'string' ? attribution.page.slice(0, 100) : '/';

  // Attribution lines
  const attrLines = [];
  if (attribution.gclid) {
    attrLines.push(`<b>GCLID:</b> ✅ ← إعلان Google`);
    attrLines.push(`<code>${escapeHtml(attribution.gclid.slice(0, 30))}...</code>`);
  }
  if (attribution.fbclid) {
    attrLines.push(`<b>FBCLID:</b> ✅ ← إعلان فيسبوك`);
  }
  if (attribution.utm_source || attribution.utm_campaign) {
    const utm = [attribution.utm_source, attribution.utm_medium, attribution.utm_campaign].filter(Boolean).join(' / ');
    attrLines.push(`<b>UTM:</b> ${escapeHtml(utm)}`);
  }
  if (attribution.campaign_id) {
    attrLines.push(`<b>معرّف الحملة:</b> <code>${escapeHtml(attribution.campaign_id)}</code>`);
  }
  if (attribution.keyword) {
    attrLines.push(`<b>الكلمة:</b> ${escapeHtml(attribution.keyword)}`);
  }
  if (attribution.search_keyword) {
    attrLines.push(`<b>بحث:</b> ${escapeHtml(attribution.search_keyword)}`);
  }
  if (attribution.match_type) {
    attrLines.push(`<b>تطابق:</b> ${escapeHtml(attribution.match_type)}`);
  }

  const msg = [
    `<b>🟢 الأزهران — زيارة جديدة</b>`,
    `🕐 ${time}`,
    `<b>الصفحة:</b> <code>${escapeHtml(pagePath)}</code>`,
    ``,
    ...(attrLines.length ? [`<b>📢 مصدر الزيارة:</b>`, ...attrLines, ``] : []),
    `<b>التصنيف:</b> ${label}`,
    `<b>التقييم:</b> ${score}/100${score >= 70 ? ' — عميل محتمل قوي' : score >= 40 ? ' — مهتم' : ''}`,
    ``,
    `<b>📍 الموقع:</b> ${escapeHtml(location)}`,
    coords ? `<b>🗺️ الإحداثيات:</b> <code>${escapeHtml(coords)}</code>` : '',
    `<b>الجهاز:</b> ${detectDevice(ua)} ${detectOS(ua)} ${detectBrowser(ua)}`,
    ``,
    `<b>🌐 IP:</b> <code>${escapeHtml(ip)}</code>`,
    `<b>🏢 الشبكة:</b> ${network}`,
  ].filter(Boolean).join('\n');

  // Send notification
  await sendTelegram(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID, msg);

  // Enrich campaign name
  if (attribution.campaign_id) {
    try { await enrichAndNotify(attribution.campaign_id, attribution); } catch {}
  }

  return new Response(PIXEL_GIF, {
    status: 200,
    headers: { 'Content-Type': 'image/gif', 'Content-Length': '43', 'Cache-Control': 'no-cache, no-store', ...cors },
  });
}

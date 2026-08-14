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

function decodeValue(value) {
  let decoded = String(value || '').replace(/\+/g, ' ');
  try { decoded = decodeURIComponent(decoded); } catch {}
  return decoded;
}

function getPageDetails(value) {
  const raw = decodeValue(value || '/');
  try {
    const pageUrl = new URL(raw, 'https://www.al-azharan-auto-maint.com');
    const path = pageUrl.pathname.replace(/\/$/, '') || '/';
    const names = {
      '/': 'الرئيسية',
      '/porsche': 'بورش',
      '/audi': 'أودي',
      '/bentley': 'بنتلي',
      '/call': 'اتصل بنا',
    };
    return {
      name: names[path.toLowerCase()] || path,
      keyword: decodeValue(pageUrl.searchParams.get('kw') || pageUrl.searchParams.get('keyword') || pageUrl.searchParams.get('utm_term') || ''),
    };
  } catch {
    return { name: raw.slice(0, 80), keyword: '' };
  }
}

function formatLocation(city, country) {
  const cityName = decodeValue(city);
  const localizedCities = {
    'Abu Dhabi': 'أبوظبي', Dubai: 'دبي', Sharjah: 'الشارقة', Ajman: 'عجمان',
    'Ras Al Khaimah': 'رأس الخيمة', Fujairah: 'الفجيرة', 'Umm Al Quwain': 'أم القيوين',
  };
  const localizedCountries = { AE: 'الإمارات' };
  return [localizedCities[cityName] || cityName, localizedCountries[country] || decodeValue(country)]
    .filter(Boolean).join('، ') || 'غير متاح';
}

function formatUaeTime() {
  return new Intl.DateTimeFormat('ar-AE', {
    timeZone: 'Asia/Dubai', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date());
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
  if (p.get('ev')) a.ev = p.get('ev');
  if (p.get('kw')) a.kw = p.get('kw');
  if (p.get('search_keyword')) a.search_keyword = p.get('search_keyword');
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
  if (tablet) return 'Tablet';
  if (mobile) return 'هاتف';
  return 'حاسوب';
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

function getLeadScore(a, event) {
  let s = 0;
  if (a.gclid) s += 30;
  if (a.fbclid) s += 25;
  if (a.utm_campaign) s += 15;
  if (a.utm_term) s += 10;
  if (a.keyword) s += 15;
  if (a.search_keyword) s += 5;
  if (event === 'call' || event === 'whatsapp') s += 30;
  return Math.min(100, s);
}

function getScoreLabel(score, event) {
  if (event === 'call' || event === 'whatsapp') return score >= 70 ? 'عميل محتمل قوي 🔥' : 'تفاعل مهم ✅';
  if (score >= 70) return 'عميل محتمل قوي 🔥';
  if (score >= 40) return 'مهتم';
  if (score > 0) return 'اهتمام أولي';
  return 'زيارة بدون بيانات إعلانية';
}

function getEventTitle(event) {
  if (event === 'call') return '📞 ضغط زر الاتصال — الأزهران';
  if (event === 'whatsapp') return '💬 ضغط واتساب — الأزهران';
  return '🟢 زيارة جديدة — الأزهران';
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

async function sendTelegram(token, chatId, text, replyMarkup) {
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
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
  try {
    const pageAttribution = extractAttribution(new URL(attribution.page, 'https://www.al-azharan-auto-maint.com'));
    attribution = { ...pageAttribution, ...attribution };
  } catch {}

  // IP enrichment via Vercel
  const city = req.headers.get('x-vercel-ip-city') || '';
  const country = req.headers.get('x-vercel-ip-country') || '';
  const asn = req.headers.get('x-vercel-ip-as-number') || '';
  const provider = req.headers.get('x-vercel-ip-as-name') || '';

  const location = formatLocation(city, country);
  const network = provider ? `${escapeHtml(provider)} (<code>${escapeHtml(asn)}</code>)` : (asn ? `<code>${escapeHtml(asn)}</code>` : 'غير متاح');

  // Lead score
  const event = attribution.ev || 'pageview';
  const score = getLeadScore(attribution, event);
  const label = getLabel(attribution);

  // Build concise Arabic message
  const time = formatUaeTime();
  const page = getPageDetails(attribution.page);
  const keyword = decodeValue(attribution.keyword || attribution.kw || attribution.search_keyword || page.keyword);

  const adLines = [];
  if (attribution.gclid) adLines.push(`<b>Google Ads:</b> ✅`);
  if (attribution.fbclid) adLines.push(`<b>Facebook Ads:</b> ✅`);
  if (attribution.campaign_id) adLines.push(`<b>الحملة:</b> <code>${escapeHtml(attribution.campaign_id)}</code>`);
  if (attribution.match_type) adLines.push(`<b>التطابق:</b> ${escapeHtml(attribution.match_type)}`);

  const msg = [
    `<b>${getEventTitle(event)}</b>`,
    ``,
    `🕐 ${time}`,
    `<b>📄 الصفحة:</b> ${escapeHtml(page.name)}`,
    keyword ? `<b>🔎 الكلمة:</b> ${escapeHtml(keyword)}` : null,
    `<b>📍 الموقع:</b> ${escapeHtml(location)}`,
    `<b>📱 الجهاز:</b> ${detectDevice(ua)} • ${detectOS(ua)} • ${detectBrowser(ua)}`,
    `<b>🚦 المصدر:</b> ${label}`,
    `<b>⭐ الجودة:</b> ${score}/100 — ${getScoreLabel(score, event)}`,
    ``,
    ...(adLines.length ? [`<b>تفاصيل الإعلان:</b>`, ...adLines, ``] : []),
    `<b>🌐 IP:</b> <code>${escapeHtml(ip)}</code>`,
    `<b>🏢 الشبكة:</b> ${network}`,
  ].filter(line => line !== null && line !== undefined).join('\n');

  // Send notification
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
  const replyMarkup = ipv4
    ? { inline_keyboard: [[{ text: '🚫 حظر الـ IP', callback_data: `block:${ip}` }]] }
    : undefined;
  await sendTelegram(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID, msg, replyMarkup);

  // Enrich campaign name
  if (attribution.campaign_id) {
    try { await enrichAndNotify(attribution.campaign_id, attribution); } catch {}
  }

  return new Response(PIXEL_GIF, {
    status: 200,
    headers: { 'Content-Type': 'image/gif', 'Content-Length': '43', 'Cache-Control': 'no-cache, no-store', ...cors },
  });
}

// Vercel Function — Webhook زر «حظر IP» لإشعارات الأزهران
// يستقبل ضغطة زر التلغرام ويحظر الـ IP على حسابات Google Ads (3652624156 + 8366322499)
// يقرأ كل التوكنات من env تبع Vercel (موجودة عند العميل)

const TARGET_CIDS = ['3652624156', '8366322499'];
const MCC_ID = process.env.GOOGLE_ADS_MCC_ID || '5565578031';
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

// ─── Telegram helpers ────────────────────────────────

async function tgApi(token, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  return r.json().catch(() => ({}));
}

async function answerCallback(token, id, text) {
  await tgApi(token, 'answerCallbackQuery', { callback_query_id: id, text, show_alert: false });
}

async function editMessage(token, chatId, messageId, text) {
  await tgApi(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' });
}

// ─── Google Ads helpers ──────────────────────────────

async function getGadsToken() {
  const cid = process.env.GOOGLE_ADS_CLIENT_ID;
  const cs = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const rt = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!cid || !cs || !rt) return null;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${encodeURIComponent(cid)}&client_secret=${encodeURIComponent(cs)}&refresh_token=${encodeURIComponent(rt)}&grant_type=refresh_token`,
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.access_token || null;
  } catch { return null; }
}

async function gadsRaw(token, customerId, path, body) {
  const dt = process.env.GOOGLE_ADS_DEV_TOKEN;
  if (!dt) return { ok: false, detail: 'no dev token' };
  try {
    const r = await fetch(`https://googleads.googleapis.com/v24/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'developer-token': dt,
        'login-customer-id': MCC_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return { ok: false, status: r.status, detail: txt.slice(0, 300) };
    }
    return { ok: true, data: await r.json().catch(() => undefined) };
  } catch (e) {
    return { ok: false, detail: String(e).slice(0, 200) };
  }
}

async function getEnabledCampaigns(token, customerId) {
  const res = await gadsRaw(token, customerId, `customers/${customerId}/googleAds:searchStream`, {
    query: "SELECT campaign.id FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type != 'PERFORMANCE_MAX'",
  });
  if (!res.ok) return [];
  const batches = Array.isArray(res.data) ? res.data : [];
  const ids = [];
  for (const batch of batches) {
    for (const row of batch.results || []) {
      const rn = row.campaign?.resourceName;
      if (rn) ids.push(rn.split('/').pop());
    }
  }
  return ids;
}

async function blockIpOnCampaign(token, customerId, campaignId, ip) {
  const res = await gadsRaw(token, customerId, `customers/${customerId}/campaignCriteria:mutate`, {
    operations: [
      {
        create: {
          campaign: `customers/${customerId}/campaigns/${campaignId}`,
          negative: true,
          ipBlock: { ipAddress: `${ip}/32` },
        },
      },
    ],
  });
  return { ok: res.ok, detail: res.detail };
}

// ─── Handler ─────────────────────────────────────────

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const tokenT = process.env.TELEGRAM_BOT_TOKEN;
  const allowedChat = Number(process.env.TELEGRAM_CHAT_ID || '0');
  if (!tokenT) return new Response(JSON.stringify({ ok: false }), { status: 500, headers: cors });

  let update;
  try { update = await req.json(); } catch { return new Response(JSON.stringify({ ok: false }), { status: 400, headers: cors }); }

  const cq = update.callback_query;
  if (!cq) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });

  const fromId = cq.from?.id;
  if (fromId !== allowedChat) {
    await answerCallback(tokenT, cq.id, 'غير مصرح');
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
  }

  const data = cq.data || '';
  if (!data.startsWith('block:')) {
    await answerCallback(tokenT, cq.id, 'إجراء غير معروف');
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
  }

  const ip = data.slice(6).trim();
  if (!IPV4.test(ip)) {
    await answerCallback(tokenT, cq.id, 'IP غير صالح');
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
  }

  const msg = cq.message;
  const chatId = msg?.chat?.id;
  const messageId = msg?.message_id;

  await answerCallback(tokenT, cq.id, `⏳ جارٍ حظر ${ip}...`);

  const token = await getGadsToken();
  if (!token) {
    await editMessage(tokenT, chatId, messageId, `❌ فشل الحظر: تعذر الحصول على توكن Google Ads`);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
  }

  let okCount = 0;
  let failCount = 0;
  const details = [];

  for (const cid of TARGET_CIDS) {
    const campaigns = await getEnabledCampaigns(token, cid);
    if (campaigns.length === 0) {
      details.push(`<b>${cid}</b>: لا حملات نشطة`);
      continue;
    }
    for (const campaignId of campaigns) {
      const res = await blockIpOnCampaign(token, cid, campaignId, ip);
      if (res.ok) okCount++;
      else {
        failCount++;
        details.push(`<b>${cid}</b>/${campaignId}: ${(res.detail || 'error').slice(0, 80)}`);
      }
    }
  }

  const summary =
    `🚫 <b>تم حظر ${ip}</b>\n` +
    `✅ ${okCount} حملة تم الحظر فيها\n` +
    (failCount ? `❌ ${failCount} فشل\n${details.slice(0, 5).join('\n')}` : '');

  await editMessage(tokenT, chatId, messageId, summary);

  return new Response(JSON.stringify({ ok: true, blocked: ip, okCount, failCount, details }), { status: 200, headers: cors });
}

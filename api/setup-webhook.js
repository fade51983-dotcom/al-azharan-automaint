// Vercel Function — ضبط Webhook (مرة واحدة) لبوت الأزهران
// يقرأ TELEGRAM_BOT_TOKEN من env ويضبط webhook إلى /api/bot
// الحماية: key = GOOGLE_ADS_DEV_TOKEN (موجود في env العميل، سرّي، وما يقدر أحد من برا يستدعي بدون معرفته)

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const expected = process.env.WEBHOOK_SETUP_KEY || process.env.GOOGLE_ADS_DEV_TOKEN;
  if (!expected || key !== expected) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 403 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return new Response(JSON.stringify({ ok: false, error: 'no bot token' }), { status: 500 });

  const host = req.headers.get('host') || '';
  const webhookUrl = `https://${host}/api/bot`;

  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, drop_pending_updates: true }),
    signal: AbortSignal.timeout(8000),
  });
  const d = await r.json().catch(() => ({}));

  const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(8000) })
    .then((x) => x.json())
    .catch(() => ({}));

  return new Response(JSON.stringify({ ok: d.ok === true, set: d, info: info.result || info }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

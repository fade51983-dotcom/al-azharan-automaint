// Vercel Edge Function — Tracking Pixel لكراج الأزهران
// 1x1 transparent GIF + إرسال إشعار تيليجرام

const TRANSPARENT_GIF = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
  0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21,
  0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
  0x01, 0x00, 0x3b,
]);

export const config = { runtime: 'edge' };

export default async function handler(req, ctx) {
  const url = new URL(req.url);

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // الحصول على بيانات الزائر من الهيدرز
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          || req.headers.get('x-real-ip')
          || req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
          || 'غير معروف';

  const ua = req.headers.get('user-agent') || 'غير معروف';
  const referrer = req.headers.get('referer') || 'زيارة مباشرة';
  const country = req.headers.get('x-vercel-ip-country') || '';
  const city = req.headers.get('x-vercel-ip-city') || '';
  const region = req.headers.get('x-vercel-ip-country-region') || '';

  // تجاهل البوتات والفحوصات
  const isBot = /bot|crawl|spider|preview|health|ping|vercel/i.test(ua);
  if (isBot && !url.searchParams.has('force')) {
    return new Response(TRANSPARENT_GIF, {
      status: 200,
      headers: {
        'Content-Type': 'image/gif',
        'Content-Length': '43',
        'Cache-Control': 'public, max-age=86400',
        ...corsHeaders,
      },
    });
  }

  // وضع التصحيح — ?debug=1 يرجع JSON عشان نشوف التفاصيل
  if (url.searchParams.has('debug')) {
    const debugInfo = await debugTelegram({ ip, ua, referrer, country, city, region });
    return new Response(JSON.stringify(debugInfo, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // إرسال إشعار تيليجرام مباشر (متزامن)
  await sendTelegramNotification({ ip, ua, referrer, country, city, region });

  // إعادة الـ GIF الشفاف (بدون انتظار)
  return new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': '43',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      ...corsHeaders,
    },
  });
}

async function sendTelegramNotification(data) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) return;

  const { ip, ua, referrer, country, city, region } = data;

  const now = new Date();
  const visitTime = now.toISOString().replace('T', ' ').substring(0, 19) + ' +04';

  const loc = [country, city, region].filter(Boolean).join('، ');
  const page = referrer && referrer !== 'زيارة مباشرة'
    ? referrer.replace(/https?:\/\/[^\/]+/, '') || '/'
    : 'الصفحة الرئيسية';

  const text = [
    `👤 <b>زيارة جديدة</b>`,
    `🕐 ${visitTime}`,
    `🌐 <code>${ip}</code>`,
    loc && `📍 ${loc}`,
    `📄 ${page}`,
    `🔗 ${referrer && referrer !== 'زيارة مباشرة' ? referrer : '• مباشر'}`,
    `📱 <code>${(ua || '').substring(0, 120)}</code>`,
  ].filter(Boolean).join('\n');

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch (_) {
    // صامت — الفشل لا يمنع الـ GIF
  }
}

// دالة تصحيح — ترجع حالة الإعدادات بدون إرسال إشعار
async function debugTelegram(data) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  const info = {
    env: {
      hasToken: !!botToken,
      hasChatId: !!chatId,
      tokenPrefix: botToken ? botToken.substring(0, 18) + '...' : 'N/A',
      chatId: chatId || 'N/A',
    },
    request: {
      ip: data.ip,
      ua: data.ua.substring(0, 80),
      referrer: data.referrer,
      country: data.country,
      city: data.city,
    },
  };

  // اختبر اتصال التيليجرام
  if (botToken) {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, { method: 'GET' });
      const json = await resp.json();
      info.telegram_getme = { ok: json.ok, bot: json.ok ? json.result.username : null, error: json.ok ? null : json.description };
    } catch (e) {
      info.telegram_getme = { ok: false, error: e.message };
    }

    // اختبر إرسال رسالة
    try {
      const now = new Date().toISOString();
      const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId || '7304090625',
          text: `🧪 <b>اختبار التتبع</b>\n✅ النظام شغال — ${now}`,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      const json = await resp.json();
      info.telegram_send = { ok: json.ok, error: json.ok ? null : json.description, code: resp.status };
    } catch (e) {
      info.telegram_send = { ok: false, error: e.message };
    }
  }

  return info;
}

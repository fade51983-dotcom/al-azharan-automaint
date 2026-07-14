// Test endpoint — يختبر إعدادات تيليجرام
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return new Response(JSON.stringify({
      error: 'Missing env vars',
      hasToken: !!botToken,
      hasChatId: !!chatId,
      tokenPrefix: botToken ? botToken.substring(0, 15) + '...' : 'N/A',
    }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  // Test sending a message
  try {
    const tgUrl = `https://api.telegram.org/bot${botToken}/getMe`;
    const resp = await fetch(tgUrl);
    const data = await resp.json();
    
    return new Response(JSON.stringify({
      success: data.ok,
      botName: data.ok ? data.result.first_name : null,
      botUsername: data.ok ? data.result.username : null,
      error: data.ok ? null : data.description,
      envTokenPrefix: botToken.substring(0, 15) + '...',
      envChatId: chatId,
    }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return new Response(JSON.stringify({
      success: false,
      error: e.message,
      envTokenPrefix: botToken ? botToken.substring(0, 15) + '...' : 'N/A',
      envChatId: chatId,
    }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Telegram webhook proxy is running', { status: 200 });
    }

    if (!env.APPS_SCRIPT_URL) {
      return new Response('APPS_SCRIPT_URL is not configured', { status: 500 });
    }

    const body = await request.text();

    ctx.waitUntil(
      fetch(env.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        redirect: 'follow',
      }).catch((error) => {
        console.error('Apps Script forward failed:', error);
      })
    );

    return new Response('ok', { status: 200 });
  },
};

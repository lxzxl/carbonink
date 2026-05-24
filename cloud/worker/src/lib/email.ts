type Lang = 'zh-CN' | 'en';

async function sendViaResend(
  apiKey: string,
  payload: { from: string; to: string; subject: string; html: string },
): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable>');
    console.error('resend:send-failed', { status: res.status, body });
  }
}

export function sendActivationEmail(opts: {
  apiKey: string;
  to: string;
  licenseKey: string;
  lang: Lang;
}): Promise<void> {
  const { lang, licenseKey } = opts;
  const subject = lang === 'zh-CN' ? 'carbonink 激活密钥' : 'Your carbonink activation key';
  const body =
    lang === 'zh-CN'
      ? `<p>你好！</p><p>你的 carbonink 激活密钥：</p>
       <p style="font-family:monospace;font-size:18px"><b>${licenseKey}</b></p>
       <p>打开桌面应用，进入「设置 → 激活」，粘贴此密钥。</p>`
      : `<p>Hi —</p><p>Your carbonink activation key:</p>
       <p style="font-family:monospace;font-size:18px"><b>${licenseKey}</b></p>
       <p>Open the desktop app, go to Settings → Activate, and paste the key.</p>`;
  return sendViaResend(opts.apiKey, {
    from: 'carbonink <noreply@carbonink.xyz>',
    to: opts.to,
    subject,
    html: body,
  });
}

export function sendMagicLinkEmail(opts: {
  apiKey: string;
  to: string;
  url: string;
  lang: Lang;
}): Promise<void> {
  const subject = opts.lang === 'zh-CN' ? 'carbonink 登录链接' : 'carbonink login link';
  const body =
    opts.lang === 'zh-CN'
      ? `<p>点击链接登录 carbonink 账户：</p><p><a href="${opts.url}">${opts.url}</a></p><p>链接 15 分钟内有效。</p>`
      : `<p>Click the link to sign in to your carbonink account:</p><p><a href="${opts.url}">${opts.url}</a></p><p>This link expires in 15 minutes.</p>`;
  return sendViaResend(opts.apiKey, {
    from: 'carbonink <noreply@carbonink.xyz>',
    to: opts.to,
    subject,
    html: body,
  });
}

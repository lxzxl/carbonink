/**
 * Outbound transactional email via Cloudflare Email Sending.
 *
 * Uses the `send_email` Workers binding (no API key). The domain
 * `carbonink.xyz` must be onboarded via
 *   pnpm exec wrangler email sending enable carbonink.xyz
 * before the binding will deliver. Locally, vitest-pool-workers stubs
 * the binding so tests don't hit the network.
 *
 * If `send()` rejects we log and swallow — sending an activation email
 * shouldn't take down a checkout webhook. The trade-off: the customer
 * has to retry the trial-signup or contact support if delivery silently
 * fails. We can promote logging to alerting once Sentry is wired in.
 */

type Lang = 'zh-CN' | 'en';

async function safeSend(email: SendEmail, msg: EmailMessage): Promise<void> {
  try {
    await email.send(msg);
  } catch (err) {
    console.error('email:send-failed', {
      subject: msg.subject,
      to: msg.to,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// Shape of the binding's send() argument — kept narrow to what we
// actually use, so future SendEmail spec additions don't break us.
interface EmailMessage {
  to: string;
  from: { email: string; name?: string };
  subject: string;
  html: string;
  text: string;
}

// SendEmail comes from @cloudflare/workers-types via tsconfig `types`.
// Narrowed here to just the method we call.
interface SendEmail {
  send(msg: EmailMessage): Promise<unknown>;
}

const FROM = { email: 'noreply@carbonink.xyz', name: 'CarbonInk' };

export function sendActivationEmail(opts: {
  email: SendEmail;
  to: string;
  licenseKey: string;
  lang: Lang;
}): Promise<void> {
  const { lang, licenseKey } = opts;
  const subject = lang === 'zh-CN' ? '碳墨 激活密钥' : 'Your CarbonInk activation key';
  const html =
    lang === 'zh-CN'
      ? `<p>你好！</p><p>你的 碳墨 激活密钥：</p>
       <p style="font-family:monospace;font-size:18px"><b>${licenseKey}</b></p>
       <p>打开桌面应用，进入「设置 → 激活」，粘贴此密钥。</p>`
      : `<p>Hi —</p><p>Your CarbonInk activation key:</p>
       <p style="font-family:monospace;font-size:18px"><b>${licenseKey}</b></p>
       <p>Open the desktop app, go to Settings → Activate, and paste the key.</p>`;
  const text =
    lang === 'zh-CN'
      ? `你的 碳墨 激活密钥：${licenseKey}\n\n打开桌面应用 → 设置 → 激活 → 粘贴此密钥。`
      : `Your CarbonInk activation key: ${licenseKey}\n\nOpen the desktop app → Settings → Activate → Paste the key.`;
  return safeSend(opts.email, { to: opts.to, from: FROM, subject, html, text });
}

export function sendMagicLinkEmail(opts: {
  email: SendEmail;
  to: string;
  url: string;
  lang: Lang;
}): Promise<void> {
  const subject = opts.lang === 'zh-CN' ? '碳墨 登录链接' : 'CarbonInk login link';
  const html =
    opts.lang === 'zh-CN'
      ? `<p>点击链接登录 碳墨 账户：</p><p><a href="${opts.url}">${opts.url}</a></p><p>链接 15 分钟内有效。</p>`
      : `<p>Click the link to sign in to your CarbonInk account:</p><p><a href="${opts.url}">${opts.url}</a></p><p>This link expires in 15 minutes.</p>`;
  const text =
    opts.lang === 'zh-CN'
      ? `点击链接登录 碳墨 账户：${opts.url}\n\n链接 15 分钟内有效。`
      : `Click the link to sign in to your CarbonInk account: ${opts.url}\n\nThis link expires in 15 minutes.`;
  return safeSend(opts.email, { to: opts.to, from: FROM, subject, html, text });
}

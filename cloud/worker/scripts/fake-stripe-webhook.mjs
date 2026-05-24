#!/usr/bin/env node
/**
 * Local-dev helper — forges a Stripe `checkout.session.completed` event,
 * signs it with the SAME secret the running `wrangler dev` worker uses
 * (read from cloud/worker/.dev.vars), and POSTs it to
 * `http://localhost:8787/v1/stripe-webhook`.
 *
 * Result: the worker treats it as a real Stripe webhook, creates a
 * customer + license row in local D1, writes the active record into
 * KV, and (would) send an activation email — except the dummy
 * RESEND_API_KEY makes that a no-op (the worker logs it instead).
 *
 * Usage:
 *   node scripts/fake-stripe-webhook.mjs you@example.com
 *
 * Then open:
 *   http://localhost:4321/activate?key=<the humanized key from the
 *   email-log line in wrangler dev output>
 *
 * Or curl D1 directly:
 *   wrangler d1 execute DB --local --command \
 *     "SELECT humanized_key FROM license ORDER BY rowid DESC LIMIT 1"
 */
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readDevVars() {
  const path = resolve(__dirname, '..', '.dev.vars');
  const text = readFileSync(path, 'utf8');
  const out = Object.create(null);
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx < 0) continue;
    out[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  }
  return out;
}

const email = process.argv[2];
if (!email || !email.includes('@')) {
  console.error('usage: node scripts/fake-stripe-webhook.mjs <email>');
  process.exit(1);
}

const vars = readDevVars();
const secret = vars.STRIPE_WEBHOOK_SECRET;
if (!secret) {
  console.error('STRIPE_WEBHOOK_SECRET missing in cloud/worker/.dev.vars');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const event = {
  id: `evt_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
  type: 'checkout.session.completed',
  created: now,
  data: {
    object: {
      customer: `cus_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      customer_details: { email },
      subscription: `sub_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      metadata: { plan: 'base@2026-q2', tier: 'base' },
    },
  },
};
const payload = JSON.stringify(event);

// Stripe signature scheme: signed_payload = `${t}.${payload}`, HMAC-SHA256.
const t = String(now);
const sig = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
const sigHeader = `t=${t},v1=${sig}`;

const res = await fetch('http://localhost:8787/v1/stripe-webhook', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'stripe-signature': sigHeader,
  },
  body: payload,
});

const body = await res.text();
console.log(`POST /v1/stripe-webhook → ${res.status}`);
console.log(body);

if (res.ok) {
  console.log('');
  console.log('Look in the `wrangler dev` terminal for the activation email');
  console.log('log line — it carries the humanized key. Or query D1:');
  console.log('  cd cloud/worker');
  console.log(
    `  pnpm exec wrangler d1 execute DB --local --command \\\n    "SELECT humanized_key FROM license WHERE user_id=(SELECT user_id FROM customer WHERE email='${email}')"`,
  );
}

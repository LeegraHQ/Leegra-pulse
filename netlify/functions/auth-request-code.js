// POST /api/auth-request-code  { email }
// Generates a fresh 6-digit login code, valid for 10 minutes, and emails it
// via Resend. Always responds the same way whether or not the email
// actually matches an account — never reveal which emails have access.

const crypto = require('crypto');
const { resolveIdentityByEmail } = require('./_lib/identity');
const { saveOtp } = require('./_lib/records');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.OTP_FROM_EMAIL || 'Leegra Pulse <onboarding@resend.dev>';
const CODE_TTL_MS = 10 * 60 * 1000;

async function sendEmail(to, code) {
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set — cannot send OTP email to', to);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject: 'Your Leegra Pulse login code',
      html: `<p>Your Leegra Pulse login code is:</p><h2 style="letter-spacing:4px">${code}</h2><p>This code expires in 10 minutes. If you didn't request this, you can ignore it.</p>`,
    }),
  });
  if (!res.ok) {
    console.error('Resend send failed', res.status, await res.text());
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const email = (body.email || '').trim().toLowerCase();
  if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'email required' }) };

  const identity = await resolveIdentityByEmail(email);
  if (identity) {
    const code = String(crypto.randomInt(100000, 1000000));
    await saveOtp(email, code, Date.now() + CODE_TTL_MS);
    await sendEmail(email, code).catch(err => console.error('OTP email send threw', err));
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};

// Scheduled function — runs 06:00 UTC on the 1st of every month (see netlify.toml).
// Emails each code holder the new month's access code. The code isn't stored
// anywhere: it's re-derived here exactly as auth-login derives it.
//
// Email goes out via Resend (https://resend.com — free tier covers this).
// Env vars: RESEND_API_KEY, MAIL_FROM (e.g. "Leegra Pulse <pulse@leegra.co.za>"),
//           SITE_URL (e.g. https://leegra-pulse.netlify.app)
// Hitting this URL manually also works — handy for testing, and for resending
// if someone loses the code mid-month.
const { CODE_HOLDERS, findTenantByCode } = require('./_data');
const accessCode = require('./_lib/accesscode');

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

async function sendMail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { skipped: 'RESEND_API_KEY not set' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || 'Leegra Pulse <onboarding@resend.dev>', to: [to], subject, html }),
  });
  return res.ok ? { sent: true } : { error: await res.text() };
}

exports.handler = async () => {
  const now = new Date();
  const label = MONTHS[now.getUTCMonth()] + ' ' + now.getUTCFullYear();
  const siteUrl = process.env.SITE_URL || '';
  const results = [];

  for (const holder of CODE_HOLDERS) {
    const tenant = findTenantByCode(holder.tenantCode);
    const code = accessCode.codeFor(holder.tenantCode);
    const html = [
      '<div style="font-family:Inter,Helvetica,Arial,sans-serif;background:#161826;color:#e9e9ed;padding:32px;">',
      '<p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#9184d9;">Leegra Pulse</p>',
      '<h1 style="margin:0 0 16px;font-size:22px;font-weight:500;">Your ' + label + ' access code</h1>',
      '<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#b7b7c2;">Hi ' + holder.name + ', here is your code for the ' + tenant.name + ' dashboard. It works until the end of ' + MONTHS[now.getUTCMonth()] + ', then a new one arrives.</p>',
      '<p style="margin:0 0 20px;font-family:monospace;font-size:30px;letter-spacing:.12em;color:#e9e9ed;">' + code + '</p>',
      siteUrl ? '<p style="margin:0 0 20px;"><a href="' + siteUrl + '" style="color:#9184d9;font-size:14px;">Open the dashboard</a></p>' : '',
      '<p style="margin:0;font-size:12px;color:#7c7c8a;">No password needed — enter the code on the sign-in screen. Please do not forward it.</p>',
      '</div>',
    ].join('');
    const out = await sendMail(holder.email, 'Your ' + label + ' Leegra Pulse code', html);
    results.push(Object.assign({ to: holder.email, tenant: holder.tenantCode }, out));
  }

  return { statusCode: 200, body: JSON.stringify({ month: label, results }) };
};

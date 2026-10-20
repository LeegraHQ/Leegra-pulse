// Minimal Supabase REST + Storage client over fetch — no npm dependency.
// Env vars (set in Netlify → Site settings → Environment variables):
//   SUPABASE_URL                https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   service_role key (server-side only, never ship to the browser)
//   SUPABASE_PHOTO_BUCKET       storage bucket name (default 'visit-photos')
const URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function configured() { return !!(URL && KEY); }

function headers(extra) {
  return Object.assign({ apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, extra || {});
}

async function select(table, query) {
  const res = await fetch(URL + '/rest/v1/' + table + (query || ''), { headers: headers() });
  if (!res.ok) throw new Error('supabase select ' + table + ': ' + await res.text());
  return res.json();
}

async function insert(table, row) {
  const res = await fetch(URL + '/rest/v1/' + table, {
    method: 'POST', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error('supabase insert ' + table + ': ' + await res.text());
  return (await res.json())[0];
}

async function upsert(table, row, onConflict) {
  const res = await fetch(URL + '/rest/v1/' + table + '?on_conflict=' + onConflict, {
    method: 'POST',
    headers: headers({ Prefer: 'return=representation,resolution=merge-duplicates' }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error('supabase upsert ' + table + ': ' + await res.text());
  return (await res.json())[0];
}

async function patch(table, query, row) {
  const res = await fetch(URL + '/rest/v1/' + table + query, {
    method: 'PATCH', headers: headers({ Prefer: 'return=minimal' }), body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error('supabase patch ' + table + ': ' + await res.text());
  return true;
}

async function remove(table, query) {
  const res = await fetch(URL + '/rest/v1/' + table + query, { method: 'DELETE', headers: headers() });
  if (!res.ok) throw new Error('supabase delete ' + table + ': ' + await res.text());
  return true;
}

// Uploads raw bytes to a Storage bucket and returns the public URL
// (only reachable if the bucket is public; reads below work either way).
async function uploadToBucket(bucket, path, buffer, contentType) {
  const res = await fetch(URL + '/storage/v1/object/' + bucket + '/' + path, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'true' },
    body: buffer,
  });
  if (!res.ok) throw new Error('supabase storage upload: ' + await res.text());
  return URL + '/storage/v1/object/public/' + bucket + '/' + path;
}

// Authenticated read — works for private buckets. Returns null when missing.
async function downloadFromBucket(bucket, path) {
  const res = await fetch(URL + '/storage/v1/object/authenticated/' + bucket + '/' + path, {
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY },
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error('supabase storage download: ' + await res.text());
  return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/jpeg' };
}

async function removeFromBucket(bucket, path) {
  const res = await fetch(URL + '/storage/v1/object/' + bucket + '/' + path, {
    method: 'DELETE', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY },
  });
  if (!res.ok && res.status !== 404) throw new Error('supabase storage delete: ' + await res.text());
  return true;
}

module.exports = { configured, select, insert, upsert, patch, remove, uploadToBucket, downloadFromBucket, removeFromBucket };

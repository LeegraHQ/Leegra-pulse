// GET /api/admin-visit-log[?format=json|xlsx|pdf][&tenant_code=PH-201]
// Consolidated check-in/check-out log across every tenant (or one, with
// ?tenant_code=). Auth: Leegra staff only (any tier — report_export_only
// can read this same as everyone else, since exporting reports is exactly
// what that tier is for).

const XLSX = require('xlsx');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const jwt = require('./_lib/jwt');
const { TENANTS, LEEGRA_ROLES, findTenantByCode } = require('./_data');
const { tenantScopeOk } = require('./_lib/scope');
const { getStores, getImportedVisits, getLiveVisits, getPhoto } = require('./_lib/records');

// Historical CSV imports don't have structured per-question answers, just
// flat *_done booleans — surface whichever of those happen to be present
// instead of a full questionnaire snapshot.
const IMPORTED_FLAG_FIELDS = ['photo_done', 'stock_done', 'checklist_done', 'survey_done'];

async function tenantVisitRows(tenant) {
  const [stores, imported, live] = await Promise.all([
    getStores(tenant.code),
    getImportedVisits(tenant.code),
    getLiveVisits(tenant.code),
  ]);
  const storeName = Object.fromEntries(stores.map(s => [s.code, s.name]));

  const importedRows = imported.map(v => ({
    tenantCode: tenant.code,
    tenantName: tenant.name,
    storeCode: v.store_code || null,
    storeName: storeName[v.store_code] || v.store_code || 'Unknown store',
    repEmail: v.rep_email || null,
    checkinAt: v.checkin_at || null,
    checkoutAt: v.checkout_at || null,
    source: 'imported',
    answers: IMPORTED_FLAG_FIELDS.filter(f => f in v).map(f => ({ label: f, value: v[f], type: 'boolean' })),
  }));

  const liveRows = live.map(v => ({
    tenantCode: tenant.code,
    tenantName: tenant.name,
    storeCode: v.storeCode || null,
    storeName: storeName[v.storeCode] || v.storeCode || 'Unknown store',
    repEmail: v.repEmail || null,
    checkinAt: v.checkin_at || null,
    checkoutAt: v.checkout_at || null,
    source: 'live',
    answers: (v.questions || []).map(q => {
      const raw = v.answers?.[q.id];
      const isPhoto = q.type === 'photo' && raw && typeof raw === 'object';
      return {
        label: q.label,
        type: q.type,
        value: isPhoto ? null : (raw ?? null),
        photoId: isPhoto ? raw.photoId : null,
      };
    }),
  }));

  return [...importedRows, ...liveRows];
}

function withDuration(row) {
  let durationMinutes = null;
  if (row.checkinAt && row.checkoutAt) {
    durationMinutes = Math.max(0, Math.round((new Date(row.checkoutAt) - new Date(row.checkinAt)) / 60000));
  }
  return { ...row, durationMinutes };
}

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (!LEEGRA_ROLES.includes(claims.role)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted' }) };
  }

  const tenantCodeParam = event.queryStringParameters?.tenant_code || claims.scopedTenantCode;
  const format = event.queryStringParameters?.format || 'json';

  let tenants = TENANTS;
  if (tenantCodeParam) {
    if (!tenantScopeOk(claims, tenantCodeParam)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted for that tenant' }) };
    }
    const tenant = findTenantByCode(tenantCodeParam);
    if (!tenant) return { statusCode: 404, body: JSON.stringify({ error: 'Unknown tenant' }) };
    tenants = [tenant];
  } else if (claims.scopedTenantCode) {
    // Unreachable in practice (tenantCodeParam already falls back to
    // scopedTenantCode above), kept as a defensive second gate so a scoped
    // staff member can never see every tenant's log even if that fallback
    // is ever removed.
    tenants = TENANTS.filter(t => t.code === claims.scopedTenantCode);
  }

  const perTenant = await Promise.all(tenants.map(tenantVisitRows));
  const rows = perTenant.flat().map(withDuration)
    .sort((a, b) => new Date(b.checkinAt || 0) - new Date(a.checkinAt || 0));

  if (format === 'json') {
    return { statusCode: 200, body: JSON.stringify({ count: rows.length, visits: rows }) };
  }

  if (format === 'xlsx') {
    const flatRows = rows.map(r => ({
      Tenant: r.tenantName,
      'Tenant Code': r.tenantCode,
      Store: r.storeName,
      'Store Code': r.storeCode,
      Rep: r.repEmail,
      'Checked in': r.checkinAt,
      'Checked out': r.checkoutAt,
      'Duration (min)': r.durationMinutes,
      Answers: r.answers.map(a => `${a.label}: ${a.photoId ? '[photo]' : a.value}`).join(' | '),
    }));
    const ws = XLSX.utils.json_to_sheet(flatRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Visit Log');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="visit-log.xlsx"',
      },
      isBase64Encoded: true,
      body: buf.toString('base64'),
    };
  }

  if (format === 'pdf') {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const marginX = 40;
    const lineHeight = 14;
    let page = pdfDoc.addPage([595, 842]);
    let y = 800;

    function ensureSpace(needed) {
      if (y - needed < 40) {
        page = pdfDoc.addPage([595, 842]);
        y = 800;
      }
    }

    page.drawText('Leegra Pulse — Consolidated Visit Log', { x: marginX, y, size: 16, font: boldFont });
    y -= 24;
    page.drawText(`Generated ${new Date().toISOString()} · ${rows.length} visits`, { x: marginX, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 20;

    for (const r of rows) {
      ensureSpace(50);
      page.drawText(`${r.tenantName} (${r.tenantCode}) — ${r.storeName}`, { x: marginX, y, size: 11, font: boldFont });
      y -= lineHeight;
      page.drawText(
        `Rep: ${r.repEmail || '—'}  ·  In: ${r.checkinAt || '—'}  ·  Out: ${r.checkoutAt || '—'}  ·  Duration: ${r.durationMinutes ?? '—'} min`,
        { x: marginX, y, size: 9, font, color: rgb(0.3, 0.3, 0.3) }
      );
      y -= lineHeight;

      for (const a of r.answers) {
        if (a.photoId) {
          const photo = await getPhoto(r.tenantCode, a.photoId);
          if (photo) {
            try {
              const img = photo.mime.includes('png') ? await pdfDoc.embedPng(photo.bytes) : await pdfDoc.embedJpg(photo.bytes);
              const maxW = 150, maxH = 110;
              const scale = Math.min(maxW / img.width, maxH / img.height, 1);
              const w = img.width * scale, h = img.height * scale;
              ensureSpace(h + lineHeight + 4);
              page.drawText(`${a.label}:`, { x: marginX + 10, y, size: 9, font });
              y -= lineHeight;
              page.drawImage(img, { x: marginX + 10, y: y - h, width: w, height: h });
              y -= (h + 6);
            } catch {
              ensureSpace(lineHeight);
              page.drawText(`${a.label}: [photo could not be embedded]`, { x: marginX + 10, y, size: 9, font });
              y -= lineHeight;
            }
          } else {
            ensureSpace(lineHeight);
            page.drawText(`${a.label}: [photo not found]`, { x: marginX + 10, y, size: 9, font });
            y -= lineHeight;
          }
        } else {
          ensureSpace(lineHeight);
          page.drawText(`${a.label}: ${a.value === null ? '—' : String(a.value)}`, { x: marginX + 10, y, size: 9, font });
          y -= lineHeight;
        }
      }
      y -= 8;
    }

    const pdfBytes = await pdfDoc.save();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="visit-log.pdf"',
      },
      isBase64Encoded: true,
      body: Buffer.from(pdfBytes).toString('base64'),
    };
  }

  return { statusCode: 400, body: JSON.stringify({ error: `Unsupported format: ${format}` }) };
};

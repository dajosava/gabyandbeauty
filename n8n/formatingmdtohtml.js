// ============================================================
// N8N CODE NODE v4 — Email-Optimized HTML Report
// INPUT: Aggregate { output: [ {output: "markdown..."}, ... ] }
// OUTPUT: { html } — compatible con Gmail, Outlook, Apple Mail
// ============================================================

// ── 1. EXTRAER MARKDOWNS ──────────────────────────────────
const aggregateData = $input.first().json;
const markdownArray = (aggregateData.output || aggregateData.data || [])
  .map(item => item.output || item.text || '')
  .filter(Boolean);

// ── 2. HELPERS ────────────────────────────────────────────

function getSection(md, ...keywords) {
  const pattern = keywords.join('|');
  const regex = new RegExp(`#{1,4}[^\\n]*(?:${pattern})[^\\n]*\\n([\\s\\S]*?)(?=\\n#{1,4}\\s|$)`, 'i');
  const match = md.match(regex);
  return match ? match[1] : '';
}

function extractBullets(text) {
  return (text.match(/[-*•]\s+(.+)/g) || [])
    .map(b => b.replace(/^[-*•]\s+/, '').trim()).filter(Boolean);
}

function parseAllTables(md) {
  const lines = md.split('\n');
  let headerLine = null;
  const dataLines = [];
  const results = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('|')) {
      if (headerLine && dataLines.length) {
        const headers = headerLine.split('|').map(h => h.trim()).filter(Boolean);
        for (const row of dataLines) {
          const cells = row.split('|').map(c => c.trim()).filter(Boolean);
          if (!cells.length) continue;
          const obj = {};
          headers.forEach((h, i) => { obj[h] = cells[i] || ''; });
          if (Object.values(obj).some(v => v.length > 0)) results.push(obj);
        }
        headerLine = null; dataLines.length = 0;
      }
      continue;
    }
    if (t.includes('---')) continue;
    if (!headerLine) { headerLine = t; } else { dataLines.push(t); }
  }
  if (headerLine && dataLines.length) {
    const headers = headerLine.split('|').map(h => h.trim()).filter(Boolean);
    for (const row of dataLines) {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      if (!cells.length) continue;
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cells[i] || ''; });
      if (Object.values(obj).some(v => v.length > 0)) results.push(obj);
    }
  }
  return results;
}

function getField(obj, ...candidates) {
  const normalize = s => s.toLowerCase().replace(/[áéíóú]/g, c => ({á:'a',é:'e',í:'i',ó:'o',ú:'u'}[c]||c));
  for (const candidate of candidates) {
    const found = Object.keys(obj).find(k => normalize(k).includes(normalize(candidate)));
    if (found) return obj[found] || '';
  }
  return '';
}

function esc(str = '') {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function stateColor(estado = '') {
  const e = estado.toLowerCase();
  if (e.includes('hot'))  return '#E05A5A';
  if (e.includes('warm')) return '#E0964A';
  return '#5A8AE0';
}

function scoreColor(score) {
  const n = parseInt(score) || 0;
  if (n >= 75) return '#E05A5A';
  if (n >= 50) return '#E0964A';
  return '#5A8AE0';
}

function priorityColor(p = '') {
  const u = p.toUpperCase();
  if (u.includes('P1')) return '#C9A84C';
  if (u.includes('P2')) return '#8A7A5A';
  return '#5A5A5A';
}

function extractGuion(md, tipo) {
  if (!md || typeof md !== 'string') return '';
  try {
    const r1 = new RegExp('\\*\\*' + tipo + '[^\\n]*:[^\\n]*\\n\\s*>"?([^"\\n]{20,})"?', 'i');
    const m1 = md.match(r1);
    if (m1 && m1[1]) return m1[1].trim();
    const r2 = new RegExp('\\*\\*' + tipo + '[^*]*\\*\\*[^"]*"([^"]{20,})"', 'i');
    const m2 = md.match(r2);
    if (m2 && m2[1]) return m2[1].trim();
  } catch(e) { return ''; }
  return '';
}

// ── 3. PARSEAR DATOS ──────────────────────────────────────
const allLeads = markdownArray.flatMap(md => parseAllTables(md));
const fullMd   = markdownArray.join('\n\n');

const totalLeads = allLeads.length;
const hotLeads   = allLeads.filter(l => getField(l,'Estado','Status','State').toLowerCase().includes('hot')).length;
const warmLeads  = allLeads.filter(l => getField(l,'Estado','Status','State').toLowerCase().includes('warm')).length;
const scores     = allLeads.map(l => parseInt(getField(l,'Intent Score','Score','Puntaje')||0)).filter(n=>n>0);
const avgScore   = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0;

const now     = new Date();
const weekAgo = new Date(now - 7*24*60*60*1000);
const fmt     = d => d.toLocaleDateString('es-PA', {day:'2-digit', month:'short', year:'numeric'});
const semana  = `${fmt(weekAgo)} - ${fmt(now)}`;

const objeciones    = extractBullets(getSection(fullMd,'Objeciones'));
const cursosMas     = extractBullets(getSection(fullMd,'Cursos'));
const puntosCaida   = extractBullets(getSection(fullMd,'Puntos','caen','caida'));
const recomendac    = extractBullets(getSection(fullMd,'Recomendaci'));
const preguntasList = extractBullets(getSection(fullMd,'Preguntas'));
const guionHot  = extractGuion(fullMd,'Hot');
const guionWarm = extractGuion(fullMd,'Warm');
const guionCold = extractGuion(fullMd,'Cold|Frio|Frío');

// ── 4. RENDER EMAIL HTML ──────────────────────────────────

// Render filas de leads
function renderLeadRows(leads) {
  if (!leads.length) return `
    <tr><td style="padding:20px;color:#888;font-size:14px;text-align:center;">
      No se encontraron leads para esta semana.
    </td></tr>`;

  return leads.map(lead => {
    const sessionId = getField(lead,'Session ID','session_id','session','telefono','phone','Contacto','Contact');
    const nombre    = getField(lead,'Lead ID','Nombre','ID','conversation') || sessionId || 'Sin ID';
    const curso     = getField(lead,'Curso');
    const estado    = getField(lead,'Estado','Status','State');
    const score     = getField(lead,'Intent Score','Score','Puntaje');
    const urgencia  = getField(lead,'Urgencia');
    const objecion  = getField(lead,'Objecion','Objeciones');
    const siguiente = getField(lead,'Proxima','Siguiente','Accion');
    const mensaje   = getField(lead,'Mensaje');
    const prioridad = getField(lead,'Prioridad');
    const cierre    = getField(lead,'Cierre');

    const sc   = stateColor(estado);
    const skr  = scoreColor(score);
    const pc   = priorityColor(prioridad);
    const waLink = sessionId ? `https://wa.me/${sessionId.replace(/[^0-9]/g,'')}` : '#';

    const tags = objecion.split(',').map(t => t.trim()).filter(Boolean)
      .map(t => `<span style="display:inline-block;background:#2E2E2E;color:#B8B0A4;font-size:10px;
        padding:2px 7px;margin:2px 3px 2px 0;letter-spacing:0.08em;text-transform:uppercase;">${esc(t)}</span>`)
      .join('');

    return `
<!-- LEAD CARD -->
<tr>
  <td style="padding:4px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background:#1A1A1A;border-left:4px solid ${sc};">
      <tr>
        <!-- LEFT: datos -->
        <td style="padding:18px 20px;vertical-align:top;">

          <!-- header row -->
          <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;">
            <tr>
              <td style="font-family:Georgia,serif;font-size:15px;font-weight:700;
                color:#F5F0EA;padding-right:10px;">${esc(sessionId || nombre)}</td>
              <td style="padding-right:6px;">
                <span style="background:${sc};color:#fff;font-size:9px;font-weight:700;
                  letter-spacing:0.15em;text-transform:uppercase;padding:3px 8px;">${esc(estado)}</span>
              </td>
              <td style="padding-right:6px;">
                <span style="background:${pc};color:${prioridad.toUpperCase().includes('P1')?'#0F0F0F':'#fff'};
                  font-size:9px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;
                  padding:3px 8px;">${esc(prioridad)}</span>
              </td>
              ${urgencia ? `<td style="padding-right:6px;">
                <span style="background:#2E2E2E;color:#B8B0A4;font-size:9px;letter-spacing:0.1em;
                  text-transform:uppercase;padding:3px 8px;">URGENCIA: ${esc(urgencia)}</span>
              </td>` : ''}
              ${cierre ? `<td>
                <span style="background:#2E2E2E;color:#B8B0A4;font-size:9px;letter-spacing:0.1em;
                  text-transform:uppercase;padding:3px 8px;">CIERRE: ${esc(cierre)}</span>
              </td>` : ''}
            </tr>
          </table>

          <!-- whatsapp link -->
          ${sessionId ? `
          <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">
            <tr>
              <td style="background:#252525;border-left:2px solid #C9A84C;padding:5px 10px;">
                <a href="${waLink}" style="color:#E8C96A;font-size:13px;font-weight:600;
                  text-decoration:none;font-family:Arial,sans-serif;letter-spacing:0.05em;">
                  📞 ${esc(sessionId)}
                </a>
              </td>
            </tr>
          </table>` : ''}

          <!-- curso -->
          ${curso ? `<p style="font-size:12px;color:#B8B0A4;font-style:italic;
            margin:0 0 8px 0;font-family:Arial,sans-serif;">${esc(curso)}</p>` : ''}

          <!-- tags objeciones -->
          ${tags ? `<div style="margin-bottom:10px;">${tags}</div>` : ''}

          <!-- próxima acción -->
          ${siguiente ? `
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:8px;">
            <tr>
              <td style="background:#252525;border:1px solid #2E2E2E;padding:8px 12px;
                font-family:Arial,sans-serif;font-size:12px;color:#E8C96A;">
                <strong style="color:#C9A84C;">Proxima accion:</strong> ${esc(siguiente)}
              </td>
            </tr>
          </table>` : ''}

          <!-- mensaje recomendado -->
          ${mensaje ? `
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="background:#252525;border-left:2px solid #C9A84C;padding:10px 14px;">
                <p style="font-size:10px;color:#C9A84C;font-weight:700;letter-spacing:0.15em;
                  text-transform:uppercase;margin:0 0 5px 0;font-family:Arial,sans-serif;">
                  Mensaje recomendado</p>
                <p style="font-size:12px;color:#B8B0A4;font-style:italic;margin:0;
                  font-family:Arial,sans-serif;line-height:1.5;">"${esc(mensaje)}"</p>
              </td>
            </tr>
          </table>` : ''}

        </td>

        <!-- RIGHT: score -->
        <td style="padding:18px 20px;vertical-align:middle;text-align:center;width:80px;">
          <div style="width:56px;height:56px;border-radius:50%;border:2px solid ${skr};
            display:inline-block;line-height:56px;text-align:center;">
            <span style="font-family:Georgia,serif;font-size:18px;font-weight:700;
              color:${skr};">${esc(score)}</span>
          </div>
          <p style="font-size:9px;color:#B8B0A4;letter-spacing:0.1em;text-transform:uppercase;
            margin:4px 0 0 0;font-family:Arial,sans-serif;">SCORE</p>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
  }).join('\n');
}

// Render lista de bullets para insights
function renderInsightList(items, fallback = 'Sin datos') {
  if (!items.length) return `<tr><td style="padding:4px 0 4px 12px;font-size:12px;color:#B8B0A4;
    font-family:Arial,sans-serif;">- ${fallback}</td></tr>`;
  return items.map(i => `
    <tr>
      <td style="padding:4px 0 4px 0;font-size:12px;color:#B8B0A4;font-family:Arial,sans-serif;
        border-bottom:1px solid #2E2E2E;line-height:1.5;">
        <span style="color:#C9A84C;padding-right:8px;">—</span>${esc(i)}
      </td>
    </tr>`).join('');
}

// Render guion
function renderGuion(tipo, color, texto) {
  if (!texto) return '';
  return `
  <tr>
    <td style="padding:0 0 4px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#1A1A1A;">
        <tr>
          <td style="padding:16px 20px;">
            <p style="font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;
              color:${color};margin:0 0 8px 0;font-family:Arial,sans-serif;">${tipo}</p>
            <p style="font-size:12px;color:#F5F0EA;font-style:italic;border-left:2px solid #2E2E2E;
              padding-left:12px;margin:0;font-family:Arial,sans-serif;line-height:1.6;">"${esc(texto)}"</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

// ── 5. ENSAMBLAR HTML EMAIL ───────────────────────────────
const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"
  "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reporte Semanal de Leads</title>
</head>
<body style="margin:0;padding:0;background-color:#0F0F0F;-webkit-text-size-adjust:100%;">

<!-- WRAPPER -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0F0F0F;">
<tr><td align="center" style="padding:32px 16px;">

<!-- CONTAINER -->
<table width="620" cellpadding="0" cellspacing="0" border="0"
  style="max-width:620px;width:100%;">

  <!-- ── HEADER ── -->
  <tr>
    <td style="border-top:3px solid #C9A84C;padding-top:28px;padding-bottom:32px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="vertical-align:top;">
            <h1 style="font-family:Georgia,serif;font-size:36px;font-weight:900;
              color:#F5F0EA;line-height:1.1;margin:0;letter-spacing:-0.02em;">
              Reporte<br>
              <span style="color:#C9A84C;">Semanal</span><br>
              de Leads
            </h1>
            <p style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;
              color:#B8B0A4;margin:10px 0 0 0;font-family:Arial,sans-serif;">
              Gaby &amp; Beauty &mdash; Analisis de Conversaciones
            </p>
          </td>
          <td style="vertical-align:top;text-align:right;">
            <p style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;
              color:#B8B0A4;margin:0 0 4px 0;font-family:Arial,sans-serif;">Semana del</p>
            <p style="font-family:Georgia,serif;font-size:14px;color:#C9A84C;
              margin:0 0 12px 0;">${semana}</p>
            <p style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;
              color:#B8B0A4;margin:0 0 4px 0;font-family:Arial,sans-serif;">Generado por</p>
            <p style="font-family:Georgia,serif;font-size:12px;color:#C9A84C;margin:0;">
              Agente IA N8N</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ── KPI STRIP ── -->
  <tr>
    <td style="padding-bottom:32px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"
        style="border:1px solid #2E2E2E;">
        <tr>
          <td width="25%" style="background:#1A1A1A;padding:18px 10px;text-align:center;
            border-right:2px solid #0F0F0F;">
            <p style="font-family:Georgia,serif;font-size:28px;font-weight:700;
              color:#C9A84C;margin:0;line-height:1;">${totalLeads}</p>
            <p style="font-size:9px;letter-spacing:0.12em;text-transform:uppercase;
              color:#B8B0A4;margin:6px 0 0 0;font-family:Arial,sans-serif;">Leads Total</p>
          </td>
          <td width="25%" style="background:#1A1A1A;padding:18px 10px;text-align:center;
            border-right:2px solid #0F0F0F;">
            <p style="font-family:Georgia,serif;font-size:28px;font-weight:700;
              color:#E05A5A;margin:0;line-height:1;">${hotLeads}</p>
            <p style="font-size:9px;letter-spacing:0.12em;text-transform:uppercase;
              color:#B8B0A4;margin:6px 0 0 0;font-family:Arial,sans-serif;">Leads Hot</p>
          </td>
          <td width="25%" style="background:#1A1A1A;padding:18px 10px;text-align:center;
            border-right:2px solid #0F0F0F;">
            <p style="font-family:Georgia,serif;font-size:28px;font-weight:700;
              color:#E0964A;margin:0;line-height:1;">${warmLeads}</p>
            <p style="font-size:9px;letter-spacing:0.12em;text-transform:uppercase;
              color:#B8B0A4;margin:6px 0 0 0;font-family:Arial,sans-serif;">Leads Warm</p>
          </td>
          <td width="25%" style="background:#1A1A1A;padding:18px 10px;text-align:center;">
            <p style="font-family:Georgia,serif;font-size:28px;font-weight:700;
              color:#C9A84C;margin:0;line-height:1;">${avgScore}</p>
            <p style="font-size:9px;letter-spacing:0.12em;text-transform:uppercase;
              color:#B8B0A4;margin:6px 0 0 0;font-family:Arial,sans-serif;">Score Promedio</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ── SECTION: LEADS ── -->
  <tr>
    <td style="padding-bottom:8px;">
      <p style="font-size:9px;letter-spacing:0.22em;text-transform:uppercase;color:#C9A84C;
        margin:0 0 16px 0;font-family:Arial,sans-serif;border-bottom:1px solid #2E2E2E;
        padding-bottom:8px;">Analisis Individual de Leads</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        ${renderLeadRows(allLeads)}
      </table>
    </td>
  </tr>

  <!-- SPACER -->
  <tr><td style="height:24px;"></td></tr>

  <!-- ── SECTION: INSIGHTS ── -->
  <tr>
    <td style="padding-bottom:24px;">
      <p style="font-size:9px;letter-spacing:0.22em;text-transform:uppercase;color:#C9A84C;
        margin:0 0 16px 0;font-family:Arial,sans-serif;border-bottom:1px solid #2E2E2E;
        padding-bottom:8px;">Insights de la Semana</p>

      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <!-- col izquierda -->
          <td width="50%" style="vertical-align:top;padding-right:4px;">

            <table width="100%" cellpadding="0" cellspacing="0" border="0"
              style="background:#1A1A1A;margin-bottom:4px;">
              <tr><td style="padding:16px 16px 8px 16px;">
                <p style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;
                  color:#C9A84C;margin:0 0 10px 0;font-family:Arial,sans-serif;">
                  Objeciones Frecuentes</p>
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${renderInsightList(objeciones)}
                </table>
              </td></tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" border="0"
              style="background:#1A1A1A;">
              <tr><td style="padding:16px 16px 8px 16px;">
                <p style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;
                  color:#C9A84C;margin:0 0 10px 0;font-family:Arial,sans-serif;">
                  Cursos Mas Solicitados</p>
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${renderInsightList(cursosMas)}
                </table>
              </td></tr>
            </table>

          </td>
          <!-- col derecha -->
          <td width="50%" style="vertical-align:top;padding-left:4px;">

            <table width="100%" cellpadding="0" cellspacing="0" border="0"
              style="background:#1A1A1A;margin-bottom:4px;">
              <tr><td style="padding:16px 16px 8px 16px;">
                <p style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;
                  color:#C9A84C;margin:0 0 10px 0;font-family:Arial,sans-serif;">
                  Puntos de Caida</p>
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${renderInsightList(puntosCaida)}
                </table>
              </td></tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" border="0"
              style="background:#1A1A1A;">
              <tr><td style="padding:16px 16px 8px 16px;">
                <p style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;
                  color:#C9A84C;margin:0 0 10px 0;font-family:Arial,sans-serif;">
                  Recomendaciones</p>
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${renderInsightList(recomendac)}
                </table>
              </td></tr>
            </table>

          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ── SECTION: GUIONES ── -->
  ${(guionHot || guionWarm || guionCold) ? `
  <tr>
    <td style="padding-bottom:24px;">
      <p style="font-size:9px;letter-spacing:0.22em;text-transform:uppercase;color:#C9A84C;
        margin:0 0 16px 0;font-family:Arial,sans-serif;border-bottom:1px solid #2E2E2E;
        padding-bottom:8px;">Guiones por Tipo de Lead</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        ${renderGuion('🔴 Hot — Cierre directo', '#E05A5A', guionHot)}
        ${renderGuion('🟠 Warm — Resolver objecion', '#E0964A', guionWarm)}
        ${renderGuion('🔵 Cold — Reactivacion', '#5A8AE0', guionCold)}
      </table>
    </td>
  </tr>` : ''}

  <!-- ── SECTION: PREGUNTAS ── -->
  ${preguntasList.length ? `
  <tr>
    <td style="padding-bottom:24px;">
      <p style="font-size:9px;letter-spacing:0.22em;text-transform:uppercase;color:#C9A84C;
        margin:0 0 16px 0;font-family:Arial,sans-serif;border-bottom:1px solid #2E2E2E;
        padding-bottom:8px;">Preguntas de Calificacion</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        ${preguntasList.map((p,i) => `
        <tr>
          <td style="padding:10px 16px;background:#1A1A1A;margin-bottom:3px;
            border-bottom:2px solid #0F0F0F;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:Georgia,serif;font-size:18px;color:#C9A84C;
                  padding-right:14px;vertical-align:middle;line-height:1;">
                  ${String(i+1).padStart(2,'0')}
                </td>
                <td style="font-size:12px;color:#B8B0A4;font-family:Arial,sans-serif;
                  vertical-align:middle;">${esc(p)}</td>
              </tr>
            </table>
          </td>
        </tr>`).join('')}
      </table>
    </td>
  </tr>` : ''}

  <!-- ── FOOTER ── -->
  <tr>
    <td style="border-top:1px solid #2E2E2E;padding-top:20px;padding-bottom:32px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-family:Georgia,serif;font-size:14px;color:#C9A84C;">
            Gaby &amp; Beauty
          </td>
          <td style="text-align:right;font-family:Arial,sans-serif;font-size:10px;color:#5A5A5A;">
            Generado automaticamente por Agente IA N8N<br>
            ${semana} &mdash; ${totalLeads} leads procesados
          </td>
        </tr>
      </table>
    </td>
  </tr>

</table>
<!-- /CONTAINER -->

</td></tr>
</table>
<!-- /WRAPPER -->

</body>
</html>`;

// ── 6. RETORNAR ───────────────────────────────────────────
return {
  html,
  fecha_generacion: now.toISOString(),
  total_leads: totalLeads,
  hot_leads: hotLeads,
  warm_leads: warmLeads,
  score_promedio: avgScore,
  semana,
  _debug_markdowns_recibidos: markdownArray.length,
  _debug_leads_parseados: allLeads.length
};

// ============================================================
// N8N CODE NODE v3 — Aggregate Array → HTML Reporte Semanal
// ------------------------------------------------------------
// INPUT: Aggregate con { output: [ {output: "markdown..."}, ... ] }
// OUTPUT: { html, total_leads, hot_leads, warm_leads, score_promedio }
// ============================================================

// ── 1. EXTRAER LOS MARKDOWNS DEL ARRAY DEL AGGREGATE ─────
const aggregateData = $input.first().json;

// El Aggregate devuelve: { output: [ {output: "md1"}, {output: "md2"} ] }
const markdownArray = (aggregateData.output || aggregateData.data || [])
  .map(item => item.output || item.text || '')
  .filter(Boolean);

// ── 2. HELPERS ────────────────────────────────────────────

function getSection(md, ...keywords) {
  const pattern = keywords.join('|');
  const regex = new RegExp(
    `#{1,4}[^\\n]*(?:${pattern})[^\\n]*\\n([\\s\\S]*?)(?=\\n#{1,4}\\s|$)`, 'i'
  );
  const match = md.match(regex);
  return match ? match[1] : '';
}

function extractBullets(text) {
  return (text.match(/[-*•]\s+(.+)/g) || [])
    .map(b => b.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean);
}

// Parsea TODAS las tablas Markdown de un string → array de objetos
function parseAllTables(md) {
  const lines = md.split('\n');
  let headerLine = null;
  const dataLines = [];
  const results = [];

  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('|')) {
      // Si había tabla activa y encontramos línea sin |, la cerramos
      if (headerLine && dataLines.length) {
        const headers = headerLine.split('|').map(h => h.trim()).filter(Boolean);
        for (const row of dataLines) {
          const cells = row.split('|').map(c => c.trim()).filter(Boolean);
          if (cells.length === 0) continue;
          const obj = {};
          headers.forEach((h, i) => { obj[h] = cells[i] || ''; });
          if (Object.values(obj).some(v => v.length > 0)) results.push(obj);
        }
        headerLine = null;
        dataLines.length = 0;
      }
      continue;
    }
    if (t.includes('---')) continue;
    if (!headerLine) {
      headerLine = t;
    } else {
      dataLines.push(t);
    }
  }
  // Cerrar tabla si el MD termina con tabla
  if (headerLine && dataLines.length) {
    const headers = headerLine.split('|').map(h => h.trim()).filter(Boolean);
    for (const row of dataLines) {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length === 0) continue;
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cells[i] || ''; });
      if (Object.values(obj).some(v => v.length > 0)) results.push(obj);
    }
  }
  return results;
}

// Busca campo en objeto ignorando mayúsculas y acentos
function getField(obj, ...candidates) {
  const normalize = s => s.toLowerCase()
    .replace(/[áéíóú]/g, c => ({á:'a',é:'e',í:'i',ó:'o',ú:'u'}[c]||c));
  for (const candidate of candidates) {
    const found = Object.keys(obj).find(k =>
      normalize(k).includes(normalize(candidate))
    );
    if (found) return obj[found] || '';
  }
  return '';
}

function getStateClass(estado = '') {
  const e = estado.toLowerCase();
  if (e.includes('hot'))  return 'hot';
  if (e.includes('warm')) return 'warm';
  return 'cold';
}

function getScoreClass(score) {
  const n = parseInt(score) || 0;
  if (n >= 75) return 'high';
  if (n >= 50) return 'mid';
  return 'low';
}

function getPriorityBadge(p = '') {
  const u = p.toUpperCase();
  if (u.includes('P1')) return '<span class="badge badge-p1">P1</span>';
  if (u.includes('P2')) return '<span class="badge badge-p2">P2</span>';
  return '<span class="badge badge-p3">P3</span>';
}

function esc(str = '') {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderList(items) {
  if (!items.length) return '<li>Sin datos</li>';
  return items.map(i => `<li>${esc(i)}</li>`).join('\n');
}

function renderPreguntas(items) {
  return items.map((p, i) =>
    `<div class="pregunta-item" data-n="${String(i+1).padStart(2,'0')}">${esc(p)}</div>`
  ).join('\n');
}

// ── 3. PARSEAR TODOS LOS LEADS DE TODOS LOS MARKDOWNS ────
// Cada markdown puede traer 1 o varios leads en su tabla
const allLeads = markdownArray.flatMap(md => parseAllTables(md));

// ── 4. CALCULAR KPIs ──────────────────────────────────────
const totalLeads = allLeads.length;
const hotLeads   = allLeads.filter(l =>
  getField(l,'Estado','Status','State').toLowerCase().includes('hot')).length;
const warmLeads  = allLeads.filter(l =>
  getField(l,'Estado','Status','State').toLowerCase().includes('warm')).length;
const scores     = allLeads
  .map(l => parseInt(getField(l,'Intent Score','Score','Puntaje') || 0))
  .filter(n => n > 0);
const avgScore   = scores.length
  ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0;

// Fechas
const now     = new Date();
const weekAgo = new Date(now - 7*24*60*60*1000);
const fmt     = d => d.toLocaleDateString('es-PA', {day:'2-digit',month:'short',year:'numeric'});
const semana  = `${fmt(weekAgo)} - ${fmt(now)}`;

// ── 5. INSIGHTS — combinar todos los markdowns ────────────
const fullMd = markdownArray.join('\n\n');
const objeciones    = extractBullets(getSection(fullMd,'Objeciones'));
const cursosMas     = extractBullets(getSection(fullMd,'Cursos'));
const puntosCaida   = extractBullets(getSection(fullMd,'Puntos','caen','caida'));
const recomendac    = extractBullets(getSection(fullMd,'Recomendaci'));
const preguntasList = extractBullets(getSection(fullMd,'Preguntas'));

// Guiones — buscar en todos los markdowns
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
const guionHot  = extractGuion(fullMd,'Hot');
const guionWarm = extractGuion(fullMd,'Warm');
const guionCold = extractGuion(fullMd,'Cold|Frio|Frío');

// ── 6. RENDER DE CARDS ────────────────────────────────────
function renderLeadCards(leads) {
  if (!leads.length) {
    return `<div class="raw-md">No se pudieron parsear leads del Markdown recibido.</div>`;
  }

  return leads.map(lead => {
    const nombre    = getField(lead,'Lead ID','Nombre','ID','conversation');
    const curso     = getField(lead,'Curso');
    const estado    = getField(lead,'Estado','Status','State');
    const score     = getField(lead,'Intent Score','Score','Puntaje');
    const urgencia  = getField(lead,'Urgencia');
    const objecion  = getField(lead,'Objecion','Objeciones');
    const siguiente = getField(lead,'Proxima','Siguiente','Accion');
    const mensaje   = getField(lead,'Mensaje');
    const prioridad = getField(lead,'Prioridad');
    const cierre     = getField(lead,'Cierre');
    const sessionId  = getField(lead,'session_id','Session ID','session','telefono','phone') || getField(lead,'Contacto','Contact');
    const sc = getStateClass(estado);

    const tags = objecion.split(',').map(t=>t.trim()).filter(Boolean)
      .map(t=>`<span class="tag">${esc(t)}</span>`).join('');

    return `
<div class="lead-card ${sc}">
  <div>
    <div class="lead-top">
      <span class="lead-id">${esc(nombre)}</span>
      <span class="badge badge-${sc}">${esc(estado)}</span>
      ${getPriorityBadge(prioridad)}
      ${urgencia ? `<span class="urgencia">Urgencia: ${esc(urgencia)}</span>` : ''}
      ${cierre   ? `<span class="urgencia">Cierre: ${esc(cierre)}</span>`   : ''}
    </div>
    ${sessionId ? `<div class="lead-phone"><span class="phone-icon">📞</span><a href="https://wa.me/${esc(sessionId)}" class="phone-link">${esc(sessionId)}</a></div>` : ''}
    ${curso  ? `<div class="lead-curso">${esc(curso)}</div>` : ''}
    ${tags   ? `<div class="lead-tags">${tags}</div>` : ''}
    ${siguiente ? `<div class="lead-action"><strong>Proxima accion:</strong> ${esc(siguiente)}</div>` : ''}
    ${mensaje   ? `<div class="msg-box"><div class="msg-label">Mensaje recomendado</div>"${esc(mensaje)}"</div>` : ''}
  </div>
  <div class="score-block">
    <div class="score-ring ${getScoreClass(score)}">${esc(score)}</div>
    <div class="score-label">Score</div>
  </div>
</div>`;
  }).join('\n');
}

// ── 7. HTML COMPLETO ──────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reporte Semanal de Leads</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  :root{--gold:#C9A84C;--gold-light:#E8C96A;--dark:#0F0F0F;--dark-2:#1A1A1A;--dark-3:#252525;
    --dark-4:#2E2E2E;--white:#F5F0EA;--white-dim:#B8B0A4;--hot:#E05A5A;--warm:#E0964A;
    --cold:#5A8AE0;--p2:#8A7A5A;--p3:#5A5A5A;}
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:var(--dark);color:var(--white);font-family:'DM Sans',sans-serif;
    font-weight:300;line-height:1.6;max-width:860px;margin:0 auto;padding:40px 24px;}
  .header{border-top:3px solid var(--gold);padding-top:32px;margin-bottom:48px;
    display:flex;justify-content:space-between;align-items:flex-start;gap:24px;}
  .header-left h1{font-family:'Playfair Display',serif;font-size:2.6rem;font-weight:900;
    color:var(--white);line-height:1.1;letter-spacing:-0.02em;}
  .header-left h1 span{color:var(--gold);}
  .header-left .subtitle{font-size:0.78rem;letter-spacing:0.18em;text-transform:uppercase;
    color:var(--white-dim);margin-top:8px;}
  .header-right{text-align:right;flex-shrink:0;}
  .date-label{font-size:0.7rem;letter-spacing:0.15em;text-transform:uppercase;color:var(--white-dim);}
  .date-value{font-family:'Playfair Display',serif;font-size:1.1rem;color:var(--gold);margin-top:4px;}
  .kpi-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;margin-bottom:48px;border:1px solid var(--dark-4);}
  .kpi{background:var(--dark-2);padding:20px 18px;text-align:center;}
  .kpi-number{font-family:'Playfair Display',serif;font-size:2.2rem;font-weight:700;color:var(--gold);line-height:1;}
  .kpi-label{font-size:0.68rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--white-dim);margin-top:6px;}
  .section-title{font-size:0.68rem;letter-spacing:0.22em;text-transform:uppercase;color:var(--gold);
    margin-bottom:20px;padding-bottom:8px;border-bottom:1px solid var(--dark-4);}
  .leads-grid{display:flex;flex-direction:column;gap:3px;margin-bottom:48px;}
  .lead-card{background:var(--dark-2);border-left:3px solid var(--dark-4);padding:20px 24px;
    display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start;}
  .lead-card.hot{border-left-color:var(--hot);}
  .lead-card.warm{border-left-color:var(--warm);}
  .lead-card.cold{border-left-color:var(--cold);}
  .lead-top{display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap;}
  .lead-id{font-family:'Playfair Display',serif;font-size:0.95rem;font-weight:700;color:var(--white);}
  .badge{font-size:0.6rem;letter-spacing:0.15em;text-transform:uppercase;padding:3px 9px;font-weight:600;}
  .badge-hot{background:var(--hot);color:#fff;} .badge-warm{background:var(--warm);color:#fff;}
  .badge-cold{background:var(--cold);color:#fff;} .badge-p1{background:var(--gold);color:var(--dark);}
  .badge-p2{background:var(--p2);color:#fff;} .badge-p3{background:var(--p3);color:#fff;}
  .lead-phone{display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 10px;
    background:var(--dark-3);border-left:2px solid var(--gold);width:fit-content;}
  .phone-icon{font-size:0.85rem;}
  .phone-link{font-size:0.82rem;color:var(--gold-light);font-weight:600;letter-spacing:0.05em;
    text-decoration:none;font-family:'DM Sans',sans-serif;}
  .phone-link:hover{color:var(--gold);}
  .lead-curso{font-size:0.8rem;color:var(--white-dim);margin-bottom:8px;font-style:italic;}
  .lead-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;}
  .tag{font-size:0.65rem;letter-spacing:0.08em;padding:2px 8px;background:var(--dark-4);
    color:var(--white-dim);text-transform:uppercase;}
  .lead-action{font-size:0.78rem;color:var(--gold-light);padding:8px 12px;
    border:1px solid var(--dark-4);background:var(--dark-3);margin-top:8px;}
  .lead-action strong{color:var(--gold);}
  .score-block{text-align:center;min-width:64px;}
  .score-ring{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;
    justify-content:center;font-family:'Playfair Display',serif;font-size:1.1rem;
    font-weight:700;margin:0 auto 4px;border:2px solid;}
  .score-ring.high{border-color:var(--hot);color:var(--hot);}
  .score-ring.mid{border-color:var(--warm);color:var(--warm);}
  .score-ring.low{border-color:var(--cold);color:var(--cold);}
  .score-label{font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--white-dim);}
  .msg-box{background:var(--dark-3);border-left:2px solid var(--gold);padding:12px 16px;
    font-size:0.8rem;color:var(--white-dim);margin-top:10px;font-style:italic;line-height:1.5;}
  .msg-label{font-size:0.6rem;letter-spacing:0.15em;text-transform:uppercase;color:var(--gold);
    font-style:normal;font-weight:600;margin-bottom:5px;}
  .insights-grid{display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:48px;}
  .insight-card{background:var(--dark-2);padding:20px;}
  .insight-card h4{font-size:0.65rem;letter-spacing:0.18em;text-transform:uppercase;color:var(--gold);margin-bottom:12px;}
  .insight-card ul{list-style:none;display:flex;flex-direction:column;gap:6px;}
  .insight-card ul li{font-size:0.8rem;color:var(--white-dim);padding-left:14px;position:relative;}
  .insight-card ul li::before{content:'--';position:absolute;left:0;color:var(--gold);font-size:0.7rem;}
  .guiones{margin-bottom:48px;display:flex;flex-direction:column;gap:3px;}
  .guion-card{background:var(--dark-2);padding:20px 24px;}
  .guion-tipo{font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:10px;font-weight:600;}
  .guion-tipo.hot{color:var(--hot);} .guion-tipo.warm{color:var(--warm);} .guion-tipo.cold{color:var(--cold);}
  .guion-text{font-size:0.83rem;color:var(--white);line-height:1.6;font-style:italic;
    border-left:2px solid var(--dark-4);padding-left:14px;}
  .preguntas-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:3px;margin-bottom:48px;}
  .pregunta-item{background:var(--dark-2);padding:14px 18px;font-size:0.8rem;color:var(--white-dim);
    display:flex;align-items:flex-start;gap:10px;}
  .pregunta-item::before{content:attr(data-n);font-family:'Playfair Display',serif;font-size:1rem;
    color:var(--gold);flex-shrink:0;line-height:1.3;}
  .footer{border-top:1px solid var(--dark-4);padding-top:20px;display:flex;
    justify-content:space-between;align-items:center;}
  .footer-brand{font-family:'Playfair Display',serif;font-size:0.9rem;color:var(--gold);}
  .footer-note{font-size:0.68rem;color:var(--p3);text-align:right;}
  .urgencia{font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;padding:2px 7px;
    background:var(--dark-4);color:var(--white-dim);}
  .raw-md{background:var(--dark-2);padding:24px;color:var(--white-dim);font-size:0.82rem;
    white-space:pre-wrap;line-height:1.7;}
</style>
</head>
<body>

<header class="header">
  <div class="header-left">
    <h1>Reporte<br><span>Semanal</span><br>de Leads</h1>
    <p class="subtitle">Gaby &amp; Beauty -- Analisis de Conversaciones</p>
  </div>
  <div class="header-right">
    <div class="date-label">Semana del</div>
    <div class="date-value">${semana}</div>
  </div>
</header>

<div class="kpi-strip">
  <div class="kpi">
    <div class="kpi-number">${totalLeads}</div>
    <div class="kpi-label">Leads Analizados</div>
  </div>
  <div class="kpi">
    <div class="kpi-number" style="color:var(--hot)">${hotLeads}</div>
    <div class="kpi-label">Leads Hot</div>
  </div>
  <div class="kpi">
    <div class="kpi-number" style="color:var(--warm)">${warmLeads}</div>
    <div class="kpi-label">Leads Warm</div>
  </div>
  <div class="kpi">
    <div class="kpi-number" style="color:var(--gold)">${avgScore}</div>
    <div class="kpi-label">Score Promedio</div>
  </div>
</div>

<div class="section-title">Analisis Individual de Leads</div>
<div class="leads-grid">
${renderLeadCards(allLeads)}
</div>

<div class="section-title">Insights de la Semana</div>
<div class="insights-grid">
  <div class="insight-card">
    <h4>Objeciones Frecuentes</h4>
    <ul>${renderList(objeciones)}</ul>
  </div>
  <div class="insight-card">
    <h4>Cursos Mas Solicitados</h4>
    <ul>${renderList(cursosMas)}</ul>
  </div>
  <div class="insight-card">
    <h4>Puntos de Caida</h4>
    <ul>${renderList(puntosCaida)}</ul>
  </div>
  <div class="insight-card">
    <h4>Recomendaciones</h4>
    <ul>${renderList(recomendac)}</ul>
  </div>
</div>

${(guionHot||guionWarm||guionCold) ? `
<div class="section-title">Guiones por Tipo de Lead</div>
<div class="guiones">
  ${guionHot  ? '<div class="guion-card"><div class="guion-tipo hot">Hot</div><div class="guion-text">"'  +esc(guionHot) +'</div></div>' : ''}
  ${guionWarm ? '<div class="guion-card"><div class="guion-tipo warm">Warm</div><div class="guion-text">"' +esc(guionWarm)+'</div></div>' : ''}
  ${guionCold ? '<div class="guion-card"><div class="guion-tipo cold">Cold</div><div class="guion-text">"' +esc(guionCold)+'</div></div>' : ''}
</div>` : ''}

${preguntasList.length ? `
<div class="section-title">Preguntas de Calificacion</div>
<div class="preguntas-grid">
${renderPreguntas(preguntasList)}
</div>` : ''}

<footer class="footer">
  <div class="footer-brand">Gaby &amp; Beauty</div>
  <div class="footer-note">
    Generado automaticamente por Agente IA N8N<br>
    ${semana} -- ${totalLeads} leads procesados
  </div>
</footer>

</body>
</html>`;

// ── 8. RETORNAR ───────────────────────────────────────────
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

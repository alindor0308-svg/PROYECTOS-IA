'use strict';
// Íconos, gráficos SVG/HTML sin librerías y tooltip compartido.

const ICONOS = {
  inicio: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  ordenes: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2.5h6v3H9zM9 11h6M9 15h4"/>',
  carrito: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.4L21 8H6.2"/>',
  entrada: '<path d="M12 3v11M7.5 9.5 12 14l4.5-4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  movimientos: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  caja: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  luna: '<path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.6 6.6 0 0 0 10 10z"/>',
  dinero: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  camion: '<path d="M2.5 6h11v10h-11zM13.5 10h4l3 3.2V16h-7"/><circle cx="6.5" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  tendencia: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
};

function icono(nombre) {
  return `<svg class="icono" viewBox="0 0 24 24" aria-hidden="true">${ICONOS[nombre] || ''}</svg>`;
}

const escG = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Escala "bonita" para el eje Y.
function maximoBonito(v) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

function abreviar(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' M';
  if (a >= 1e3) return (n / 1e3).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' mil';
  return n.toLocaleString('es-PE', { maximumFractionDigits: 0 });
}

// ---------- Tooltip ----------

const tooltip = () => document.getElementById('tooltip');

// datos = { t: título, f: [[valor, nombre, colorCss], ...] }. Se arma con textContent.
function mostrarTip(datos, x, y) {
  const tt = tooltip();
  tt.replaceChildren();
  if (datos.t) {
    const t = document.createElement('div');
    t.className = 'tt-titulo';
    t.textContent = datos.t;
    tt.appendChild(t);
  }
  for (const [valor, nombre, color] of datos.f || []) {
    const fila = document.createElement('div');
    fila.className = 'tt-fila';
    if (color) {
      const i = document.createElement('i');
      i.style.background = color;
      fila.appendChild(i);
    }
    const b = document.createElement('b');
    b.textContent = valor;
    fila.appendChild(b);
    if (nombre) {
      const s = document.createElement('span');
      s.textContent = nombre;
      fila.appendChild(s);
    }
    tt.appendChild(fila);
  }
  tt.hidden = false;
  const r = tt.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > innerHeight - 8) top = y - r.height - 14;
  tt.style.left = Math.max(8, left) + 'px';
  tt.style.top = Math.max(8, top) + 'px';
}

function ocultarTip() {
  const tt = tooltip();
  if (tt) tt.hidden = true;
}

const tipAttr = (datos) => `data-tip="${escG(JSON.stringify(datos))}" tabindex="0"`;

document.addEventListener('pointermove', (ev) => {
  const capa = ev.target.closest?.('.capa-hover');
  if (capa) return moverCruz(capa, ev.clientX, ev.clientY);
  const el = ev.target.closest?.('[data-tip]');
  if (el) mostrarTip(JSON.parse(el.dataset.tip), ev.clientX, ev.clientY);
  else ocultarTip();
});
document.addEventListener('focusin', (ev) => {
  const el = ev.target.closest?.('[data-tip]');
  if (el) {
    const r = el.getBoundingClientRect();
    mostrarTip(JSON.parse(el.dataset.tip), r.right, r.top);
  }
});
document.addEventListener('focusout', ocultarTip);
document.addEventListener('scroll', ocultarTip, true);

// ---------- Líneas en el tiempo (una sola escala) ----------

const REGISTRO_GRAFICOS = {};
let contadorGraficos = 0;

// opciones: { etiquetas: [...], titulos: [...] (texto largo para el tooltip), series: [{ nombre, color, valores }], formato }
function graficoLineas({ etiquetas, titulos, series, formato }) {
  const id = 'g' + ++contadorGraficos;
  const W = 900;
  const H = 280;
  const m = { l: 62, r: 96, t: 14, b: 30 };
  const n = etiquetas.length;
  const ancho = W - m.l - m.r;
  const alto = H - m.t - m.b;
  const max = maximoBonito(Math.max(0, ...series.flatMap((s) => s.valores)));
  const x = (i) => m.l + (n <= 1 ? ancho / 2 : (i * ancho) / (n - 1));
  const y = (v) => m.t + alto - (v / max) * alto;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const cadaCuanto = Math.max(1, Math.ceil(n / 8));

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escG(series.map((s) => s.nombre).join(' y '))} por periodo">`;
  for (const t of ticks) {
    svg += `<line class="${t === 0 ? 'eje' : 'grilla'}" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${escG(abreviar(t))}</text>`;
  }
  etiquetas.forEach((e, i) => {
    if (i % cadaCuanto === 0 || i === n - 1) svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${escG(e)}</text>`;
  });
  // Áreas suaves y luego líneas de 2px.
  for (const s of series) {
    const pts = s.valores.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    svg += `<polygon points="${x(0)},${y(0)} ${pts} ${x(n - 1)},${y(0)}" fill="${s.color}" opacity="0.14"/>`;
  }
  for (const s of series) {
    const pts = s.valores.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    svg += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  // Etiquetas directas al final de cada línea, separadas si chocan.
  // Se ordenan de abajo hacia arriba y se suben para no chocar entre sí ni con el eje X.
  const finales = series.map((s) => ({ s, yy: Math.min(y(s.valores[n - 1] || 0), y(0) - 8) })).sort((a, b) => b.yy - a.yy);
  for (let i = 1; i < finales.length; i++) if (finales[i - 1].yy - finales[i].yy < 16) finales[i].yy = finales[i - 1].yy - 16;
  for (const f of finales) svg += `<text x="${x(n - 1) + 10}" y="${f.yy + 4}">${escG(f.s.nombre)}</text>`;
  // Capa de interacción: cruz vertical + puntos.
  svg += `<line id="${id}-cruz" class="cruz" x1="0" x2="0" y1="${m.t}" y2="${m.t + alto}" visibility="hidden"/>`;
  series.forEach((s, k) => {
    svg += `<circle id="${id}-p${k}" r="5" fill="${s.color}" stroke="var(--panel)" stroke-width="2" visibility="hidden"/>`;
  });
  svg += `<rect class="capa-hover" data-id="${id}" x="${m.l - 10}" y="${m.t}" width="${ancho + 20}" height="${alto}" fill="transparent" tabindex="0"/>`;
  svg += '</svg>';
  REGISTRO_GRAFICOS[id] = { etiquetas, titulos: titulos || etiquetas, series, formato, x, y, n, W };
  return `<div class="grafico">${svg}</div>`;
}

function moverCruz(capa, cx, cy, indice) {
  const g = REGISTRO_GRAFICOS[capa.dataset.id];
  if (!g) return;
  const svg = capa.ownerSVGElement;
  let i = indice;
  if (i === undefined) {
    const r = svg.getBoundingClientRect();
    const vx = ((cx - r.left) / r.width) * g.W;
    i = 0;
    for (let k = 1; k < g.n; k++) if (Math.abs(g.x(k) - vx) < Math.abs(g.x(i) - vx)) i = k;
  }
  capa.dataset.i = i;
  const id = capa.dataset.id;
  const cruz = document.getElementById(id + '-cruz');
  cruz.setAttribute('x1', g.x(i));
  cruz.setAttribute('x2', g.x(i));
  cruz.setAttribute('visibility', 'visible');
  g.series.forEach((s, k) => {
    const p = document.getElementById(`${id}-p${k}`);
    p.setAttribute('cx', g.x(i));
    p.setAttribute('cy', g.y(s.valores[i]));
    p.setAttribute('visibility', 'visible');
  });
  mostrarTip({ t: g.titulos[i], f: g.series.map((s) => [g.formato(s.valores[i]), s.nombre, s.color]) }, cx, cy);
}

function ocultarCruz(capa) {
  const id = capa.dataset.id;
  const g = REGISTRO_GRAFICOS[id];
  document.getElementById(id + '-cruz')?.setAttribute('visibility', 'hidden');
  g?.series.forEach((s, k) => document.getElementById(`${id}-p${k}`)?.setAttribute('visibility', 'hidden'));
  ocultarTip();
}

document.addEventListener('pointerout', (ev) => {
  if (ev.target.classList?.contains('capa-hover')) ocultarCruz(ev.target);
});
document.addEventListener('focusin', (ev) => {
  if (!ev.target.classList?.contains('capa-hover')) return;
  const g = REGISTRO_GRAFICOS[ev.target.dataset.id];
  const r = ev.target.getBoundingClientRect();
  moverCruz(ev.target, r.right, r.top, g.n - 1);
});
document.addEventListener('keydown', (ev) => {
  const capa = ev.target;
  if (!capa.classList?.contains('capa-hover') || !['ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
  ev.preventDefault();
  const g = REGISTRO_GRAFICOS[capa.dataset.id];
  const i = Math.min(g.n - 1, Math.max(0, Number(capa.dataset.i || g.n - 1) + (ev.key === 'ArrowRight' ? 1 : -1)));
  const r = capa.getBoundingClientRect();
  moverCruz(capa, r.left + (g.x(i) / g.W) * r.width, r.top, i);
});

// ---------- Barras horizontales (una serie, un color) ----------

// filas: [{ etiqueta, valor, texto, enlace, tip }]
function graficoBarrasH(filas, { color = 'var(--s-azul)', max } = {}) {
  if (!filas.length) return '<p class="vacio-grafico">Sin datos todavía.</p>';
  const tope = max || Math.max(...filas.map((f) => f.valor)) || 1;
  return `<div class="grafico barras-h">${filas.map((f) => `
    <div class="bh-fila" ${tipAttr(f.tip || { t: f.etiqueta, f: [[f.texto, '', color]] })}>
      <div class="bh-etiqueta">${f.enlace ? `<a href="${f.enlace}">${escG(f.etiqueta)}</a>` : escG(f.etiqueta)}</div>
      <div class="bh-pista"><i style="width:${Math.max(0.5, (f.valor / tope) * 78)}%;background:${color}"></i><span>${escG(f.texto)}</span></div>
    </div>`).join('')}</div>`;
}

// Tabla accesible con los mismos datos que un gráfico.
function tablaDatos(cabeceras, filas) {
  return `<details class="datos"><summary>Ver datos en tabla</summary><div class="tabla-envoltura"><table>
    <thead><tr>${cabeceras.map((c, i) => `<th class="${i ? 'n' : ''}">${escG(c)}</th>`).join('')}</tr></thead>
    <tbody>${filas.map((f) => `<tr>${f.map((c, i) => `<td class="${i ? 'n' : ''}">${escG(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div></details>`;
}

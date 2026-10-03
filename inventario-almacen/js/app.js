'use strict';
// Inventario de almacén ligado a órdenes de compra de clientes.
// Entradas = compras a proveedores. Salidas = entregas a la entidad contra una O/C.
// El stock y el costo promedio se calculan siempre desde los movimientos (nunca se editan a mano).

const CLAVE = 'inventario-almacen-v1';
const TIPOS = {
  ENTRADA: 'Entrada (compra)',
  SALIDA: 'Salida (entrega)',
  DEVOLUCION: 'Devolución al almacén',
  AJUSTE: 'Ajuste',
};
const UNIDADES = ['UND', 'M', 'M2', 'M3', 'KG', 'GLN', 'L', 'PZA', 'JGO', 'PAR', 'ROLLO', 'BOLSA', 'CAJA', 'PLANCHA', 'VARILLA'];
const EPS = 1e-6;

// ---------- Utilidades ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};
const redondear = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const fmt = (n, d = 2) => (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });
const cant = (n) => (Number(n) || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const soles = (n) => 'S/ ' + fmt(n);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fechaPe = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : esc(iso || ''));
const sumarDias = (iso, dias) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + (Number(dias) || 0));
  return d.toISOString().slice(0, 10);
};
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

// ---------- Datos ----------

function baseVacia() {
  return {
    version: 1,
    empresa: { nombre: 'AQUINO GROUP CONSTRUCTION S.A.C.', ruc: '20615677559', almacen: 'Almacén principal' },
    materiales: [],
    ordenes: [],
    movimientos: [],
    contador: 0,
  };
}

let db = null;
try {
  db = JSON.parse(localStorage.getItem(CLAVE));
} catch (e) {
  db = null;
}
if (!db || !Array.isArray(db.materiales)) {
  db = baseVacia();
  cargarOrdenesIniciales();
  guardar();
}
let avisoImportacion = importarComprasRegistradas();

function guardar() {
  numerarCompras();
  try {
    localStorage.setItem(CLAVE, JSON.stringify(db));
    $('#aviso-guardado').hidden = true;
  } catch (e) {
    $('#aviso-guardado').hidden = false;
  }
}

function cargarOrdenesIniciales() {
  let agregadas = 0;
  for (const o of ORDENES_INICIALES) {
    if (db.ordenes.some((x) => x.numero === o.numero && norm(x.entidad) === norm(o.entidad))) continue;
    const { items, ...cabecera } = o;
    db.ordenes.push({
      id: uid(),
      ...cabecera,
      notificacion: cabecera.fecha,
      obs: '',
      creado: Date.now(),
      items: items.map(([c, u, d, pu]) => ({ materialId: asegurarMaterial(d, u).id, cant: c, unidad: u, pu })),
    });
    agregadas++;
  }
  return agregadas;
}

// Cada factura de compra (grupo de entradas) recibe un N° correlativo C-0001, C-0002…, en orden de fecha.
// El número no cambia aunque la factura se anule, para que la numeración no tenga huecos ni se repita.
function numerarCompras() {
  const grupos = new Map();
  for (const m of db.movimientos) {
    if (m.tipo !== 'ENTRADA') continue;
    const k = m.grupo || m.id;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(m);
  }
  const sinNumero = [...grupos.values()].filter((g) => !g.some((m) => m.nroCompra)).sort((a, b) => ordenCrono(a[0], b[0]));
  for (const g of grupos.values()) {
    const n = g.find((m) => m.nroCompra)?.nroCompra;
    if (n) g.forEach((m) => { m.nroCompra = n; });
  }
  for (const g of sinNumero) {
    db.contadorCompras = (db.contadorCompras || 0) + 1;
    g.forEach((m) => { m.nroCompra = db.contadorCompras; });
  }
}

const nroCompra = (n) => (n ? 'C-' + String(n).padStart(4, '0') : '');

// "F001-00000962" y "f001-962" son el mismo comprobante.
function claveDocumento(doc) {
  const m = String(doc || '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z0-9]{1,4})-0*(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : norm(doc);
}

// Agrega como entradas las facturas incluidas en la app que aún no estén registradas (una sola vez cada una).
function importarComprasRegistradas() {
  if (typeof COMPRAS_REGISTRADAS === 'undefined') return '';
  db.importados = db.importados || [];
  db.versionesImportadas = db.versionesImportadas || {};
  const agregadas = [];
  const actualizadas = [];
  const problemas = [];
  for (const c of [...COMPRAS_REGISTRADAS].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const clave = `COMPRA|${c.ruc}|${claveDocumento(c.documento)}`;
    const version = c.version || 1;
    if (db.importados.includes(clave)) {
      // Factura ya cargada: si se corrigió (versión mayor), se reemplazan sus ítems conservando su N° de compra.
      if (version <= (db.versionesImportadas[clave] || 1)) continue;
      db.versionesImportadas[clave] = version;
      const viejos = db.movimientos.filter((m) => m.origen === clave);
      if (!viejos.length || viejos.some((m) => m.anulado)) continue; // registrada a mano o anulada: no se toca
      const nuevos = movimientosDeCompra(c, clave, viejos[0].grupo, viejos[0].creado, viejos[0].nroCompra);
      const prueba = [...db.movimientos.filter((m) => m.origen !== clave), ...nuevos];
      const antes = new Set(materialesEnNegativo(db.movimientos).map((m) => m.id));
      if (materialesEnNegativo(prueba).some((m) => !antes.has(m.id))) {
        problemas.push(`${c.documento}: no se pudo actualizar porque ya se entregó parte de su material`);
        continue;
      }
      db.movimientos = prueba;
      quitarMaterialesHuerfanos(viejos.map((m) => m.materialId));
      actualizadas.push(`${c.documento} de ${c.proveedor}`);
      continue;
    }
    db.importados.push(clave);
    db.versionesImportadas[clave] = version;
    const yaEsta = db.movimientos.some((m) => m.tipo === 'ENTRADA' && !m.anulado && claveDocumento(m.documento) === claveDocumento(c.documento)
      && (!m.tercero || norm(m.tercero).includes(c.ruc) || norm(c.proveedor).split(' ').some((p) => p.length > 3 && norm(m.tercero).includes(p))));
    if (yaEsta) continue;
    db.movimientos.push(...movimientosDeCompra(c, clave, uid(), Date.now()));
    agregadas.push(`${c.documento} de ${c.proveedor} (${soles(c.total)})`);
  }
  guardar();
  const partes = [];
  if (agregadas.length) partes.push(`Se agregaron a tu inventario ${agregadas.length} factura(s) de compra: ${agregadas.join('; ')}.`);
  if (actualizadas.length) partes.push(`Se actualizaron: ${actualizadas.join('; ')}.`);
  if (problemas.length) partes.push(problemas.join('. ') + '.');
  return partes.join(' ').replace(/\.\./g, '.');
}

// Convierte una factura incluida en la app en movimientos de entrada.
// Un ítem puede ir a un material del catálogo (equivalencia) o repartirse en varios (lista de equivalencias con "proporcion" del precio).
function movimientosDeCompra(c, clave, grupo, creado, nro) {
  const movs = [];
  c.items.forEach(([cant, unidad, descripcion, precio, eq]) => {
    const partes = !eq ? [null] : Array.isArray(eq) ? eq : [eq];
    for (const parte of partes) {
      const factor = parte?.factor || 1;
      const proporcion = parte?.proporcion ?? 1;
      const mat = asegurarMaterial(parte ? parte.material : descripcion, unidad);
      const oc = parte?.oc ? db.ordenes.find((o) => o.numero === parte.oc) : null;
      movs.push({
        id: uid(), grupo, creado: creado + movs.length, fecha: c.fecha, tipo: 'ENTRADA', materialId: mat.id,
        cantidad: redondear(cant * factor), costo: redondear((precio * proporcion) / factor, 6), ordenId: oc ? oc.id : '',
        documento: c.documento, tercero: `${c.proveedor} (RUC ${c.ruc})`, formaPago: c.vence ? 'CREDITO' : 'CONTADO', vence: c.vence || '',
        obs: (parte ? `En factura: ${cant} ${unidad} ${descripcion} a ${soles(precio)} c/u${partes.length > 1 ? ` (${fmt(proporcion * 100, 0)}% del precio)` : ''} · ` : '')
          + `Pago ${c.pago || ''} · precios con IGV`,
        origen: clave,
        ...(nro ? { nroCompra: nro } : {}),
      });
    }
  });
  return movs;
}

// Borra del catálogo los materiales que quedaron sin movimientos y que no están en ninguna O/C.
function quitarMaterialesHuerfanos(ids) {
  const usados = new Set([...db.movimientos.map((m) => m.materialId), ...db.ordenes.flatMap((o) => o.items.map((it) => it.materialId))]);
  db.materiales = db.materiales.filter((m) => !ids.includes(m.id) || usados.has(m.id));
}

function asegurarMaterial(descripcion, unidad) {
  const k = norm(descripcion);
  let m = db.materiales.find((x) => norm(x.descripcion) === k);
  if (!m) {
    db.contador = (db.contador || 0) + 1;
    m = {
      id: uid(),
      codigo: 'M' + String(db.contador).padStart(4, '0'),
      descripcion: String(descripcion).replace(/\s+/g, ' ').trim(),
      unidad: String(unidad || 'UND').toUpperCase().trim(),
      minimo: 0,
    };
    db.materiales.push(m);
  }
  return m;
}

const material = (id) => db.materiales.find((m) => m.id === id);
const orden = (id) => db.ordenes.find((o) => o.id === id);
function ordenCrono(a, b) {
  return (a.fecha || '').localeCompare(b.fecha || '') || (a.creado || 0) - (b.creado || 0);
}

// Recalcula stock, costo promedio y cantidades entregadas por O/C a partir de los movimientos.
function calcular(movimientos = db.movimientos) {
  const mats = new Map(db.materiales.map((m) => [m.id, { entradas: 0, salidas: 0, stock: 0, valor: 0, costo: 0, ultimoCosto: 0, negativo: false }]));
  const entregado = new Map();
  const costoMov = new Map();
  const saldoMov = new Map();
  const movs = movimientos.filter((m) => !m.anulado).sort(ordenCrono);
  for (const mv of movs) {
    const s = mats.get(mv.materialId);
    if (!s) continue;
    const c = num(mv.cantidad);
    if (mv.tipo === 'ENTRADA') {
      const cu = num(mv.costo);
      s.stock += c;
      s.valor += c * cu;
      s.entradas += c;
      s.ultimoCosto = cu;
      costoMov.set(mv.id, cu);
    } else {
      const cu = s.stock > EPS ? s.valor / s.stock : s.costo;
      const delta = mv.tipo === 'SALIDA' ? -c : c; // DEVOLUCION suma; AJUSTE ya trae su signo
      s.stock += delta;
      s.valor += delta * cu;
      if (delta >= 0) s.entradas += delta;
      else s.salidas += -delta;
      costoMov.set(mv.id, cu);
    }
    if (s.stock < -EPS) s.negativo = true;
    if (Math.abs(s.stock) < EPS) {
      s.stock = 0;
      s.valor = 0;
    }
    if (s.stock > EPS) s.costo = s.valor / s.stock;
    else if (mv.tipo === 'ENTRADA') s.costo = num(mv.costo);
    saldoMov.set(mv.id, s.stock);
    if (mv.ordenId && (mv.tipo === 'SALIDA' || mv.tipo === 'DEVOLUCION')) {
      const k = mv.ordenId + '|' + mv.materialId;
      entregado.set(k, (entregado.get(k) || 0) + (mv.tipo === 'SALIDA' ? c : -c));
    }
  }
  return { mats, entregado, costoMov, saldoMov };
}

// Devuelve los materiales que quedarían con stock negativo en algún momento si se aplican estos cambios.
function materialesEnNegativo(movimientos) {
  const r = calcular(movimientos);
  return db.materiales.filter((m) => r.mats.get(m.id)?.negativo);
}

function estadoOrden(o, calc) {
  const items = o.items.map((it) => {
    const ent = calc.entregado.get(o.id + '|' + it.materialId) || 0;
    const pend = Math.max(0, redondear(it.cant - ent));
    const st = calc.mats.get(it.materialId) || { stock: 0 };
    return { ...it, entregado: ent, pendiente: pend, stock: st.stock, faltaComprar: Math.max(0, redondear(pend - Math.max(0, st.stock))) };
  });
  const total = items.reduce((a, it) => a + it.cant * it.pu, 0);
  const totalEntregado = items.reduce((a, it) => a + Math.min(it.entregado, it.cant) * it.pu, 0);
  let costo = 0;
  for (const mv of db.movimientos) {
    if (mv.anulado || mv.ordenId !== o.id) continue;
    if (mv.tipo === 'SALIDA') costo += num(mv.cantidad) * (calc.costoMov.get(mv.id) || 0);
    if (mv.tipo === 'DEVOLUCION') costo -= num(mv.cantidad) * (calc.costoMov.get(mv.id) || 0);
  }
  const completa = items.every((it) => it.pendiente <= EPS);
  const alguna = items.some((it) => it.entregado > EPS);
  const vence = sumarDias(o.notificacion || o.fecha, o.plazoDias);
  let estado = completa ? 'Entregada' : alguna ? 'Parcial' : 'Pendiente';
  if (o.cerrada && !completa) estado = 'Cerrada';
  const vencida = !completa && !o.cerrada && vence < hoy();
  return { items, total, totalEntregado, costo, estado, vence, vencida, avance: total > 0 ? totalEntregado / total : 0 };
}

function etiquetaEstado(e) {
  const clase = { Entregada: 'e-verde', Parcial: 'e-ambar', Pendiente: 'e-azul', Cerrada: 'e-verde' }[e.estado];
  return `<span class="etiqueta ${clase}">${e.estado}</span>${e.vencida ? ' <span class="etiqueta e-rojo">Vencida</span>' : ''}`;
}

const barra = (p) => `<div class="barra" title="${fmt(p * 100, 0)}%"><i style="width:${Math.min(100, p * 100)}%"></i></div>`;

// ---------- Enrutador ----------

const vistas = {};
const acciones = {};
const formularios = {};
let alMontar = null;

function render() {
  const [ruta, ...args] = (location.hash.slice(1) || 'resumen').split('/').map(decodeURIComponent);
  const vista = vistas[ruta] || vistas.resumen;
  alMontar = null;
  ocultarTip();
  $('#app').innerHTML = vista(...args);
  pintarMarca();
  const activa = { orden: 'ordenes', 'nueva-orden': 'ordenes', 'editar-orden': 'ordenes', entrega: 'ordenes', kardex: 'stock', material: 'stock', factura: 'facturas', conteo: 'stock', 'nuevo-mov': 'movimientos' }[ruta] || ruta;
  $$('#menu a').forEach((a) => a.classList.toggle('activo', a.getAttribute('href') === '#' + (vistas[activa] ? activa : 'resumen')));
  $('#lateral').classList.remove('abierto');
  if (alMontar) alMontar();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);

function iniciales(nombre) {
  const palabras = String(nombre || '').replace(/S\.?A\.?C\.?|E\.?I\.?R\.?L\.?|S\.?R\.?L\.?|S\.?A\.?/g, '').split(/\s+/).filter((p) => p.length > 2);
  return (palabras.slice(0, 2).map((p) => p[0]).join('') || 'AL').toUpperCase();
}

function pintarMarca() {
  $('#empresa-nombre').textContent = db.empresa.nombre;
  $('#empresa-almacen').textContent = db.empresa.almacen;
  const logo = $('#logo');
  if (db.empresa.logo) logo.innerHTML = `<img src="${esc(db.empresa.logo)}" alt="Logo de ${esc(db.empresa.nombre)}">`;
  else logo.textContent = iniciales(db.empresa.nombre);
  document.title = `Inventario · ${db.empresa.nombre}`;
  const oscuro = temaActual() === 'dark';
  $('#boton-tema').innerHTML = `${icono(oscuro ? 'sol' : 'luna')}<span class="tema-texto">${oscuro ? 'Modo claro' : 'Modo oscuro'}</span>`;
}

function temaActual() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

acciones.tema = () => {
  const nuevo = temaActual() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nuevo;
  try { localStorage.setItem('inventario-tema', nuevo); } catch (e) { /* sin almacenamiento */ }
  pintarMarca();
};
acciones.menu = () => $('#lateral').classList.toggle('abierto');

formularios.buscar = (f) => {
  const q = f.elements.q.value.trim();
  if (!q) return;
  const o = db.ordenes.find((x) => norm(x.numero) === norm(q) || norm(x.numero).replace(/^0+/, '') === norm(q).replace(/^0+/, ''));
  if (o) {
    location.hash = '#orden/' + o.id;
  } else if (db.materiales.some((m) => norm(m.codigo + ' ' + m.descripcion).includes(norm(q)))) {
    filtroStock.texto = q;
    filtroStock.modo = '';
    location.hash === '#stock' ? render() : (location.hash = '#stock');
  } else {
    filtroMov.texto = q;
    location.hash === '#movimientos' ? render() : (location.hash = '#movimientos');
  }
  f.elements.q.value = '';
};

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-accion]');
  if (!b || !acciones[b.dataset.accion]) return;
  ev.preventDefault();
  acciones[b.dataset.accion](b, ev);
});
document.addEventListener('submit', (ev) => {
  const f = ev.target;
  if (!formularios[f.dataset.form]) return;
  ev.preventDefault();
  formularios[f.dataset.form](f);
});

function avisoEn(form, mensaje, tipo = 'error') {
  let p = $('.alerta-form', form);
  if (!p) {
    p = document.createElement('p');
    form.prepend(p);
  }
  p.className = `alerta ${tipo} alerta-form`;
  p.innerHTML = mensaje;
  p.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ---------- Resumen ----------

vistas.resumen = () => {
  const calc = calcular();
  const estados = db.ordenes.map((o) => ({ o, e: estadoOrden(o, calc) }));
  const abiertas = estados.filter(({ e }) => e.estado === 'Pendiente' || e.estado === 'Parcial');
  const valorStock = [...calc.mats.values()].reduce((a, s) => a + Math.max(0, s.valor), 0);
  const bajoMinimo = db.materiales.filter((m) => m.minimo > 0 && (calc.mats.get(m.id)?.stock || 0) < m.minimo);
  const negativos = db.materiales.filter((m) => calc.mats.get(m.id)?.negativo);
  const f = franjaOrdenes(abiertas, calc);
  const sem = semanasPanel(periodoPanel);
  const compraPeriodo = sem.compras.reduce((a, v) => a + v, 0);
  const entregaPeriodo = sem.entregas.reduce((a, v) => a + v, 0);
  const cuenta = (est) => estados.filter(({ e }) => e.estado === est).length;
  const vencidas = estados.filter(({ e }) => e.vencida).length;

  const avance = estados.filter(({ e }) => e.estado !== 'Cerrada')
    .sort((a, b) => (b.o.fecha || '').localeCompare(a.o.fecha || '') || b.o.numero.localeCompare(a.o.numero)).slice(0, 8);
  const topStock = db.materiales.map((m) => ({ m, s: calc.mats.get(m.id) })).filter(({ s }) => s.valor > EPS)
    .sort((a, b) => b.s.valor - a.s.valor).slice(0, 8);

  const segmentos = [
    { nombre: 'Entregado', valor: f.entregado, color: 'var(--s-azul)', tinta: '#ffffff' },
    { nombre: 'Listo en almacén', valor: f.listo, color: 'var(--s-aqua)', tinta: '#0f1a17' },
    { nombre: 'Falta comprar', valor: f.porComprar, color: 'var(--s-naranja)', tinta: '#1d120c' },
  ];
  const totalFranja = f.entregado + f.listo + f.porComprar;

  return `
    <div class="fila"><h1 class="titulo-panel">Panel de almacén</h1><span class="espacio"></span>
      <a class="btn" href="#compra">+ Registrar compra</a>
      <a class="btn primario" href="#nueva-orden">+ Nueva O/C</a></div>
    ${avisoImportacion ? `<p class="alerta ok">${esc(avisoImportacion)} <a href="#movimientos">Ver movimientos</a></p>` : ''}
    ${negativos.length ? `<p class="alerta error">Hay materiales que quedaron con stock negativo en algún momento (${negativos.map((m) => esc(m.codigo)).join(', ')}). Revisa sus kardex: probablemente falta registrar una compra o la fecha de un movimiento está mal.</p>` : ''}
    <div class="fila" style="margin-bottom:12px">
      <label style="display:flex;gap:8px;align-items:center">Periodo
        <select id="periodo-panel" style="width:auto;margin:0">
          ${[[4, 'Últimas 4 semanas'], [8, 'Últimas 8 semanas'], [12, 'Últimas 12 semanas'], [26, 'Últimos 6 meses'], [52, 'Último año']]
            .map(([v, t]) => `<option value="${v}" ${v === periodoPanel ? 'selected' : ''}>${t}</option>`).join('')}
        </select></label>
    </div>
    <div class="panel">
      <div class="kpis">
        <a class="kpi" href="#ordenes"><span class="icono-kpi">${icono('camion')}</span><div><b>${soles(totalFranja - f.entregado)}</b><span>Por entregar · ${abiertas.length} O/C</span></div></a>
        <a class="kpi" href="#stock"><span class="icono-kpi">${icono('caja')}</span><div><b>${soles(valorStock)}</b><span>Valor del stock</span></div></a>
        <a class="kpi" href="#movimientos"><span class="icono-kpi">${icono('tendencia')}</span><div><b>${soles(entregaPeriodo)}</b><span>Entregado en el periodo</span></div></a>
        <a class="kpi" href="#movimientos"><span class="icono-kpi">${icono('dinero')}</span><div><b>${soles(compraPeriodo)}</b><span>Comprado en el periodo</span></div></a>
      </div>
      ${totalFranja > EPS ? `
        <div class="franja" role="img" aria-label="Avance de las O/C abiertas">
          ${segmentos.filter((s) => s.valor > EPS).map((s) => {
            const pct = (s.valor / totalFranja) * 100;
            return `<div style="width:${pct}%;background:${s.color};color:${s.tinta}" ${tipAttr({ t: s.nombre, f: [[soles(s.valor), fmt(pct, 0) + '% de las O/C abiertas', s.color]] })}>
              ${pct >= 14 ? `<small>${s.nombre}</small><b>${soles(s.valor)}</b>` : ''}</div>`;
          }).join('')}
        </div>
        <div class="leyenda">${segmentos.map((s) => `<span><i style="background:${s.color}"></i>${s.nombre}: <b>${soles(s.valor)}</b></span>`).join('')}</div>` : ''}
    </div>

    <div class="rejilla-3">
      <div class="panel">
        <div class="cabecera-grafico"><h2>Avance de entrega por O/C</h2></div>
        ${graficoBarrasH(avance.map(({ o, e }) => ({
          etiqueta: `O/C ${o.numero} · ${o.entidad}`,
          valor: e.avance * 100,
          texto: fmt(e.avance * 100, 0) + '%',
          enlace: '#orden/' + o.id,
          tip: { t: `O/C ${o.numero} · ${e.estado}${e.vencida ? ' · vencida' : ''}`, f: [[soles(e.totalEntregado), 'entregado', 'var(--s-azul)'], [soles(e.total), 'total de la O/C', '']] },
        })), { max: 100 })}
        ${tablaDatos(['O/C', 'Avance', 'Entregado', 'Total'], avance.map(({ o, e }) => [o.numero, fmt(e.avance * 100, 0) + '%', soles(e.totalEntregado), soles(e.total)]))}
      </div>
      <div class="panel">
        <div class="cabecera-grafico"><h2>Materiales con más valor en stock</h2></div>
        ${graficoBarrasH(topStock.map(({ m, s }) => ({
          etiqueta: m.descripcion,
          valor: s.valor,
          texto: soles(s.valor),
          enlace: '#kardex/' + m.id,
          tip: { t: m.descripcion, f: [[soles(s.valor), 'valor', 'var(--s-azul)'], [`${cant(s.stock)} ${m.unidad}`, 'en stock', '']] },
        })))}
        ${topStock.length ? tablaDatos(['Material', 'Stock', 'Valor'], topStock.map(({ m, s }) => [m.descripcion, `${cant(s.stock)} ${m.unidad}`, soles(s.valor)])) : ''}
      </div>
      <div class="panel">
        <div class="cabecera-grafico"><h2>Estado de las órdenes</h2></div>
        <div class="estados">
          <a class="estado-oc" href="#ordenes"><b>${cuenta('Pendiente')}</b><span class="etiqueta e-azul">Pendientes</span></a>
          <a class="estado-oc" href="#ordenes"><b>${cuenta('Parcial')}</b><span class="etiqueta e-ambar">Parciales</span></a>
          <a class="estado-oc" href="#ordenes"><b>${cuenta('Entregada')}</b><span class="etiqueta e-verde">✔ Entregadas</span></a>
          <a class="estado-oc" href="#ordenes"><b>${vencidas}</b><span class="etiqueta e-rojo">⚠ Vencidas</span></a>
        </div>
        ${(() => { const r = resumenPorPagar(); return r.lista.length ? `<a class="estado-oc" href="#facturas" data-accion="ver-por-pagar" style="display:block;margin-top:10px"><b style="font-size:20px">${soles(r.total)}</b><span class="etiqueta ${r.vencidas.length ? 'e-rojo' : 'e-ambar'}">${r.vencidas.length ? '⚠ ' : ''}Por pagar a proveedores · ${r.lista.length} factura(s)</span><br><span class="suave">Próximo vencimiento: ${fechaPe(r.lista.map((f) => f.vence).sort()[0])}</span></a>` : ''; })()}
        <p class="suave" style="margin-bottom:0">${bajoMinimo.length ? `<a href="#stock">${bajoMinimo.length} material(es) bajo su stock mínimo</a> · ` : ''}<a href="#por-comprar">Ver lista por comprar</a></p>
      </div>
    </div>

    <div class="panel">
      <div class="cabecera-grafico"><h2>Compras y entregas por semana</h2><span class="espacio"></span><span class="suave">Soles · compras a costo, entregas a precio de la O/C</span></div>
      ${graficoLineas({
        etiquetas: sem.etiquetas,
        titulos: sem.titulos,
        series: [
          { nombre: 'Entregas', color: 'var(--s-azul)', valores: sem.entregas },
          { nombre: 'Compras', color: 'var(--s-aqua)', valores: sem.compras },
        ],
        formato: soles,
      })}
      <div class="leyenda"><span><i class="linea" style="background:var(--s-azul)"></i>Entregas</span><span><i class="linea" style="background:var(--s-aqua)"></i>Compras</span></div>
      ${tablaDatos(['Semana', 'Entregas', 'Compras'], sem.titulos.map((t, i) => [t, soles(sem.entregas[i]), soles(sem.compras[i])]))}
    </div>

    <div class="panel">
      <h2 class="sin-margen">Órdenes por entregar</h2>
      ${abiertas.length ? tablaOrdenes(abiertas) : '<p class="suave">No hay órdenes pendientes de entrega.</p>'}
    </div>
    <details class="panel">
      <summary>Cómo se usa</summary>
      <ol>
        <li><b>Registra cada O/C</b> que te llega (Órdenes → Nueva O/C). Puedes pegar los ítems o pedirle a Claude que lea el PDF escaneado.</li>
        <li><b>Mira «Por comprar»</b>: te dice qué falta comprar para cumplir las O/C, descontando lo que ya tienes en almacén.</li>
        <li><b>Cuando llegue la compra</b>, regístrala en «Registrar compra» con su factura o boleta y su costo.</li>
        <li><b>Cuando entregues a la entidad</b>, entra a la O/C → «Registrar entrega» con el N° de guía de remisión. La app descuenta el stock, marca lo pendiente e imprime el acta de entrega.</li>
        <li>Si algo regresa al almacén usa <b>Devolución</b>; si el conteo físico no cuadra usa <b>Conteo físico</b> (en Stock). Nada se borra: los errores se anulan con motivo.</li>
      </ol>
    </details>`;
};

let periodoPanel = 12;
document.addEventListener('change', (ev) => {
  if (ev.target.id !== 'periodo-panel') return;
  periodoPanel = Number(ev.target.value);
  render();
});

// Reparte el stock entre las O/C abiertas (de la más antigua a la más nueva) para saber qué ya se puede entregar.
function franjaOrdenes(abiertas, calc) {
  const resto = new Map([...calc.mats].map(([id, s]) => [id, Math.max(0, s.stock)]));
  let entregado = 0;
  let listo = 0;
  let porComprar = 0;
  for (const { o, e } of [...abiertas].sort((a, b) => ordenCrono(a.o, b.o))) {
    entregado += e.totalEntregado;
    for (const it of e.items) {
      const disponible = Math.min(it.pendiente, resto.get(it.materialId) || 0);
      resto.set(it.materialId, (resto.get(it.materialId) || 0) - disponible);
      listo += disponible * it.pu;
      porComprar += (it.pendiente - disponible) * it.pu;
    }
  }
  return { entregado, listo, porComprar };
}

// Suma compras (a costo) y entregas (a precio de la O/C) por semana, de lunes a domingo.
function semanasPanel(n) {
  const lunes = new Date(hoy() + 'T12:00:00');
  lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7) - 7 * (n - 1));
  const inicio = lunes.toISOString().slice(0, 10);
  const etiquetas = [];
  const titulos = [];
  for (let i = 0; i < n; i++) {
    const a = sumarDias(inicio, i * 7);
    const b = sumarDias(a, 6);
    etiquetas.push(a.slice(8, 10) + '/' + a.slice(5, 7));
    titulos.push(`Semana del ${fechaPe(a)} al ${fechaPe(b)}`);
  }
  const compras = new Array(n).fill(0);
  const entregas = new Array(n).fill(0);
  for (const mv of db.movimientos) {
    if (mv.anulado || !mv.fecha || mv.fecha < inicio) continue;
    const i = Math.floor((new Date(mv.fecha + 'T12:00:00') - new Date(inicio + 'T12:00:00')) / (7 * 864e5));
    if (i < 0 || i >= n) continue;
    if (mv.tipo === 'ENTRADA') compras[i] += num(mv.cantidad) * num(mv.costo);
    if ((mv.tipo === 'SALIDA' || mv.tipo === 'DEVOLUCION') && mv.ordenId) {
      const it = orden(mv.ordenId)?.items.find((x) => x.materialId === mv.materialId);
      if (it) entregas[i] += (mv.tipo === 'SALIDA' ? 1 : -1) * num(mv.cantidad) * it.pu;
    }
  }
  return { etiquetas, titulos, compras: compras.map((v) => redondear(v, 2)), entregas: entregas.map((v) => redondear(v, 2)) };
}

function tablaOrdenes(lista) {
  return `<div class="tabla-envoltura"><table>
    <thead><tr><th>O/C</th><th>Fecha</th><th>Entidad / referencia</th><th class="n">Total</th><th class="n">Entregado</th><th>Avance</th><th>Vence (ref.)</th><th>Estado</th></tr></thead>
    <tbody>${lista.map(({ o, e }) => `
      <tr>
        <td><a href="#orden/${o.id}"><b>${esc(o.numero)}</b></a></td>
        <td>${fechaPe(o.fecha)}</td>
        <td>${esc(o.entidad)}<br><span class="suave">${esc(o.referencia)}</span></td>
        <td class="n">${soles(e.total)}</td>
        <td class="n">${soles(e.totalEntregado)}</td>
        <td>${barra(e.avance)}<span class="suave">${fmt(e.avance * 100, 0)}%</span></td>
        <td>${fechaPe(e.vence)}</td>
        <td>${etiquetaEstado(e)}</td>
      </tr>`).join('')}</tbody></table></div>`;
}

// ---------- Órdenes ----------

vistas.ordenes = () => {
  const calc = calcular();
  const lista = [...db.ordenes].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || b.numero.localeCompare(a.numero)).map((o) => ({ o, e: estadoOrden(o, calc) }));
  return `
    <div class="fila"><h1>Órdenes de compra recibidas</h1><span class="espacio"></span>
      <a class="btn primario" href="#nueva-orden">+ Nueva O/C</a></div>
    <div class="panel">${lista.length ? tablaOrdenes(lista) : '<p class="suave">Aún no registras órdenes.</p>'}</div>`;
};

vistas.orden = (id) => {
  const o = orden(id);
  if (!o) return '<p class="alerta error">No se encontró la orden.</p>';
  const calc = calcular();
  const e = estadoOrden(o, calc);
  const movs = db.movimientos.filter((m) => m.ordenId === o.id).sort(ordenCrono);
  const grupos = agruparPorDocumento(movs);
  const margen = e.totalEntregado - e.costo;
  const faltan = e.items.filter((it) => it.faltaComprar > EPS).length;
  const difDeclarado = o.totalDeclarado ? e.total - o.totalDeclarado : 0;

  return `
    <p><a href="#ordenes">← Órdenes</a></p>
    <div class="fila"><h1>O/C N° ${esc(o.numero)} ${etiquetaEstado(e)}</h1><span class="espacio"></span>
      ${e.estado !== 'Entregada' && e.estado !== 'Cerrada' ? `
        <a class="btn" href="#compra/oc/${o.id}">Registrar compra${faltan ? ` (${faltan} por comprar)` : ''}</a>
        <a class="btn primario" href="#entrega/${o.id}">Registrar entrega</a>` : ''}
    </div>
    ${Math.abs(difDeclarado) > 0.05 ? `<p class="alerta aviso">La suma de los ítems (${soles(e.total)}) no coincide con el total de la O/C (${soles(o.totalDeclarado)}). Revisa cantidades y precios.</p>` : ''}
    <div class="panel">
      <div class="campos">
        <div><label>Entidad</label>${esc(o.entidad)} <span class="suave">RUC ${esc(o.rucEntidad)}</span></div>
        <div><label>Fecha O/C · notificación</label>${fechaPe(o.fecha)} · ${fechaPe(o.notificacion || o.fecha)}</div>
        <div><label>Plazo de entrega</label>${esc(o.plazoDias)} días · vence ${fechaPe(e.vence)} (ref.)</div>
        <div><label>Referencia</label>${esc(o.referencia)}</div>
        <div><label>R. SIAF</label>${esc(o.siaf)}</div>
        <div><label>Entregar en</label>${esc(o.enviarA)}</div>
        <div><label>Área usuaria</label>${esc(o.area)}</div>
        <div><label>Meta</label>${esc(o.meta)}</div>
        ${o.obs ? `<div class="ancho"><label>Observaciones</label>${esc(o.obs)}</div>` : ''}
      </div>
    </div>
    <div class="tarjetas">
      <div class="tarjeta"><b>${soles(e.total)}</b><span>total de la O/C</span></div>
      <div class="tarjeta"><b>${soles(e.totalEntregado)}</b><span>entregado (${fmt(e.avance * 100, 0)}%)</span></div>
      <div class="tarjeta"><b>${soles(e.costo)}</b><span>costo de los materiales entregados</span></div>
      <div class="tarjeta"><b class="${margen < 0 ? 'rojo' : 'verde'}">${soles(margen)}</b><span>margen bruto de lo entregado</span></div>
    </div>
    <div class="panel">
      <div class="fila"><h2 style="margin:0">Ítems</h2><span class="espacio"></span>
        <button class="btn chico" data-accion="imprimir-orden" data-id="${o.id}">Imprimir estado</button>
        <button class="btn chico" data-accion="csv-orden" data-id="${o.id}">Excel (CSV)</button></div>
      <div class="tabla-envoltura"><table>
        <thead><tr><th>#</th><th>Descripción</th><th>Und</th><th class="n">Pedido</th><th class="n">Entregado</th><th class="n">Pendiente</th><th class="n">Stock</th><th class="n">Falta comprar</th><th class="n">P. unit.</th><th class="n">Importe</th></tr></thead>
        <tbody>${e.items.map((it, i) => {
          const m = material(it.materialId);
          return `<tr>
            <td>${i + 1}</td>
            <td><a href="#kardex/${it.materialId}">${esc(m?.descripcion)}</a> <span class="suave">${esc(m?.codigo)}</span></td>
            <td>${esc(it.unidad)}</td>
            <td class="n">${cant(it.cant)}</td>
            <td class="n">${cant(it.entregado)}</td>
            <td class="n">${it.pendiente > EPS ? `<b>${cant(it.pendiente)}</b>` : '<span class="verde">✔</span>'}</td>
            <td class="n">${cant(it.stock)}</td>
            <td class="n ${it.faltaComprar > EPS ? 'rojo' : ''}">${it.faltaComprar > EPS ? cant(it.faltaComprar) : '—'}</td>
            <td class="n">${fmt(it.pu, 4)}</td>
            <td class="n">${fmt(it.cant * it.pu)}</td>
          </tr>`;
        }).join('')}</tbody>
        <tfoot><tr><td colspan="9">Total</td><td class="n">${fmt(e.total)}</td></tr></tfoot>
      </table></div>
    </div>
    <div class="panel">
      <h2 style="margin-top:0">Movimientos de esta O/C</h2>
      ${grupos.length ? `<div class="tabla-envoltura"><table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Documento</th><th>Proveedor / recibe</th><th class="n">Ítems</th><th></th></tr></thead>
        <tbody>${grupos.map((g) => `<tr class="${g.anulado ? 'anulado' : ''}">
          <td>${fechaPe(g.fecha)}</td><td>${TIPOS[g.tipo]}</td><td>${g.movs[0].nroCompra ? `<a href="#factura/${g.clave}"><b>${nroCompra(g.movs[0].nroCompra)}</b></a> · ` : ''}${esc(g.documento)}</td><td>${esc(g.tercero)}${g.recibe ? `<br><span class="suave">${esc(g.recibe)}</span>` : ''}</td>
          <td class="n">${g.movs.length}</td>
          <td>${g.tipo === 'SALIDA' && !g.anulado ? `<button class="btn chico" data-accion="imprimir-acta" data-grupo="${g.clave}">Imprimir acta</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="suave">Todavía no hay compras ni entregas registradas para esta O/C.</p>'}
    </div>
    <div class="fila">
      <a class="btn" href="#editar-orden/${o.id}">Editar O/C</a>
      <button class="btn" data-accion="cerrar-orden" data-id="${o.id}">${o.cerrada ? 'Reabrir O/C' : 'Cerrar O/C sin completar'}</button>
      <span class="espacio"></span>
      <button class="btn peligro" data-accion="eliminar-orden" data-id="${o.id}">Eliminar O/C</button>
    </div>`;
};

function agruparPorDocumento(movs) {
  const grupos = new Map();
  for (const m of movs) {
    const clave = m.grupo || m.id;
    if (!grupos.has(clave)) grupos.set(clave, { clave, fecha: m.fecha, tipo: m.tipo, documento: m.documento, tercero: m.tercero, recibe: m.recibe, anulado: true, movs: [] });
    const g = grupos.get(clave);
    g.movs.push(m);
    if (!m.anulado) g.anulado = false;
  }
  return [...grupos.values()];
}

acciones['cerrar-orden'] = (b) => {
  const o = orden(b.dataset.id);
  if (!o.cerrada && !confirm('¿Cerrar esta O/C aunque tenga ítems pendientes? (por ejemplo, si la entidad anuló una parte). Ya no aparecerá en «por entregar» ni en «por comprar».')) return;
  o.cerrada = !o.cerrada;
  guardar();
  render();
};

acciones['eliminar-orden'] = (b) => {
  const o = orden(b.dataset.id);
  if (db.movimientos.some((m) => m.ordenId === o.id && !m.anulado)) {
    alert('Esta O/C tiene compras o entregas registradas. Anula primero esos movimientos (en Movimientos) o usa «Cerrar O/C».');
    return;
  }
  if (!confirm(`¿Eliminar la O/C ${o.numero}? Los materiales se quedan en el catálogo.`)) return;
  db.ordenes = db.ordenes.filter((x) => x.id !== o.id);
  db.movimientos.forEach((m) => { if (m.ordenId === o.id) m.ordenId = ''; });
  guardar();
  location.hash = '#ordenes';
};

// ---------- Nueva / editar O/C ----------

const PEDIDO_CLAUDE = `Transcribe la orden de compra del PDF adjunto. Responde SOLO con un JSON como este, sin texto adicional:
{"numero":"000062","fecha":"2026-09-07","siaf":"552","entidad":"MUNICIPALIDAD ...","rucEntidad":"...","referencia":"REQ. N°...","area":"...","enviarA":"...","meta":"...","plazoDias":3,"totalDeclarado":21663.87,"items":[{"cant":3,"unidad":"UND","descripcion":"...","pu":30}]}
Reglas:
- Incluye TODOS los ítems de TODAS las páginas, en el mismo orden, sin repetir.
- Copia la descripción tal como aparece.
- Números sin separador de miles y con punto decimal.
- "totalDeclarado" es el TOTAL S/. de la orden.
- Si el escaneo está girado o de cabeza, léelo igual.
- Al final verifica que la suma de cant × pu sea igual a totalDeclarado; si no coincide, revisa la transcripción.`;

vistas['nueva-orden'] = () => formOrden(null);
vistas['editar-orden'] = (id) => formOrden(orden(id));

function formOrden(o) {
  const v = o || { numero: '', fecha: hoy(), notificacion: hoy(), plazoDias: 5, entidad: '', rucEntidad: '', referencia: '', siaf: '', area: '', enviarA: '', meta: '', obs: '', totalDeclarado: '', items: [] };
  const items = v.items.map((it) => ({ ...it, descripcion: material(it.materialId)?.descripcion || '' }));
  alMontar = () => {
    const tb = $('#items-orden tbody');
    if (!items.length) for (let i = 0; i < 3; i++) tb.insertAdjacentHTML('beforeend', filaItemOrden({}));
    recalcularOrden();
  };
  const campo = (n, etiqueta, tipo = 'text', extra = '') => `<label>${etiqueta}<input name="${n}" type="${tipo}" value="${esc(v[n])}" ${extra}></label>`;
  return `
    <p><a href="${o ? '#orden/' + o.id : '#ordenes'}">← Volver</a></p>
    <h1>${o ? 'Editar O/C ' + esc(o.numero) : 'Nueva orden de compra recibida'}</h1>
    <form data-form="orden" data-id="${o ? o.id : ''}">
      ${o ? '' : `
      <details class="panel">
        <summary>Leer la O/C escaneada con Claude (recomendado para órdenes largas)</summary>
        <ol>
          <li><button type="button" class="btn chico" data-accion="copiar-pedido">Copiar instrucciones</button></li>
          <li>Abre <a href="https://claude.ai/new" target="_blank" rel="noopener">claude.ai</a>, adjunta el PDF de la O/C y pega las instrucciones.</li>
          <li>Copia la respuesta de Claude y pégala aquí:</li>
        </ol>
        <textarea id="respuesta-claude" placeholder='{"numero":"000064", ... "items":[...]}'></textarea>
        <p><button type="button" class="btn primario" data-accion="cargar-respuesta">Cargar datos</button></p>
      </details>`}
      <div class="panel">
        <div class="campos">
          ${campo('numero', 'N° de O/C *', 'text', 'required')}
          ${campo('fecha', 'Fecha de la O/C', 'date')}
          ${campo('notificacion', 'Fecha de notificación', 'date')}
          ${campo('plazoDias', 'Plazo de entrega (días)', 'number', 'min="0"')}
          ${campo('entidad', 'Entidad / cliente *', 'text', 'required list="dl-entidades"')}
          ${campo('rucEntidad', 'RUC de la entidad')}
          ${campo('referencia', 'Referencia (requerimiento)')}
          ${campo('siaf', 'R. SIAF')}
          ${campo('area', 'Área usuaria')}
          ${campo('enviarA', 'Entregar en')}
          ${campo('meta', 'Meta / obra')}
          ${campo('totalDeclarado', 'Total S/ según la O/C', 'number', 'step="0.01"')}
          <label class="ancho">Observaciones<input name="obs" value="${esc(v.obs)}"></label>
        </div>
        <datalist id="dl-entidades">${[...new Set(db.ordenes.map((x) => x.entidad))].map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      </div>
      <div class="panel">
        <h2 style="margin-top:0">Ítems</h2>
        <div class="tabla-envoltura"><table id="items-orden">
          <thead><tr><th style="width:90px">Cant.</th><th style="width:100px">Unidad</th><th>Descripción</th><th style="width:120px">P. unit.</th><th class="n" style="width:110px">Importe</th><th></th></tr></thead>
          <tbody>${items.map(filaItemOrden).join('')}</tbody>
          <tfoot><tr><td colspan="4">Total <span id="dif-total" class="rojo"></span></td><td class="n" id="total-orden"></td><td></td></tr></tfoot>
        </table></div>
        ${datalistMateriales()}
        <div class="fila" style="margin-top:8px"><button type="button" class="btn" data-accion="agregar-fila-orden">+ Agregar ítem</button></div>
        <details style="margin-top:12px">
          <summary>Pegar varios ítems (desde Excel o copiados del PDF)</summary>
          <p class="suave">Una línea por ítem: <code>cantidad · unidad · descripción · precio unitario</code>, separados por tabulación, «|» o «;». También acepta líneas copiadas de la O/C como <code>2.6.2.3.4 3.00 UND TUBO ... 30.0000 90.00</code>.</p>
          <textarea id="pegar-items"></textarea>
          <p><button type="button" class="btn" data-accion="pegar-items">Agregar estas líneas</button></p>
        </details>
      </div>
      <div class="fila fin"><button class="btn primario">Guardar O/C</button></div>
    </form>`;
}

function datalistMateriales() {
  return `<datalist id="dl-materiales">${db.materiales.map((m) => `<option value="${esc(m.descripcion)}">`).join('')}</datalist>`;
}

function filaItemOrden(it) {
  return `<tr>
    <td><input class="num" name="cant" type="number" step="any" min="0" value="${esc(it.cant ?? '')}"></td>
    <td><input name="unidad" list="dl-unidades" value="${esc(it.unidad || 'UND')}"></td>
    <td><input name="descripcion" list="dl-materiales" value="${esc(it.descripcion || '')}"></td>
    <td><input class="num" name="pu" type="number" step="any" min="0" value="${esc(it.pu ?? '')}"></td>
    <td class="n importe"></td>
    <td><button type="button" class="btn chico peligro" data-accion="quitar-fila" title="Quitar">✕</button></td>
  </tr>`;
}

function recalcularOrden() {
  let total = 0;
  $$('#items-orden tbody tr').forEach((tr) => {
    const imp = num($('[name=cant]', tr).value) * num($('[name=pu]', tr).value);
    total += imp;
    $('.importe', tr).textContent = imp ? fmt(imp) : '';
  });
  $('#total-orden').textContent = fmt(total);
  const decl = num($('[name=totalDeclarado]')?.value);
  $('#dif-total').textContent = decl && Math.abs(decl - total) > 0.05 ? ` · no cuadra con el total de la O/C (${soles(decl)}): diferencia ${soles(total - decl)}` : '';
}

document.addEventListener('input', (ev) => {
  if (ev.target.closest('#items-orden') || ev.target.name === 'totalDeclarado') recalcularOrden();
  if (ev.target.closest('#lineas-compra')) recalcularCompra();
});

acciones['agregar-fila-orden'] = () => $('#items-orden tbody').insertAdjacentHTML('beforeend', filaItemOrden({}));
acciones['quitar-fila'] = (b) => {
  const tabla = b.closest('table');
  b.closest('tr').remove();
  if (tabla.id === 'items-orden') recalcularOrden();
  else recalcularCompra();
};

acciones['copiar-pedido'] = async (b) => {
  try {
    await navigator.clipboard.writeText(PEDIDO_CLAUDE);
    b.textContent = 'Copiado ✔';
  } catch (e) {
    prompt('Copia este texto (Ctrl+C):', PEDIDO_CLAUDE);
  }
};

function agregarItemsAlFormulario(items) {
  const tb = $('#items-orden tbody');
  $$('tr', tb).forEach((tr) => { if (!$('[name=descripcion]', tr).value.trim()) tr.remove(); });
  items.forEach((it) => tb.insertAdjacentHTML('beforeend', filaItemOrden(it)));
  recalcularOrden();
}

acciones['cargar-respuesta'] = () => {
  const texto = $('#respuesta-claude').value;
  const r = interpretarTextoOrden(texto);
  if (!r.items.length) {
    alert('No encontré ítems en el texto. Pega la respuesta completa de Claude (el JSON).');
    return;
  }
  const f = $('form[data-form=orden]');
  for (const [k, val] of Object.entries(r.cabecera)) {
    if (f.elements[k] && val !== undefined && val !== null && val !== '') f.elements[k].value = val;
  }
  if (r.cabecera.fecha && !r.cabecera.notificacion) f.elements.notificacion.value = r.cabecera.fecha;
  agregarItemsAlFormulario(r.items);
  $('#respuesta-claude').closest('details').open = false;
};

acciones['pegar-items'] = () => {
  const r = interpretarTextoOrden($('#pegar-items').value);
  if (!r.items.length) {
    alert('No reconocí ninguna línea. Revisa el formato: cantidad, unidad, descripción y precio unitario.');
    return;
  }
  agregarItemsAlFormulario(r.items);
  $('#pegar-items').value = '';
};

// Acepta el JSON de Claude o líneas de texto (Excel / copiadas del PDF).
function interpretarTextoOrden(texto) {
  const t = String(texto || '').trim();
  const inicio = t.search(/[[{]/);
  if (inicio >= 0) {
    try {
      const fin = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
      const j = JSON.parse(t.slice(inicio, fin + 1));
      const lista = Array.isArray(j) ? j : j.items || [];
      const cabecera = Array.isArray(j) ? {} : { ...j };
      delete cabecera.items;
      return {
        cabecera,
        items: lista.map((x) => ({ cant: num(x.cant ?? x.cantidad), unidad: String(x.unidad || 'UND').toUpperCase(), descripcion: String(x.descripcion || '').trim(), pu: num(x.pu ?? x.precio ?? x.precioUnitario) })).filter((x) => x.descripcion),
      };
    } catch (e) { /* no era JSON: se intenta por líneas */ }
  }
  const items = [];
  for (const linea of t.split(/\r?\n/)) {
    const l = linea.trim();
    if (!l) continue;
    let partes = l.split(/\t|\|| ; |;/).map((p) => p.trim()).filter(Boolean);
    if (partes.length >= 4) {
      if (/^\d+(\.\d+){3,}$/.test(partes[0])) partes = partes.slice(1);
      const [c, u, ...resto] = partes;
      const posiblesNums = resto.filter((p) => /^[\d.,]+$/.test(p));
      const desc = resto.filter((p) => !/^[\d.,]+$/.test(p)).join(' ');
      if (num(c) > 0 && desc) items.push({ cant: num(c), unidad: u.toUpperCase(), descripcion: desc, pu: num(posiblesNums[0]) });
      continue;
    }
    const m = l.match(/^(?:\d+(?:\.\d+){3,}\s+)?([\d.,]+)\s+([A-Za-z0-9]{1,8})\s+(.+?)\s+([\d.,]+)(?:\s+([\d.,]+))?$/);
    if (!m) continue;
    let [, c, u, desc, pu, imp] = m;
    if (imp !== undefined && Math.abs(num(c) * num(pu) - num(imp)) > Math.max(0.05, num(imp) * 0.01)) {
      // El último número era el precio y el anterior era parte de la descripción.
      desc += ' ' + pu;
      pu = imp;
    }
    items.push({ cant: num(c), unidad: u.toUpperCase(), descripcion: desc.trim(), pu: num(pu) });
  }
  return { cabecera: {}, items };
}

formularios.orden = (f) => {
  const id = f.dataset.id;
  const o = id ? orden(id) : null;
  const datos = Object.fromEntries(new FormData(f));
  const filas = $$('#items-orden tbody tr').map((tr) => ({
    cant: num($('[name=cant]', tr).value),
    unidad: $('[name=unidad]', tr).value.trim().toUpperCase() || 'UND',
    descripcion: $('[name=descripcion]', tr).value.trim(),
    pu: num($('[name=pu]', tr).value),
  })).filter((x) => x.descripcion);
  if (!datos.numero.trim() || !datos.entidad.trim()) return avisoEn(f, 'Completa el N° de O/C y la entidad.');
  if (!filas.length) return avisoEn(f, 'Agrega al menos un ítem.');
  if (filas.some((x) => x.cant <= 0)) return avisoEn(f, 'Todos los ítems deben tener cantidad mayor a cero.');
  if (db.ordenes.some((x) => x.id !== id && x.numero.trim() === datos.numero.trim() && norm(x.entidad) === norm(datos.entidad))) {
    return avisoEn(f, `Ya existe la O/C ${esc(datos.numero)} de esa entidad.`);
  }
  const claves = filas.map((x) => norm(x.descripcion));
  if (new Set(claves).size !== claves.length) return avisoEn(f, 'Hay ítems con la misma descripción. Júntalos en una sola línea.');

  if (o) {
    const calc = calcular();
    const perdidos = o.items.filter((it) => (calc.entregado.get(o.id + '|' + it.materialId) || 0) > EPS && !claves.includes(norm(material(it.materialId)?.descripcion)));
    if (perdidos.length) {
      return avisoEn(f, `No puedes quitar ni renombrar ítems que ya tienen entregas: ${perdidos.map((it) => esc(material(it.materialId)?.descripcion)).join('; ')}.`);
    }
  }
  const items = filas.map((x) => ({ materialId: asegurarMaterial(x.descripcion, x.unidad).id, cant: x.cant, unidad: x.unidad, pu: x.pu }));
  const cabecera = {
    numero: datos.numero.trim(), fecha: datos.fecha, notificacion: datos.notificacion || datos.fecha, plazoDias: num(datos.plazoDias),
    entidad: datos.entidad.trim(), rucEntidad: datos.rucEntidad.trim(), referencia: datos.referencia.trim(), siaf: datos.siaf.trim(),
    area: datos.area.trim(), enviarA: datos.enviarA.trim(), meta: datos.meta.trim(), obs: datos.obs.trim(), totalDeclarado: num(datos.totalDeclarado) || '',
  };
  let destino;
  if (o) {
    Object.assign(o, cabecera, { items });
    destino = o.id;
  } else {
    destino = uid();
    db.ordenes.push({ id: destino, ...cabecera, items, creado: Date.now() });
  }
  guardar();
  location.hash = '#orden/' + destino;
};

// ---------- Por comprar ----------

function listaPorComprar(calc) {
  const req = new Map();
  for (const o of db.ordenes) {
    if (o.cerrada) continue;
    const e = estadoOrden(o, calc);
    for (const it of e.items) {
      if (it.pendiente <= EPS) continue;
      const r = req.get(it.materialId) || { materialId: it.materialId, pendiente: 0, ordenes: [] };
      r.pendiente += it.pendiente;
      r.ordenes.push(o.numero);
      req.set(it.materialId, r);
    }
  }
  return [...req.values()].map((r) => {
    const s = calc.mats.get(r.materialId) || { stock: 0, ultimoCosto: 0 };
    return { ...r, stock: s.stock, falta: Math.max(0, redondear(r.pendiente - Math.max(0, s.stock))), ultimoCosto: s.ultimoCosto };
  }).filter((r) => r.falta > EPS).sort((a, b) => material(a.materialId).descripcion.localeCompare(material(b.materialId).descripcion));
}

vistas['por-comprar'] = () => {
  const lista = listaPorComprar(calcular());
  const estimado = lista.reduce((a, r) => a + r.falta * r.ultimoCosto, 0);
  return `
    <div class="fila"><h1>Materiales por comprar</h1><span class="espacio"></span>
      ${lista.length ? `<button class="btn" data-accion="imprimir-por-comprar">Imprimir / PDF</button>
      <button class="btn" data-accion="csv-por-comprar">Excel (CSV)</button>
      <a class="btn primario" href="#compra/faltantes">Registrar compra de estos</a>` : ''}</div>
    <p class="suave">Lo que falta entregar de todas las O/C abiertas, menos lo que ya tienes en almacén.</p>
    <div class="panel">${lista.length ? `<div class="tabla-envoltura"><table>
      <thead><tr><th>Código</th><th>Material</th><th>Und</th><th class="n">Por entregar</th><th class="n">En stock</th><th class="n">Falta comprar</th><th class="n">Último costo</th><th>O/C</th></tr></thead>
      <tbody>${lista.map((r) => {
        const m = material(r.materialId);
        return `<tr><td>${esc(m.codigo)}</td><td><a href="#kardex/${m.id}">${esc(m.descripcion)}</a></td><td>${esc(m.unidad)}</td>
          <td class="n">${cant(r.pendiente)}</td><td class="n">${cant(r.stock)}</td><td class="n"><b>${cant(r.falta)}</b></td>
          <td class="n">${r.ultimoCosto ? fmt(r.ultimoCosto) : '<span class="suave">—</span>'}</td><td>${r.ordenes.map(esc).join(', ')}</td></tr>`;
      }).join('')}</tbody>
      ${estimado ? `<tfoot><tr><td colspan="8">Costo estimado con los últimos precios de compra: ${soles(estimado)}</td></tr></tfoot>` : ''}
    </table></div>` : '<p class="alerta ok">No falta comprar nada: el stock cubre todas las O/C abiertas.</p>'}</div>`;
};

acciones['csv-por-comprar'] = () => {
  const filas = [['Codigo', 'Material', 'Unidad', 'Por entregar', 'En stock', 'Falta comprar', 'Ultimo costo', 'O/C']];
  for (const r of listaPorComprar(calcular())) {
    const m = material(r.materialId);
    filas.push([m.codigo, m.descripcion, m.unidad, r.pendiente, r.stock, r.falta, r.ultimoCosto, r.ordenes.join(' ')]);
  }
  descargarCsv(`por-comprar-${hoy()}.csv`, filas);
};

acciones['imprimir-por-comprar'] = () => {
  const lista = listaPorComprar(calcular());
  imprimir(`${cabeceraImpresion('LISTA DE MATERIALES POR COMPRAR')}
    <table><thead><tr><th>#</th><th>Código</th><th>Material</th><th>Und</th><th>Falta comprar</th><th>O/C</th><th>Precio cotizado</th></tr></thead>
    <tbody>${lista.map((r, i) => {
      const m = material(r.materialId);
      return `<tr><td>${i + 1}</td><td>${esc(m.codigo)}</td><td>${esc(m.descripcion)}</td><td>${esc(m.unidad)}</td><td style="text-align:right">${cant(r.falta)}</td><td>${r.ordenes.map(esc).join(', ')}</td><td></td></tr>`;
    }).join('')}</tbody></table>`);
};

// ---------- Registrar compra (entrada) ----------

vistas.compra = (modo, id) => {
  const calc = calcular();
  let lineas = [];
  let ordenSel = '';
  if (modo === 'oc' && orden(id)) {
    ordenSel = id;
    lineas = estadoOrden(orden(id), calc).items.filter((it) => it.faltaComprar > EPS).map((it) => ({ materialId: it.materialId, cantidad: it.faltaComprar, costo: calc.mats.get(it.materialId)?.ultimoCosto || '' }));
  } else if (modo === 'faltantes') {
    lineas = listaPorComprar(calc).map((r) => ({ materialId: r.materialId, cantidad: r.falta, costo: r.ultimoCosto || '' }));
  }
  alMontar = () => {
    if (!lineas.length) acciones['agregar-linea-compra']();
    recalcularCompra();
  };
  return `
    <h1>Registrar compra (entrada al almacén)</h1>
    <form data-form="compra">
      <div class="panel"><div class="campos">
        <label>Fecha de ingreso<input name="fecha" type="date" value="${hoy()}" required></label>
        <label>Proveedor<input name="tercero" list="dl-proveedores" placeholder="Nombre o RUC"></label>
        <label>Factura / boleta / guía N°<input name="documento" placeholder="F001-123"></label>
        <label>Forma de pago<select name="formaPago"><option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option></select></label>
        <label>Vence (si es crédito)<input name="vence" type="date"></label>
        <label>Para la O/C (opcional)<select name="ordenId"><option value="">— Stock general —</option>
          ${db.ordenes.map((o) => `<option value="${o.id}" ${o.id === ordenSel ? 'selected' : ''}>${esc(o.numero)} · ${esc(o.entidad)}</option>`).join('')}</select></label>
        <label class="ancho">Observaciones<input name="obs"></label>
      </div>
      <datalist id="dl-proveedores">${[...new Set(db.movimientos.filter((m) => m.tipo === 'ENTRADA' && m.tercero).map((m) => m.tercero))].map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      </div>
      <div class="panel">
        <p class="suave" style="margin-top:0">Registra el costo con el mismo criterio que los precios de tus O/C (con IGV o sin IGV) para que el margen sea comparable. Pon en 0 o borra las filas que no llegaron.</p>
        <div class="tabla-envoltura"><table id="lineas-compra">
          <thead><tr><th>Material</th><th style="width:90px">Und</th><th style="width:110px">Cantidad</th><th style="width:120px">Costo unit.</th><th class="n" style="width:110px">Subtotal</th><th></th></tr></thead>
          <tbody>${lineas.map(filaCompra).join('')}</tbody>
          <tfoot><tr><td colspan="4">Total</td><td class="n" id="total-compra"></td><td></td></tr></tfoot>
        </table></div>
        ${datalistMateriales()}
        <p><button type="button" class="btn" data-accion="agregar-linea-compra">+ Agregar material</button></p>
      </div>
      <div class="fila fin"><button class="btn primario">Guardar entrada</button></div>
    </form>`;
};

function filaCompra(l) {
  const m = l.materialId ? material(l.materialId) : null;
  return `<tr>
    <td><input name="descripcion" list="dl-materiales" value="${esc(m?.descripcion || '')}" placeholder="Busca o escribe un material nuevo"></td>
    <td><input name="unidad" list="dl-unidades" value="${esc(m?.unidad || 'UND')}"></td>
    <td><input class="num" name="cantidad" type="number" step="any" min="0" value="${esc(l.cantidad ?? '')}"></td>
    <td><input class="num" name="costo" type="number" step="any" min="0" value="${esc(l.costo ?? '')}"></td>
    <td class="n subtotal"></td>
    <td><button type="button" class="btn chico peligro" data-accion="quitar-fila" title="Quitar">✕</button></td>
  </tr>`;
}

acciones['agregar-linea-compra'] = () => $('#lineas-compra tbody').insertAdjacentHTML('beforeend', filaCompra({}));

function recalcularCompra() {
  let total = 0;
  $$('#lineas-compra tbody tr').forEach((tr) => {
    const st = num($('[name=cantidad]', tr).value) * num($('[name=costo]', tr).value);
    total += st;
    $('.subtotal', tr).textContent = st ? fmt(st) : '';
  });
  $('#total-compra').textContent = fmt(total);
}

// Al elegir un material existente, completa su unidad.
document.addEventListener('change', (ev) => {
  if (ev.target.name !== 'descripcion') return;
  const m = db.materiales.find((x) => norm(x.descripcion) === norm(ev.target.value));
  const u = ev.target.closest('tr')?.querySelector('[name=unidad]');
  if (m && u) u.value = m.unidad;
});

formularios.compra = (f) => {
  const d = Object.fromEntries(new FormData(f));
  const filas = $$('#lineas-compra tbody tr').map((tr) => ({
    descripcion: $('[name=descripcion]', tr).value.trim(),
    unidad: $('[name=unidad]', tr).value.trim().toUpperCase(),
    cantidad: num($('[name=cantidad]', tr).value),
    costo: num($('[name=costo]', tr).value),
  })).filter((x) => x.descripcion && x.cantidad > 0);
  if (!filas.length) return avisoEn(f, 'Agrega al menos un material con cantidad.');
  if (d.formaPago === 'CREDITO' && !d.vence) return avisoEn(f, 'Indica la fecha de vencimiento del crédito.');
  const sinCosto = filas.filter((x) => !x.costo);
  if (sinCosto.length && !confirm(`${sinCosto.length} material(es) no tienen costo. ¿Guardar igual con costo 0?`)) return;
  const nuevos = filas.filter((x) => !db.materiales.some((m) => norm(m.descripcion) === norm(x.descripcion)));
  if (nuevos.length && !confirm(`Se crearán ${nuevos.length} material(es) nuevo(s) en el catálogo:\n\n${nuevos.map((x) => '• ' + x.descripcion).join('\n')}\n\n¿Continuar?`)) return;
  const grupo = uid();
  const ahora = Date.now();
  filas.forEach((x, i) => {
    db.movimientos.push({
      id: uid(), grupo, creado: ahora + i, fecha: d.fecha, tipo: 'ENTRADA', materialId: asegurarMaterial(x.descripcion, x.unidad).id,
      cantidad: x.cantidad, costo: x.costo, ordenId: d.ordenId, documento: d.documento.trim(), tercero: d.tercero.trim(), obs: d.obs.trim(),
      formaPago: d.formaPago, vence: d.formaPago === 'CREDITO' ? d.vence : '',
    });
  });
  guardar();
  location.hash = '#factura/' + grupo;
};

// ---------- Facturas de compra (numeradas) ----------

function facturasDeCompra() {
  const grupos = agruparPorDocumento(db.movimientos.filter((m) => m.tipo === 'ENTRADA'));
  return grupos.map((g) => ({
    ...g,
    nro: g.movs[0].nroCompra || 0,
    total: g.movs.reduce((a, m) => a + num(m.cantidad) * num(m.costo), 0),
    ordenes: [...new Set(g.movs.map((m) => orden(m.ordenId)?.numero).filter(Boolean))],
    vence: g.movs[0].vence || '',
    pago: (db.pagos || {})[g.clave] || null,
  })).sort((a, b) => b.nro - a.nro);
}

const filtroFacturas = { texto: '', anuladas: false, porPagar: false };

// Una factura al crédito está por pagar hasta que se marca como pagada.
const porPagar = (f) => !f.anulado && f.vence && !f.pago;

function etiquetaPago(f) {
  if (!f.vence) return '<span class="suave">Contado</span>';
  if (f.pago) return `<span class="etiqueta e-verde">✔ Pagada ${fechaPe(f.pago.fecha)}</span>`;
  const vencida = f.vence < hoy();
  return `<span class="etiqueta ${vencida ? 'e-rojo' : 'e-ambar'}">${vencida ? '⚠ Vencida' : 'Por pagar'} · ${fechaPe(f.vence)}</span>`;
}

function resumenPorPagar() {
  const lista = facturasDeCompra().filter(porPagar);
  return { lista, total: lista.reduce((a, f) => a + f.total, 0), vencidas: lista.filter((f) => f.vence < hoy()) };
}

vistas.facturas = () => {
  alMontar = pintarFacturas;
  return `
    <div class="fila"><h1>Facturas de compra</h1><span class="espacio"></span>
      <button class="btn" data-accion="csv-facturas">Excel (CSV)</button>
      <button class="btn" data-accion="imprimir-facturas">Imprimir registro</button>
      <a class="btn primario" href="#compra">+ Registrar compra</a></div>
    <p class="suave">Cada factura recibe un N° correlativo de compra (C-0001, C-0002…) en orden de fecha. El número no cambia aunque la factura se anule.</p>
    <div class="panel"><div class="campos" id="filtros-facturas">
      <label>Buscar<input data-ff="texto" value="${esc(filtroFacturas.texto)}" placeholder="N° de compra, comprobante, proveedor, material…"></label>
      <label><input type="checkbox" data-ff="porPagar" ${filtroFacturas.porPagar ? 'checked' : ''} style="width:auto"> Solo por pagar</label>
      <label><input type="checkbox" data-ff="anuladas" ${filtroFacturas.anuladas ? 'checked' : ''} style="width:auto"> Mostrar anuladas</label>
    </div></div>
    ${(() => { const r = resumenPorPagar(); return r.lista.length ? `<p class="alerta ${r.vencidas.length ? 'error' : 'aviso'}">Por pagar: <b>${soles(r.total)}</b> en ${r.lista.length} factura(s) al crédito${r.vencidas.length ? ` · <b>${r.vencidas.length} vencida(s)</b>` : ''}. Próximo vencimiento: ${fechaPe(r.lista.map((f) => f.vence).sort()[0])}.</p>` : ''; })()}
    <div class="panel" id="lista-facturas"></div>`;
};

document.addEventListener('input', (ev) => {
  const k = ev.target.dataset?.ff;
  if (!k) return;
  filtroFacturas[k] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
  pintarFacturas();
});

function facturasFiltradas() {
  const t = norm(filtroFacturas.texto);
  return facturasDeCompra().filter((f) => {
    if (f.anulado && !filtroFacturas.anuladas) return false;
    if (filtroFacturas.porPagar && !porPagar(f)) return false;
    if (!t) return true;
    return norm([nroCompra(f.nro), f.nro, f.documento, f.tercero, f.ordenes.join(' '), ...f.movs.map((m) => material(m.materialId)?.descripcion)].join(' ')).includes(t);
  });
}

function pintarFacturas() {
  const cont = $('#lista-facturas');
  if (!cont) return;
  const lista = facturasFiltradas();
  const total = lista.filter((f) => !f.anulado).reduce((a, f) => a + f.total, 0);
  cont.innerHTML = lista.length ? `<div class="tabla-envoltura"><table>
    <thead><tr><th>N° compra</th><th>Fecha</th><th>Comprobante</th><th>Proveedor</th><th class="n">Ítems</th><th class="n">Total</th><th>Pago</th><th>O/C</th></tr></thead>
    <tbody>${lista.map((f) => `<tr class="${f.anulado ? 'anulado' : ''}">
      <td><a href="#factura/${f.clave}"><b>${nroCompra(f.nro)}</b></a></td>
      <td style="white-space:nowrap">${fechaPe(f.fecha)}</td><td style="white-space:nowrap">${esc(f.documento) || '<span class="suave">—</span>'}</td><td>${esc(f.tercero)}</td>
      <td class="n">${f.movs.length}</td><td class="n">${soles(f.total)}</td>
      <td>${etiquetaPago(f)}</td>
      <td>${f.ordenes.map(esc).join(', ') || '<span class="suave">Stock general</span>'}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="5">${lista.filter((f) => !f.anulado).length} factura(s)</td><td class="n">${soles(total)}</td>
      <td colspan="2">${lista.some(porPagar) ? `Por pagar: ${soles(lista.filter(porPagar).reduce((a, f) => a + f.total, 0))}` : ''}</td></tr></tfoot>
  </table></div>` : '<p class="suave">No hay facturas con ese filtro.</p>';
}

acciones['csv-facturas'] = () => {
  const filas = [['N compra', 'Fecha', 'Comprobante', 'Proveedor', 'Items', 'Total', 'Forma de pago', 'Vence', 'Pagada el', 'O/C', 'Anulada']];
  for (const f of facturasFiltradas()) filas.push([nroCompra(f.nro), f.fecha, f.documento, f.tercero, f.movs.length, redondear(f.total, 2), f.vence ? 'CREDITO' : 'CONTADO', f.vence, f.pago?.fecha || '', f.ordenes.join(' '), f.anulado ? 'SI' : '']);
  descargarCsv(`facturas-de-compra-${hoy()}.csv`, filas);
};

acciones['imprimir-facturas'] = () => {
  const lista = facturasFiltradas().filter((f) => !f.anulado).reverse();
  imprimir(`${cabeceraImpresion('REGISTRO DE FACTURAS DE COMPRA')}
    <table><thead><tr><th>N° compra</th><th>Fecha</th><th>Comprobante</th><th>Proveedor</th><th>Total S/</th></tr></thead>
    <tbody>${lista.map((f) => `<tr><td>${nroCompra(f.nro)}</td><td>${fechaPe(f.fecha)}</td><td>${esc(f.documento)}</td><td>${esc(f.tercero)}</td><td style="text-align:right">${fmt(f.total)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="4">Total</td><td style="text-align:right">${fmt(lista.reduce((a, f) => a + f.total, 0))}</td></tr></tfoot></table>`);
};

vistas.factura = (clave) => {
  const f = facturasDeCompra().find((x) => x.clave === clave);
  if (!f) return '<p class="alerta error">No se encontró la factura.</p>';
  return `
    <p><a href="#facturas">← Facturas de compra</a></p>
    <div class="fila"><h1>Compra ${nroCompra(f.nro)} ${f.anulado ? '<span class="etiqueta e-rojo">Anulada</span>' : ''}</h1><span class="espacio"></span>
      ${f.anulado ? '' : f.ordenes.map((n) => { const o = db.ordenes.find((x) => x.numero === n); return o && !o.cerrada ? `<a class="btn primario" href="#entrega/${o.id}">Registrar entrega O/C ${esc(n)}</a>` : ''; }).join('')}
      <button class="btn" data-accion="imprimir-factura" data-clave="${esc(f.clave)}">Imprimir</button>
      ${f.anulado ? '' : `<button class="btn peligro" data-accion="anular-factura" data-clave="${esc(f.clave)}">Anular factura</button>`}</div>
    <div class="panel"><div class="campos">
      <div><label>Comprobante</label><b>${esc(f.documento) || '—'}</b></div>
      <div><label>Fecha</label>${fechaPe(f.fecha)}</div>
      <div class="ancho"><label>Proveedor</label>${esc(f.tercero) || '—'}</div>
      <div><label>O/C</label>${f.ordenes.length ? f.ordenes.map((n) => { const o = db.ordenes.find((x) => x.numero === n); return `<a href="#orden/${o.id}">${esc(n)}</a>`; }).join(', ') : 'Stock general'}</div>
      <div><label>Total</label><b>${soles(f.total)}</b></div>
      <div><label>Pago</label>${etiquetaPago(f)}${f.pago?.obs ? `<br><span class="suave">${esc(f.pago.obs)}</span>` : ''}
        ${f.vence && !f.anulado ? `<br><button class="btn chico" style="margin-top:6px" data-accion="${f.pago ? 'desmarcar-pago' : 'marcar-pago'}" data-clave="${esc(f.clave)}">${f.pago ? 'Quitar marca de pagada' : 'Marcar como pagada'}</button>` : ''}</div>
    </div></div>
    <div class="panel"><div class="tabla-envoltura"><table>
      <thead><tr><th>#</th><th>Material</th><th class="n">Cantidad</th><th>Und</th><th class="n">Costo unit.</th><th class="n">Subtotal</th><th>Observación</th></tr></thead>
      <tbody>${f.movs.map((m, i) => { const mat = material(m.materialId); return `<tr class="${m.anulado ? 'anulado' : ''}">
        <td>${i + 1}</td><td><a href="#kardex/${m.materialId}">${esc(mat?.descripcion)}</a></td><td class="n">${cant(m.cantidad)}</td><td>${esc(mat?.unidad)}</td>
        <td class="n">${fmt(m.costo, m.costo % 0.01 ? 4 : 2)}</td><td class="n">${fmt(num(m.cantidad) * num(m.costo))}</td><td class="suave">${esc(m.obs)}${m.anulado ? `<br><span class="rojo">Anulado: ${esc(m.motivoAnulacion)}</span>` : ''}</td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td colspan="5">Total</td><td class="n">${fmt(f.total)}</td><td></td></tr></tfoot>
    </table></div></div>`;
};

acciones['imprimir-factura'] = (b) => {
  const f = facturasDeCompra().find((x) => x.clave === b.dataset.clave);
  imprimir(`${cabeceraImpresion(`REGISTRO DE COMPRA ${nroCompra(f.nro)}`)}
    <p><b>Comprobante:</b> ${esc(f.documento)} · <b>Fecha:</b> ${fechaPe(f.fecha)}<br><b>Proveedor:</b> ${esc(f.tercero)}${f.ordenes.length ? ` · <b>O/C:</b> ${f.ordenes.map(esc).join(', ')}` : ''}</p>
    <table><thead><tr><th>#</th><th>Material</th><th>Cant.</th><th>Und</th><th>Costo unit.</th><th>Subtotal</th></tr></thead>
    <tbody>${f.movs.filter((m) => !m.anulado).map((m, i) => { const mat = material(m.materialId); return `<tr><td>${i + 1}</td><td>${esc(mat?.descripcion)}</td><td style="text-align:right">${cant(m.cantidad)}</td><td>${esc(mat?.unidad)}</td><td style="text-align:right">${fmt(m.costo, 4)}</td><td style="text-align:right">${fmt(num(m.cantidad) * num(m.costo))}</td></tr>`; }).join('')}</tbody>
    <tfoot><tr><td colspan="5">Total</td><td style="text-align:right">${fmt(f.total)}</td></tr></tfoot></table>
    <div class="firmas"><div>Recibí conforme (almacén)</div><div>V° B°</div></div>`);
};

acciones['ver-por-pagar'] = () => {
  filtroFacturas.porPagar = true;
  location.hash = '#facturas';
};

acciones['marcar-pago'] = (b) => {
  const fecha = prompt('Fecha de pago (AAAA-MM-DD):', hoy());
  if (!fecha) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha.trim())) return alert('Escribe la fecha como AAAA-MM-DD, por ejemplo ' + hoy());
  const obs = prompt('Medio de pago u observación (opcional): transferencia, N° de operación…', '') || '';
  db.pagos = db.pagos || {};
  db.pagos[b.dataset.clave] = { fecha: fecha.trim(), obs: obs.trim() };
  guardar();
  render();
};

acciones['desmarcar-pago'] = (b) => {
  if (!confirm('¿Quitar la marca de pagada? La factura vuelve a «por pagar».')) return;
  delete db.pagos[b.dataset.clave];
  guardar();
  render();
};

acciones['anular-factura'] = (b) => {
  const f = facturasDeCompra().find((x) => x.clave === b.dataset.clave);
  const motivo = prompt(`Anular la compra ${nroCompra(f.nro)} (${f.documento}) completa.\n\nSus ${f.movs.length} ítems salen del stock, pero la factura queda en la lista, tachada, con su número.\nEscribe el motivo:`);
  if (!motivo || !motivo.trim()) return;
  const ids = new Set(f.movs.map((m) => m.id));
  const prueba = db.movimientos.map((x) => (ids.has(x.id) ? { ...x, anulado: true } : x));
  const antes = new Set(materialesEnNegativo(db.movimientos).map((m) => m.id));
  const neg = materialesEnNegativo(prueba).filter((m) => !antes.has(m.id));
  if (neg.length) {
    alert(`No se puede anular: ya se entregó parte de estos materiales y el stock quedaría negativo:\n\n${neg.map((m) => '• ' + m.descripcion).join('\n')}\n\nAnula primero esas entregas.`);
    return;
  }
  f.movs.forEach((m) => { if (!m.anulado) Object.assign(m, { anulado: true, motivoAnulacion: motivo.trim(), fechaAnulacion: hoy() }); });
  guardar();
  render();
};

// ---------- Registrar entrega (salida contra O/C) ----------

vistas.entrega = (id) => {
  const o = orden(id);
  if (!o) return '<p class="alerta error">No se encontró la orden.</p>';
  const e = estadoOrden(o, calcular());
  const pendientes = e.items.filter((it) => it.pendiente > EPS);
  return `
    <p><a href="#orden/${o.id}">← O/C ${esc(o.numero)}</a></p>
    <h1>Registrar entrega · O/C ${esc(o.numero)}</h1>
    <form data-form="entrega" data-id="${o.id}">
      <div class="panel"><div class="campos">
        <label>Fecha de entrega<input name="fecha" type="date" value="${hoy()}" required></label>
        <label>Guía de remisión N°<input name="documento" placeholder="T001-000123"></label>
        <label>Entregado en<input name="lugar" value="${esc(o.enviarA)}"></label>
        <label>Recibido por (nombre y cargo)<input name="recibe"></label>
        <label class="ancho">Observaciones<input name="obs"></label>
      </div></div>
      <div class="panel">
        ${pendientes.length ? `
        <div class="fila" style="margin-bottom:8px"><button type="button" class="btn chico" data-accion="entrega-todo">Entregar todo lo disponible</button>
          <button type="button" class="btn chico" data-accion="entrega-nada">Poner todo en 0</button></div>
        <div class="tabla-envoltura"><table>
          <thead><tr><th>Material</th><th>Und</th><th class="n">Pendiente</th><th class="n">Stock</th><th style="width:120px">Entregar ahora</th></tr></thead>
          <tbody>${pendientes.map((it) => {
            const disp = Math.max(0, Math.min(it.pendiente, it.stock));
            return `<tr>
              <td>${esc(material(it.materialId)?.descripcion)}</td><td>${esc(it.unidad)}</td>
              <td class="n">${cant(it.pendiente)}</td><td class="n ${it.stock < it.pendiente ? 'rojo' : ''}">${cant(it.stock)}</td>
              <td><input class="num" type="number" step="any" min="0" max="${it.pendiente}" name="m_${it.materialId}" value="${redondear(disp)}" data-disp="${redondear(disp)}"></td>
            </tr>`;
          }).join('')}</tbody></table></div>
        <p class="suave">Solo puedes entregar lo que tienes en stock. Si te falta algo, registra primero la compra.</p>` : '<p class="alerta ok">Esta O/C ya está entregada completa.</p>'}
      </div>
      ${pendientes.length ? '<div class="fila fin"><button class="btn primario">Guardar entrega e imprimir acta</button></div>' : ''}
    </form>`;
};

acciones['entrega-todo'] = () => $$('input[data-disp]').forEach((i) => { i.value = i.dataset.disp; });
acciones['entrega-nada'] = () => $$('input[data-disp]').forEach((i) => { i.value = 0; });

formularios.entrega = (f) => {
  const o = orden(f.dataset.id);
  const d = Object.fromEntries(new FormData(f));
  const e = estadoOrden(o, calcular());
  const grupo = uid();
  const ahora = Date.now();
  const nuevos = [];
  for (const it of e.items) {
    const c = num(d['m_' + it.materialId]);
    if (c <= 0) continue;
    if (c > it.pendiente + EPS) return avisoEn(f, `«${esc(material(it.materialId).descripcion)}»: estás entregando ${cant(c)} y solo quedan ${cant(it.pendiente)} pendientes.`);
    nuevos.push({
      id: uid(), grupo, creado: ahora + nuevos.length, fecha: d.fecha, tipo: 'SALIDA', materialId: it.materialId, cantidad: c, costo: 0,
      ordenId: o.id, documento: d.documento.trim(), tercero: o.entidad, recibe: d.recibe.trim(), lugar: d.lugar.trim(), obs: d.obs.trim(),
    });
  }
  if (!nuevos.length) return avisoEn(f, 'Indica al menos una cantidad a entregar.');
  const neg = materialesEnNegativo([...db.movimientos, ...nuevos]).filter((m) => nuevos.some((n) => n.materialId === m.id));
  if (neg.length) return avisoEn(f, `No alcanza el stock (a la fecha ${fechaPe(d.fecha)}) de: ${neg.map((m) => esc(m.descripcion)).join('; ')}. Registra primero la compra o revisa la fecha.`);
  db.movimientos.push(...nuevos);
  guardar();
  location.hash = '#orden/' + o.id;
  setTimeout(() => imprimirActa(grupo), 300);
};

// ---------- Movimiento individual (devolución, ajuste, salida suelta) ----------

vistas['nuevo-mov'] = (tipoInicial = 'DEVOLUCION', materialId = '') => {
  alMontar = () => cambiarTipoMov();
  return `
    <p><a href="#movimientos">← Movimientos</a></p>
    <h1>Registrar movimiento</h1>
    <form data-form="mov" class="panel">
      <div class="campos">
        <label>Tipo<select name="tipo" id="tipo-mov">
          ${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}" ${k === tipoInicial ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Fecha<input name="fecha" type="date" value="${hoy()}" required></label>
        <label class="ancho">Material<input name="descripcion" list="dl-materiales" value="${esc(material(materialId)?.descripcion || '')}" required></label>
        <label data-solo="AJUSTE">Sentido<select name="sentido"><option value="-1">Restar (faltante, merma, rotura)</option><option value="1">Sumar (sobrante)</option></select></label>
        <label>Cantidad<input name="cantidad" type="number" step="any" min="0" required></label>
        <label data-solo="ENTRADA">Costo unitario<input name="costo" type="number" step="any" min="0"></label>
        <label data-solo="ENTRADA">Unidad (si es material nuevo)<input name="unidad" list="dl-unidades" value="UND"></label>
        <label data-solo="SALIDA DEVOLUCION ENTRADA">O/C<select name="ordenId"><option value="">— Ninguna —</option>
          ${db.ordenes.map((o) => `<option value="${o.id}">${esc(o.numero)} · ${esc(o.entidad)}</option>`).join('')}</select></label>
        <label>Documento<input name="documento" placeholder="Guía, factura, vale…"></label>
        <label>Proveedor / quién recibe o devuelve<input name="tercero"></label>
        <label class="ancho">Motivo u observación<input name="obs"></label>
      </div>
      ${datalistMateriales()}
      <p class="suave">Devolución: material que regresa al almacén (se descuenta de lo entregado en la O/C). Salida sin O/C: consumo propio o préstamo.</p>
      <div class="fila fin"><button class="btn primario">Guardar</button></div>
    </form>`;
};

function cambiarTipoMov() {
  const t = $('#tipo-mov').value;
  $$('[data-solo]').forEach((el) => { el.hidden = !el.dataset.solo.split(' ').includes(t); });
}
document.addEventListener('change', (ev) => { if (ev.target.id === 'tipo-mov') cambiarTipoMov(); });

formularios.mov = (f) => {
  const d = Object.fromEntries(new FormData(f));
  const c = num(d.cantidad);
  if (c <= 0) return avisoEn(f, 'La cantidad debe ser mayor a cero.');
  let m = db.materiales.find((x) => norm(x.descripcion) === norm(d.descripcion));
  if (!m) {
    if (d.tipo !== 'ENTRADA') return avisoEn(f, 'Ese material no existe en el catálogo. Elige uno de la lista.');
    if (!confirm(`Se creará el material nuevo «${d.descripcion.trim()}». ¿Continuar?`)) return;
    m = asegurarMaterial(d.descripcion, d.unidad);
  }
  if (d.tipo === 'AJUSTE' && !d.obs.trim()) return avisoEn(f, 'Anota el motivo del ajuste.');
  const ordenId = ['SALIDA', 'DEVOLUCION', 'ENTRADA'].includes(d.tipo) ? d.ordenId : '';
  if (d.tipo === 'DEVOLUCION' && ordenId) {
    const ent = calcular().entregado.get(ordenId + '|' + m.id) || 0;
    if (c > ent + EPS) return avisoEn(f, `En esa O/C solo se entregaron ${cant(ent)} de este material.`);
  }
  if (d.tipo === 'SALIDA' && ordenId) {
    const o = orden(ordenId);
    const it = estadoOrden(o, calcular()).items.find((x) => x.materialId === m.id);
    if (!it) return avisoEn(f, 'Ese material no está en la O/C elegida.');
    if (c > it.pendiente + EPS) return avisoEn(f, `En esa O/C solo quedan ${cant(it.pendiente)} pendientes de este material.`);
  }
  const mov = {
    id: uid(), creado: Date.now(), fecha: d.fecha, tipo: d.tipo, materialId: m.id,
    cantidad: d.tipo === 'AJUSTE' ? c * num(d.sentido) : c, costo: d.tipo === 'ENTRADA' ? num(d.costo) : 0,
    ordenId, documento: d.documento.trim(), tercero: d.tercero.trim(), obs: d.obs.trim(),
  };
  if (materialesEnNegativo([...db.movimientos, mov]).some((x) => x.id === m.id)) {
    return avisoEn(f, `No alcanza el stock de este material a la fecha ${fechaPe(d.fecha)}.`);
  }
  db.movimientos.push(mov);
  guardar();
  location.hash = '#kardex/' + m.id;
};

// ---------- Movimientos ----------

const filtroMov = { tipo: '', ordenId: '', texto: '', desde: '', hasta: '', anulados: false };

vistas.movimientos = () => {
  alMontar = pintarMovimientos;
  return `
    <div class="fila"><h1>Movimientos</h1><span class="espacio"></span>
      <a class="btn" href="#nuevo-mov/DEVOLUCION">Devolución / ajuste / otro</a>
      <a class="btn primario" href="#compra">Registrar compra</a></div>
    <div class="panel"><div class="campos" id="filtros-mov">
      <label>Tipo<select data-f="tipo"><option value="">Todos</option>${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}" ${filtroMov.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>O/C<select data-f="ordenId"><option value="">Todas</option>${db.ordenes.map((o) => `<option value="${o.id}" ${filtroMov.ordenId === o.id ? 'selected' : ''}>${esc(o.numero)}</option>`).join('')}</select></label>
      <label>Buscar<input data-f="texto" value="${esc(filtroMov.texto)}" placeholder="material, documento, proveedor…"></label>
      <label>Desde<input type="date" data-f="desde" value="${filtroMov.desde}"></label>
      <label>Hasta<input type="date" data-f="hasta" value="${filtroMov.hasta}"></label>
      <label><input type="checkbox" data-f="anulados" ${filtroMov.anulados ? 'checked' : ''} style="width:auto"> Mostrar anulados</label>
    </div>
    <p><button class="btn chico" data-accion="csv-movimientos">Excel (CSV) de lo filtrado</button></p></div>
    <div class="panel" id="lista-mov"></div>`;
};

document.addEventListener('input', (ev) => {
  const k = ev.target.dataset?.f;
  if (!k || !ev.target.closest('#filtros-mov')) return;
  filtroMov[k] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
  pintarMovimientos();
});

function movimientosFiltrados() {
  const t = norm(filtroMov.texto);
  return db.movimientos.filter((mv) => {
    if (mv.anulado && !filtroMov.anulados) return false;
    if (filtroMov.tipo && mv.tipo !== filtroMov.tipo) return false;
    if (filtroMov.ordenId && mv.ordenId !== filtroMov.ordenId) return false;
    if (filtroMov.desde && mv.fecha < filtroMov.desde) return false;
    if (filtroMov.hasta && mv.fecha > filtroMov.hasta) return false;
    if (t) {
      const m = material(mv.materialId);
      const heno = norm([m?.descripcion, m?.codigo, mv.documento, mv.tercero, mv.obs, mv.recibe, orden(mv.ordenId)?.numero].join(' '));
      if (!heno.includes(t)) return false;
    }
    return true;
  }).sort((a, b) => -ordenCrono(a, b));
}

function signo(mv) {
  const c = num(mv.cantidad);
  return mv.tipo === 'SALIDA' ? -c : c;
}

function pintarMovimientos() {
  const cont = $('#lista-mov');
  if (!cont) return;
  const calc = calcular();
  const lista = movimientosFiltrados();
  cont.innerHTML = lista.length ? `<div class="tabla-envoltura"><table>
    <thead><tr><th>Fecha</th><th>Tipo</th><th>Material</th><th class="n">Cantidad</th><th class="n">Costo u.</th><th>O/C</th><th>Documento</th><th>Proveedor / entidad</th><th>Obs.</th><th></th></tr></thead>
    <tbody>${lista.slice(0, 500).map((mv) => {
      const m = material(mv.materialId);
      const s = signo(mv);
      return `<tr class="${mv.anulado ? 'anulado' : ''}">
        <td>${fechaPe(mv.fecha)}</td><td>${etiquetaTipo(mv.tipo)}</td>
        <td><a href="#kardex/${mv.materialId}">${esc(m?.descripcion)}</a></td>
        <td class="n ${s < 0 ? 'rojo' : 'verde'}">${s > 0 ? '+' : ''}${cant(s)} ${esc(m?.unidad)}</td>
        <td class="n">${fmt(mv.tipo === 'ENTRADA' ? mv.costo : calc.costoMov.get(mv.id) || 0)}</td>
        <td>${mv.ordenId && orden(mv.ordenId) ? `<a href="#orden/${mv.ordenId}">${esc(orden(mv.ordenId).numero)}</a>` : ''}</td>
        <td>${mv.nroCompra ? `<a href="#factura/${mv.grupo || mv.id}"><b>${nroCompra(mv.nroCompra)}</b></a> · ` : ''}${esc(mv.documento)}</td><td>${esc(mv.tercero)}</td>
        <td>${esc(mv.obs)}${mv.anulado ? `<br><span class="rojo">Anulado: ${esc(mv.motivoAnulacion)}</span>` : ''}</td>
        <td>${mv.anulado ? '' : `<button class="btn chico peligro" data-accion="anular" data-id="${mv.id}">Anular</button>`}</td>
      </tr>`;
    }).join('')}</tbody></table></div>${lista.length > 500 ? '<p class="suave">Se muestran los 500 más recientes. Usa los filtros.</p>' : ''}`
    : '<p class="suave">No hay movimientos con esos filtros.</p>';
}

function etiquetaTipo(t) {
  const c = { ENTRADA: 'e-verde', SALIDA: 'e-azul', DEVOLUCION: 'e-ambar', AJUSTE: 'e-rojo' }[t];
  return `<span class="etiqueta ${c}">${{ ENTRADA: 'Entrada', SALIDA: 'Salida', DEVOLUCION: 'Devolución', AJUSTE: 'Ajuste' }[t]}</span>`;
}

acciones.anular = (b) => {
  const mv = db.movimientos.find((x) => x.id === b.dataset.id);
  const m = material(mv.materialId);
  const motivo = prompt(`Anular ${TIPOS[mv.tipo].toLowerCase()} de ${cant(Math.abs(mv.cantidad))} ${m.unidad} de «${m.descripcion}».\n\nEl movimiento no se borra: queda tachado con el motivo.\nEscribe el motivo:`);
  if (!motivo || !motivo.trim()) return;
  const prueba = db.movimientos.map((x) => (x.id === mv.id ? { ...x, anulado: true } : x));
  if (materialesEnNegativo(prueba).some((x) => x.id === m.id) && !materialesEnNegativo(db.movimientos).some((x) => x.id === m.id)) {
    alert('No se puede anular: el stock de este material quedaría negativo porque ya se entregó. Anula primero las salidas posteriores.');
    return;
  }
  mv.anulado = true;
  mv.motivoAnulacion = motivo.trim();
  mv.fechaAnulacion = hoy();
  guardar();
  pintarMovimientos();
};

acciones['csv-movimientos'] = () => {
  const calc = calcular();
  const filas = [['Fecha', 'Tipo', 'Codigo', 'Material', 'Unidad', 'Cantidad', 'Costo unitario', 'Valor', 'O/C', 'N compra', 'Documento', 'Proveedor/Entidad', 'Recibe', 'Observacion', 'Anulado']];
  for (const mv of movimientosFiltrados()) {
    const m = material(mv.materialId);
    const cu = mv.tipo === 'ENTRADA' ? num(mv.costo) : calc.costoMov.get(mv.id) || 0;
    filas.push([mv.fecha, mv.tipo, m?.codigo, m?.descripcion, m?.unidad, signo(mv), redondear(cu), redondear(signo(mv) * cu, 2), orden(mv.ordenId)?.numero || '', nroCompra(mv.nroCompra), mv.documento, mv.tercero, mv.recibe || '', mv.obs, mv.anulado ? 'SI: ' + (mv.motivoAnulacion || '') : '']);
  }
  descargarCsv(`movimientos-${hoy()}.csv`, filas);
};

// ---------- Stock ----------

const filtroStock = { texto: '', modo: '' };

vistas.stock = () => {
  alMontar = pintarStock;
  return `
    <div class="fila"><h1>Stock del almacén</h1><span class="espacio"></span>
      <a class="btn" href="#conteo">Conteo físico</a>
      <a class="btn" href="#material">+ Material</a>
      <button class="btn" data-accion="csv-stock">Excel (CSV)</button>
      <button class="btn" data-accion="imprimir-stock">Imprimir</button></div>
    <div class="panel"><div class="campos" id="filtros-stock">
      <label>Buscar<input data-s="texto" value="${esc(filtroStock.texto)}" placeholder="código o descripción"></label>
      <label>Mostrar<select data-s="modo">
        <option value="">Todos los materiales</option>
        <option value="con" ${filtroStock.modo === 'con' ? 'selected' : ''}>Solo con stock</option>
        <option value="bajo" ${filtroStock.modo === 'bajo' ? 'selected' : ''}>Bajo el mínimo</option></select></label>
    </div></div>
    <div class="panel" id="lista-stock"></div>`;
};

document.addEventListener('input', (ev) => {
  const k = ev.target.dataset?.s;
  if (!k || !ev.target.closest('#filtros-stock')) return;
  filtroStock[k] = ev.target.value;
  pintarStock();
});

function stockFiltrado(calc) {
  const t = norm(filtroStock.texto);
  return db.materiales.filter((m) => {
    const s = calc.mats.get(m.id);
    if (t && !norm(m.codigo + ' ' + m.descripcion).includes(t)) return false;
    if (filtroStock.modo === 'con' && s.stock <= EPS) return false;
    if (filtroStock.modo === 'bajo' && !(m.minimo > 0 && s.stock < m.minimo)) return false;
    return true;
  }).sort((a, b) => a.descripcion.localeCompare(b.descripcion));
}

function pintarStock() {
  const cont = $('#lista-stock');
  if (!cont) return;
  const calc = calcular();
  const lista = stockFiltrado(calc);
  const total = lista.reduce((a, m) => a + Math.max(0, calc.mats.get(m.id).valor), 0);
  cont.innerHTML = lista.length ? `<div class="tabla-envoltura"><table>
    <thead><tr><th>Código</th><th>Material</th><th>Und</th><th class="n">Entradas</th><th class="n">Salidas</th><th class="n">Stock</th><th class="n">Mínimo</th><th class="n">Costo prom.</th><th class="n">Valor</th></tr></thead>
    <tbody>${lista.map((m) => {
      const s = calc.mats.get(m.id);
      const bajo = m.minimo > 0 && s.stock < m.minimo;
      return `<tr><td>${esc(m.codigo)}</td><td><a href="#kardex/${m.id}">${esc(m.descripcion)}</a>${s.negativo ? ' <span class="etiqueta e-rojo">revisar</span>' : ''}</td><td>${esc(m.unidad)}</td>
        <td class="n">${cant(s.entradas)}</td><td class="n">${cant(s.salidas)}</td>
        <td class="n"><b class="${bajo ? 'rojo' : ''}">${cant(s.stock)}</b></td><td class="n">${m.minimo ? cant(m.minimo) : '—'}</td>
        <td class="n">${fmt(s.costo)}</td><td class="n">${fmt(Math.max(0, s.valor))}</td></tr>`;
    }).join('')}</tbody>
    <tfoot><tr><td colspan="8">Valor total</td><td class="n">${fmt(total)}</td></tr></tfoot></table></div>`
    : '<p class="suave">No hay materiales con ese filtro.</p>';
}

acciones['csv-stock'] = () => {
  const calc = calcular();
  const filas = [['Codigo', 'Material', 'Unidad', 'Entradas', 'Salidas', 'Stock', 'Minimo', 'Costo promedio', 'Valor']];
  for (const m of stockFiltrado(calc)) {
    const s = calc.mats.get(m.id);
    filas.push([m.codigo, m.descripcion, m.unidad, s.entradas, s.salidas, s.stock, m.minimo, redondear(s.costo), redondear(s.valor, 2)]);
  }
  descargarCsv(`stock-${hoy()}.csv`, filas);
};

acciones['imprimir-stock'] = () => {
  const calc = calcular();
  imprimir(`${cabeceraImpresion('REPORTE DE STOCK')}
    <table><thead><tr><th>Código</th><th>Material</th><th>Und</th><th>Stock</th><th>Costo prom.</th><th>Valor</th></tr></thead>
    <tbody>${stockFiltrado(calc).map((m) => {
      const s = calc.mats.get(m.id);
      return `<tr><td>${esc(m.codigo)}</td><td>${esc(m.descripcion)}</td><td>${esc(m.unidad)}</td><td style="text-align:right">${cant(s.stock)}</td><td style="text-align:right">${fmt(s.costo)}</td><td style="text-align:right">${fmt(Math.max(0, s.valor))}</td></tr>`;
    }).join('')}</tbody></table>`);
};

// ---------- Conteo físico ----------

vistas.conteo = () => {
  const calc = calcular();
  const lista = [...db.materiales].sort((a, b) => a.descripcion.localeCompare(b.descripcion));
  return `
    <p><a href="#stock">← Stock</a></p>
    <h1>Conteo físico</h1>
    <p class="suave">Cuenta lo que hay en el almacén y escríbelo en «Conteo». Deja en blanco lo que no contaste. Las diferencias se registran como ajustes con el motivo «Conteo físico».</p>
    <form data-form="conteo">
      <div class="panel"><div class="campos"><label>Fecha del conteo<input type="date" name="fecha" value="${hoy()}"></label>
        <label>Responsable<input name="responsable"></label></div></div>
      <div class="panel"><div class="tabla-envoltura"><table>
        <thead><tr><th>Código</th><th>Material</th><th>Und</th><th class="n">Stock en sistema</th><th style="width:120px">Conteo</th></tr></thead>
        <tbody>${lista.map((m) => `<tr><td>${esc(m.codigo)}</td><td>${esc(m.descripcion)}</td><td>${esc(m.unidad)}</td>
          <td class="n">${cant(calc.mats.get(m.id).stock)}</td><td><input class="num" type="number" step="any" min="0" name="c_${m.id}"></td></tr>`).join('')}</tbody>
      </table></div></div>
      <div class="fila fin"><button class="btn primario">Registrar diferencias</button></div>
    </form>`;
};

formularios.conteo = (f) => {
  const d = Object.fromEntries(new FormData(f));
  const calc = calcular(db.movimientos.filter((m) => m.fecha <= d.fecha));
  const nuevos = [];
  const ahora = Date.now();
  const grupo = uid();
  for (const m of db.materiales) {
    const v = d['c_' + m.id];
    if (v === undefined || v === '') continue;
    const dif = redondear(num(v) - calc.mats.get(m.id).stock);
    if (Math.abs(dif) < EPS) continue;
    nuevos.push({ id: uid(), grupo, creado: ahora + nuevos.length, fecha: d.fecha, tipo: 'AJUSTE', materialId: m.id, cantidad: dif, costo: 0, ordenId: '', documento: 'Conteo físico', tercero: d.responsable.trim(), obs: 'Conteo físico' });
  }
  if (!nuevos.length) return avisoEn(f, 'No hay diferencias: el conteo coincide con el sistema (o no ingresaste cantidades).', 'ok');
  const resumen = nuevos.map((n) => `• ${material(n.materialId).descripcion}: ${n.cantidad > 0 ? '+' : ''}${cant(n.cantidad)}`).join('\n');
  if (!confirm(`Se registrarán ${nuevos.length} ajuste(s):\n\n${resumen}\n\n¿Continuar?`)) return;
  if (materialesEnNegativo([...db.movimientos, ...nuevos]).some((m) => nuevos.some((n) => n.materialId === m.id))) {
    return avisoEn(f, 'Con estos ajustes, algún material quedaría negativo por movimientos posteriores a la fecha del conteo. Revisa la fecha.');
  }
  db.movimientos.push(...nuevos);
  guardar();
  filtroMov.tipo = 'AJUSTE';
  location.hash = '#movimientos';
};

// ---------- Material y kardex ----------

vistas.material = (id) => {
  const m = id ? material(id) : { codigo: '', descripcion: '', unidad: 'UND', minimo: 0 };
  return `
    <p><a href="${id ? '#kardex/' + id : '#stock'}">← Volver</a></p>
    <h1>${id ? 'Editar material' : 'Nuevo material'}</h1>
    <form data-form="material" data-id="${id || ''}" class="panel">
      <div class="campos">
        <label>Código<input name="codigo" value="${esc(m.codigo)}" placeholder="Se asigna solo si lo dejas vacío"></label>
        <label class="ancho">Descripción *<input name="descripcion" value="${esc(m.descripcion)}" required></label>
        <label>Unidad<input name="unidad" list="dl-unidades" value="${esc(m.unidad)}"></label>
        <label>Stock mínimo (alerta)<input name="minimo" type="number" step="any" min="0" value="${esc(m.minimo)}"></label>
      </div>
      <div class="fila fin" style="margin-top:10px"><button class="btn primario">Guardar</button></div>
    </form>`;
};

formularios.material = (f) => {
  const d = Object.fromEntries(new FormData(f));
  const id = f.dataset.id;
  const desc = d.descripcion.replace(/\s+/g, ' ').trim();
  if (db.materiales.some((m) => m.id !== id && norm(m.descripcion) === norm(desc))) return avisoEn(f, 'Ya existe un material con esa descripción.');
  if (d.codigo.trim() && db.materiales.some((m) => m.id !== id && m.codigo === d.codigo.trim())) return avisoEn(f, 'Ese código ya está en uso.');
  let m;
  if (id) {
    m = material(id);
    Object.assign(m, { descripcion: desc, unidad: d.unidad.trim().toUpperCase() || 'UND', minimo: num(d.minimo) });
    if (d.codigo.trim()) m.codigo = d.codigo.trim();
  } else {
    m = asegurarMaterial(desc, d.unidad);
    m.minimo = num(d.minimo);
    if (d.codigo.trim()) m.codigo = d.codigo.trim();
  }
  guardar();
  location.hash = '#kardex/' + m.id;
};

vistas.kardex = (id) => {
  const m = material(id);
  if (!m) return '<p class="alerta error">No se encontró el material.</p>';
  const calc = calcular();
  const s = calc.mats.get(m.id);
  const movs = db.movimientos.filter((x) => x.materialId === m.id).sort(ordenCrono);
  const usos = db.ordenes.filter((o) => o.items.some((it) => it.materialId === m.id));
  return `
    <p><a href="#stock">← Stock</a></p>
    <div class="fila"><h1>${esc(m.descripcion)}</h1><span class="espacio"></span>
      <a class="btn" href="#material/${m.id}">Editar</a>
      <button class="btn" data-accion="imprimir-kardex" data-id="${m.id}">Imprimir kardex</button>
      <a class="btn" href="#nuevo-mov/DEVOLUCION/${m.id}">Devolución / ajuste</a></div>
    <div class="tarjetas">
      <div class="tarjeta"><b>${cant(s.stock)} ${esc(m.unidad)}</b><span>stock actual · código ${esc(m.codigo)}</span></div>
      <div class="tarjeta"><b>${soles(s.costo)}</b><span>costo promedio</span></div>
      <div class="tarjeta"><b>${soles(Math.max(0, s.valor))}</b><span>valor en almacén</span></div>
    </div>
    ${usos.length ? `<p>Está en las O/C: ${usos.map((o) => `<a href="#orden/${o.id}">${esc(o.numero)}</a>`).join(', ')}</p>` : ''}
    <div class="panel">${tablaKardex(m, movs, calc)}</div>`;
};

function tablaKardex(m, movs, calc, paraImprimir = false) {
  if (!movs.length) return '<p class="suave">Sin movimientos.</p>';
  return `<div class="tabla-envoltura"><table>
    <thead><tr><th>Fecha</th><th>Tipo</th><th>Documento</th><th>O/C</th><th>Proveedor / entidad</th><th class="n">Entra</th><th class="n">Sale</th><th class="n">Saldo</th><th class="n">Costo u.</th></tr></thead>
    <tbody>${movs.filter((mv) => !paraImprimir || !mv.anulado).map((mv) => {
      const s = signo(mv);
      return `<tr class="${mv.anulado ? 'anulado' : ''}">
        <td>${fechaPe(mv.fecha)}</td><td>${paraImprimir ? TIPOS[mv.tipo] : etiquetaTipo(mv.tipo)}</td><td>${mv.nroCompra ? `${nroCompra(mv.nroCompra)} · ` : ''}${esc(mv.documento)}</td>
        <td>${esc(orden(mv.ordenId)?.numero || '')}</td><td>${esc(mv.tercero)}</td>
        <td class="n" style="text-align:right">${s > 0 ? cant(s) : ''}</td><td class="n" style="text-align:right">${s < 0 ? cant(-s) : ''}</td>
        <td class="n" style="text-align:right">${mv.anulado ? '' : cant(calc.saldoMov.get(mv.id))}</td>
        <td class="n" style="text-align:right">${fmt(mv.tipo === 'ENTRADA' ? mv.costo : calc.costoMov.get(mv.id) || 0)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

acciones['imprimir-kardex'] = (b) => {
  const m = material(b.dataset.id);
  const movs = db.movimientos.filter((x) => x.materialId === m.id).sort(ordenCrono);
  imprimir(`${cabeceraImpresion('KARDEX DE MATERIAL')}<p><b>${esc(m.codigo)} · ${esc(m.descripcion)}</b> (${esc(m.unidad)})</p>${tablaKardex(m, movs, calcular(), true)}`);
};

// ---------- Respaldo y configuración ----------

vistas.config = () => `
  <h1>Empresa y respaldo</h1>
  <form data-form="empresa" class="panel">
    <div class="campos">
      <label>Empresa<input name="nombre" value="${esc(db.empresa.nombre)}"></label>
      <label>RUC<input name="ruc" value="${esc(db.empresa.ruc)}"></label>
      <label>Nombre del almacén<input name="almacen" value="${esc(db.empresa.almacen)}"></label>
      <div class="ancho">
        <label>Logo de la empresa (PNG o JPG)</label>
        <div class="fila" style="margin-top:4px">
          <span class="logo" style="width:64px;height:64px">${db.empresa.logo ? `<img src="${esc(db.empresa.logo)}" alt="">` : esc(iniciales(db.empresa.nombre))}</span>
          <label class="btn" style="color:var(--texto)">Subir logo<input type="file" id="archivo-logo" accept="image/*" hidden></label>
          ${db.empresa.logo ? '<button type="button" class="btn peligro" data-accion="quitar-logo">Quitar logo</button>' : ''}
          <span class="suave">Aparece en el menú, en las actas de entrega y en los reportes impresos.</span>
        </div>
      </div>
    </div>
    <div class="fila fin" style="margin-top:10px"><button class="btn primario">Guardar</button></div>
  </form>
  <div class="panel">
    <h2 style="margin-top:0">Respaldo</h2>
    <p>Los datos viven solo en este navegador. Si borras el historial o cambias de computadora se pierden. <b>Descarga un respaldo cada semana</b> y guárdalo en tu USB, Drive o correo.</p>
    <div class="fila">
      <button class="btn primario" data-accion="respaldo">Descargar respaldo (.json)</button>
      <label class="btn" style="color:var(--texto)">Restaurar respaldo<input type="file" id="archivo-respaldo" accept=".json,application/json" hidden></label>
    </div>
    <p class="suave">Resumen: ${db.ordenes.length} O/C · ${db.materiales.length} materiales · ${db.movimientos.length} movimientos.</p>
  </div>
  <div class="panel">
    <h2 style="margin-top:0">Otros</h2>
    <div class="fila">
      <button class="btn" data-accion="recargar-iniciales">Volver a cargar las O/C 000062 y 000063</button>
      <span class="espacio"></span>
      <button class="btn peligro" data-accion="borrar-todo">Borrar todos los datos</button>
    </div>
  </div>`;

formularios.empresa = (f) => {
  const d = Object.fromEntries(new FormData(f));
  db.empresa = { ...db.empresa, nombre: d.nombre.trim(), ruc: d.ruc.trim(), almacen: d.almacen.trim() || 'Almacén principal' };
  guardar();
  render();
};

// El logo se reduce a 256 px para que quepa en el almacenamiento del navegador.
document.addEventListener('change', async (ev) => {
  if (ev.target.id !== 'archivo-logo' || !ev.target.files[0]) return;
  try {
    const url = URL.createObjectURL(ev.target.files[0]);
    const img = new Image();
    await new Promise((ok, mal) => { img.onload = ok; img.onerror = mal; img.src = url; });
    const escala = Math.min(1, 256 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * escala);
    c.height = Math.round(img.height * escala);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    db.empresa.logo = c.toDataURL('image/png');
    guardar();
    render();
  } catch (e) {
    alert('No se pudo leer esa imagen. Prueba con un PNG o JPG.');
  }
});

acciones['quitar-logo'] = () => {
  delete db.empresa.logo;
  guardar();
  render();
};

acciones.respaldo = () => descargar(`inventario-respaldo-${hoy()}.json`, JSON.stringify(db, null, 1), 'application/json');

document.addEventListener('change', async (ev) => {
  if (ev.target.id !== 'archivo-respaldo' || !ev.target.files[0]) return;
  try {
    const d = JSON.parse(await ev.target.files[0].text());
    if (!Array.isArray(d.materiales) || !Array.isArray(d.movimientos) || !Array.isArray(d.ordenes)) throw new Error('formato');
    if (!confirm(`El respaldo tiene ${d.ordenes.length} O/C, ${d.materiales.length} materiales y ${d.movimientos.length} movimientos.\n\nReemplazará TODO lo que hay ahora en este navegador. ¿Continuar?`)) return;
    db = d;
    guardar();
    location.hash = '#resumen';
    render();
  } catch (e) {
    alert('Ese archivo no es un respaldo válido de esta app.');
  } finally {
    ev.target.value = '';
  }
});

acciones['recargar-iniciales'] = () => {
  const n = cargarOrdenesIniciales();
  guardar();
  alert(n ? `Se cargaron ${n} O/C.` : 'Las dos O/C ya están registradas.');
  render();
};

acciones['borrar-todo'] = () => {
  if (!confirm('¿Borrar TODOS los datos (O/C, materiales y movimientos)? Descarga antes un respaldo.')) return;
  if (prompt('Escribe BORRAR para confirmar') !== 'BORRAR') return;
  db = baseVacia();
  guardar();
  location.hash = '#resumen';
  render();
};

// ---------- Impresión y descargas ----------

function cabeceraImpresion(titulo) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px">${db.empresa.logo ? `<img class="logo-impresion" src="${esc(db.empresa.logo)}" alt="">` : ''}<div style="flex:1"><b>${esc(db.empresa.nombre)}</b><br>RUC ${esc(db.empresa.ruc)} · ${esc(db.empresa.almacen)}</div><div>Fecha: ${fechaPe(hoy())}</div></div>
    <h2 style="text-align:center">${titulo}</h2>`;
}

function imprimir(html) {
  $('#imprimir').innerHTML = html;
  document.body.classList.add('imprimiendo');
  window.print();
  document.body.classList.remove('imprimiendo');
}

function imprimirActa(grupo) {
  const movs = db.movimientos.filter((m) => (m.grupo || m.id) === grupo && !m.anulado);
  if (!movs.length) return;
  const o = orden(movs[0].ordenId);
  const g = movs[0];
  const items = o ? o.items : [];
  imprimir(`${cabeceraImpresion('ACTA DE ENTREGA DE BIENES')}
    <table style="margin-bottom:10px"><tbody>
      <tr><td><b>Entidad</b></td><td>${esc(o?.entidad)} · RUC ${esc(o?.rucEntidad)}</td><td><b>Fecha de entrega</b></td><td>${fechaPe(g.fecha)}</td></tr>
      <tr><td><b>Orden de compra</b></td><td>N° ${esc(o?.numero)} del ${fechaPe(o?.fecha)} · SIAF ${esc(o?.siaf)}</td><td><b>Guía de remisión</b></td><td>${esc(g.documento)}</td></tr>
      <tr><td><b>Referencia</b></td><td>${esc(o?.referencia)}</td><td><b>Lugar</b></td><td>${esc(g.lugar || o?.enviarA)}</td></tr>
      <tr><td><b>Meta</b></td><td colspan="3">${esc(o?.meta)}</td></tr>
    </tbody></table>
    <table><thead><tr><th>#</th><th>Cant.</th><th>Und</th><th>Descripción</th></tr></thead>
    <tbody>${movs.map((mv, i) => {
      const it = items.find((x) => x.materialId === mv.materialId);
      return `<tr><td>${i + 1}</td><td style="text-align:right">${cant(mv.cantidad)}</td><td>${esc(it?.unidad || material(mv.materialId)?.unidad)}</td><td>${esc(material(mv.materialId)?.descripcion)}</td></tr>`;
    }).join('')}</tbody></table>
    ${g.obs ? `<p><b>Observaciones:</b> ${esc(g.obs)}</p>` : ''}
    <div class="firmas"><div>Entregué conforme<br>${esc(db.empresa.nombre)}</div><div>Recibí conforme<br>${esc(g.recibe || 'Nombre, cargo, firma y sello')}</div></div>`);
}

acciones['imprimir-acta'] = (b) => imprimirActa(b.dataset.grupo);

acciones['imprimir-orden'] = (b) => {
  const o = orden(b.dataset.id);
  const e = estadoOrden(o, calcular());
  imprimir(`${cabeceraImpresion(`ESTADO DE LA O/C N° ${esc(o.numero)}`)}
    <p>${esc(o.entidad)} · ${esc(o.referencia)} · Fecha ${fechaPe(o.fecha)} · Plazo ${esc(o.plazoDias)} días · Estado: <b>${e.estado}</b></p>
    <table><thead><tr><th>#</th><th>Descripción</th><th>Und</th><th>Pedido</th><th>Entregado</th><th>Pendiente</th></tr></thead>
    <tbody>${e.items.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(material(it.materialId)?.descripcion)}</td><td>${esc(it.unidad)}</td><td style="text-align:right">${cant(it.cant)}</td><td style="text-align:right">${cant(it.entregado)}</td><td style="text-align:right">${cant(it.pendiente)}</td></tr>`).join('')}</tbody></table>
    <p>Total O/C ${soles(e.total)} · Entregado ${soles(e.totalEntregado)} (${fmt(e.avance * 100, 0)}%)</p>`);
};

acciones['csv-orden'] = (b) => {
  const o = orden(b.dataset.id);
  const e = estadoOrden(o, calcular());
  const filas = [['#', 'Codigo', 'Descripcion', 'Unidad', 'Pedido', 'Entregado', 'Pendiente', 'Stock', 'Falta comprar', 'P. unit.', 'Importe']];
  e.items.forEach((it, i) => {
    const m = material(it.materialId);
    filas.push([i + 1, m?.codigo, m?.descripcion, it.unidad, it.cant, it.entregado, it.pendiente, it.stock, it.faltaComprar, it.pu, redondear(it.cant * it.pu, 2)]);
  });
  descargarCsv(`OC-${o.numero}-${hoy()}.csv`, filas);
};

function descargar(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// CSV con coma y punto decimal (formato de Excel en Perú); el BOM hace que Excel respete las tildes.
function descargarCsv(nombre, filas) {
  const celda = (v) => {
    const s = typeof v === 'number' ? String(redondear(v)) : String(v ?? '');
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  descargar(nombre, '﻿' + filas.map((f) => f.map(celda).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}

// ---------- Inicio ----------

$$('[data-icono]').forEach((el) => el.insertAdjacentHTML('afterbegin', icono(el.dataset.icono)));
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', pintarMarca);
document.body.insertAdjacentHTML('beforeend', `<datalist id="dl-unidades">${UNIDADES.map((u) => `<option value="${u}">`).join('')}</datalist>`);
render();

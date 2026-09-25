'use strict';

const STORAGE_KEY = 'propuestas-peru-v1';
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- Estado ----------

function estadoInicial() {
  return {
    empresa: {
      ruc: '', razonSocial: '', nombreComercial: '', representante: '', dniRepresentante: '',
      domicilio: '', telefono: '', email: '', mype: false,
      rnpVigencia: '', capacidadMaxContratacion: 0,
      rnpCapitulos: { bienes: false, servicios: false, consultorObras: false, ejecutorObras: false },
      banco: '', cci: '', ciudad: 'Lima',
    },
    experiencia: [],
    personal: [],
    equipos: [],
    procesos: [],
    docsEmpresa: [],
    membrete: { docxId: '', docxNombre: '', pdfId: '', pdfNombre: '' },
    oportunidades: { perfil: 'empresa', tdrTexto: '', resultado: null, consulta: '', busqueda: null },
    config: { modoIA: 'plan', modelo: 'claude-opus-5', esfuerzo: 'high', recordarKey: false, uit: 5500 },
  };
}

function cargar() {
  const base = estadoInicial();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const s = JSON.parse(raw);
    const r = {
      ...base, ...s,
      empresa: { ...base.empresa, ...s.empresa, rnpCapitulos: { ...base.empresa.rnpCapitulos, ...(s.empresa || {}).rnpCapitulos } },
      membrete: { ...base.membrete, ...s.membrete },
      oportunidades: { ...base.oportunidades, ...s.oportunidades },
      config: { ...base.config, ...s.config },
    };
    // Completa campos agregados en versiones posteriores.
    r.experiencia.forEach((x) => { x.archivos = x.archivos || []; });
    r.personal.forEach((x) => { x.experiencias = x.experiencias || []; x.documentos = x.documentos || []; });
    r.procesos.forEach((p) => {
      const n = nuevoProceso(p.tipoObjeto);
      ['anexos', 'estructura', 'clasif', 'opcionesExpediente', 'perfilEval', 'cumplimiento', 'defExperiencia']
        .forEach((k) => { if (p[k] === undefined) p[k] = n[k]; });
    });
    return r;
  } catch (e) {
    return base;
  }
}

let state = cargar();
const vista = { pagina: 'inicio', procesoId: null, tab: 'bases' };
const pdfEnMemoria = {}; // procesoId -> { nombre, base64 } (no se guarda: puede ser grande)
const iaOcupada = {}; // clave -> true mientras corre una llamada

let temporizadorGuardado;
function guardar() {
  clearTimeout(temporizadorGuardado);
  temporizadorGuardado = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      aviso('');
    } catch (e) {
      aviso('No se pudo guardar en el navegador (espacio lleno o bloqueado). Descarga un respaldo desde Inicio.');
    }
  }, 250);
}

function aviso(texto) {
  const el = document.getElementById('aviso');
  if (!el) return;
  el.textContent = texto;
  el.hidden = !texto;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, valor) {
  const ks = path.split('.');
  const ultimo = ks.pop();
  ks.reduce((o, k) => o[k], obj)[ultimo] = valor;
}

// ---------- Utilidades ----------

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function dinero(n, moneda = 'PEN') {
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: moneda || 'PEN' }).format(n || 0);
  } catch (e) {
    return (moneda || '') + ' ' + (n || 0).toFixed(2);
  }
}

const redondear = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function hoyISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function fechaLarga(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || '';
  const [a, m, d] = iso.split('-').map(Number);
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${d} de ${meses[m - 1]} de ${a}`;
}

function diasHasta(iso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return null;
  const objetivo = new Date(iso.slice(0, 10) + 'T00:00:00');
  const hoy = new Date(hoyISO() + 'T00:00:00');
  return Math.round((objetivo - hoy) / 86400000);
}

function numeroALetras(monto, moneda = 'PEN') {
  const U = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce',
    'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno',
    'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  const D = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const C = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
  const cientos = (n) => {
    if (n === 0) return '';
    if (n === 100) return 'cien';
    const c = Math.floor(n / 100);
    const r = n % 100;
    let t = C[c];
    if (r) {
      const dec = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' y ' + U[r % 10] : '');
      t += (t ? ' ' : '') + dec;
    }
    return t;
  };
  const miles = (n) => {
    const m = Math.floor(n / 1000);
    const r = n % 1000;
    const pre = m === 0 ? '' : m === 1 ? 'mil' : cientos(m).replace(/uno$/, 'un') + ' mil';
    return [pre, cientos(r)].filter(Boolean).join(' ');
  };
  const entero = Math.floor(monto || 0);
  const cent = Math.round(((monto || 0) - entero) * 100);
  const mill = Math.floor(entero / 1e6);
  const resto = entero % 1e6;
  let texto = '';
  if (mill) texto = mill === 1 ? 'un millón' : miles(mill).replace(/uno$/, 'un') + ' millones';
  if (resto) texto += (texto ? ' ' : '') + miles(resto);
  if (!texto) texto = 'cero';
  const nombre = { PEN: 'soles', USD: 'dólares americanos' }[moneda] || moneda;
  return `${texto} con ${String(cent).padStart(2, '0')}/100 ${nombre}`.toUpperCase();
}

// Texto simple de la IA -> HTML ("## " subtítulos, "- " viñetas, párrafos).
function textoAHtml(texto) {
  const lineas = String(texto || '').split(/\r?\n/);
  let html = '';
  let enLista = false;
  let parrafo = [];
  const cerrarParrafo = () => {
    if (parrafo.length) html += `<p>${esc(parrafo.join(' '))}</p>`;
    parrafo = [];
  };
  const cerrarLista = () => {
    if (enLista) html += '</ul>';
    enLista = false;
  };
  for (const linea of lineas) {
    const l = linea.trim();
    if (!l) { cerrarParrafo(); cerrarLista(); continue; }
    const h = l.match(/^#{1,6}\s+(.*)/);
    const b = l.match(/^[-*•]\s+(.*)/);
    if (h) { cerrarParrafo(); cerrarLista(); html += `<h4>${esc(h[1])}</h4>`; }
    else if (b) { cerrarParrafo(); if (!enLista) { html += '<ul>'; enLista = true; } html += `<li>${esc(b[1])}</li>`; }
    else { cerrarLista(); parrafo.push(l); }
  }
  cerrarParrafo();
  cerrarLista();
  return html;
}

// ---------- Modelo de proceso ----------

function nuevoProceso(tipo) {
  const req = [...REQUISITOS_COMUNES, ...(REQUISITOS_POR_TIPO[tipo] || [])];
  return {
    id: uid(),
    creado: new Date().toISOString(),
    nomenclatura: '', entidad: '', objeto: '', tipoObjeto: tipo,
    procedimiento: '', sistema: tipo === 'obra' ? 'Suma alzada' : '',
    valorReferencial: 0, moneda: 'PEN', plazoDias: 0, lugar: '',
    estado: 'preparacion', consorcio: false, notas: '',
    cronograma: ETAPAS.map((etapa) => ({ etapa, fecha: '' })),
    requisitos: req.map(([categoria, texto]) => ({ id: uid(), categoria, texto, referencia: '', cumple: false, nota: '' })),
    presupuesto: {
      partidas: (PARTIDAS_BASE[tipo] || []).map(([item, descripcion, unidad]) => ({ id: uid(), item, descripcion, unidad, metrado: 0, pu: 0 })),
      ggPct: 10, utilidadPct: 10, igvPct: 18,
      limInfPct: tipo === 'obra' ? 90 : 0, limSupPct: tipo === 'obra' ? 110 : 100,
      garantiaPct: 10,
    },
    tecnica: (SECCIONES_TECNICAS[tipo] || []).map((titulo) => ({ id: uid(), titulo, contenido: '', instrucciones: '' })),
    experienciaSel: [], personalSel: [], equiposSel: [],
    basesTexto: '', analisis: null, revision: '',
    anexos: [], estructura: [], clasif: {}, defExperiencia: '',
    perfilEval: 'empresa', cumplimiento: null,
    opcionesExpediente: {
      indice: true, folioPos: 'sup-der', folioFormato: 'Folio {n}', folioInicio: 1, folioDigitos: 4,
      folioOrden: 'asc', margenSupCm: 4, margenInfCm: 3,
    },
  };
}

function calcularPresupuesto(p) {
  const pr = p.presupuesto;
  const cd = redondear(pr.partidas.reduce((s, x) => s + redondear((+x.metrado || 0) * (+x.pu || 0)), 0));
  const gg = redondear(cd * (+pr.ggPct || 0) / 100);
  const ut = redondear(cd * (+pr.utilidadPct || 0) / 100);
  const subtotal = redondear(cd + gg + ut);
  const igv = redondear(subtotal * (+pr.igvPct || 0) / 100);
  const total = redondear(subtotal + igv);
  const vr = +p.valorReferencial || 0;
  const pctVR = vr ? (total / vr) * 100 : null;
  const garantia = redondear(total * (+pr.garantiaPct || 0) / 100);
  return { cd, gg, ut, subtotal, igv, total, pctVR, garantia };
}

function fechaPresentacion(p) {
  const e = p.cronograma.find((c) => /presentaci/i.test(c.etapa));
  return e ? e.fecha : '';
}

function alertasProceso(p) {
  const a = [];
  const emp = state.empresa;
  const fp = fechaPresentacion(p);
  const dias = diasHasta(fp);
  if (p.estado === 'preparacion') {
    if (dias === null) a.push(['info', 'Registra la fecha de presentación de ofertas en el cronograma.']);
    else if (dias < 0) a.push(['error', `La fecha de presentación (${fechaLarga(fp)}) ya pasó.`]);
    else if (dias <= 3) a.push(['error', `Quedan ${dias} día(s) para presentar la oferta.`]);
    else if (dias <= 7) a.push(['warn', `Quedan ${dias} días para presentar la oferta.`]);
  }
  const cap = CAPITULO_RNP[p.tipoObjeto];
  if (cap && !emp.rnpCapitulos[cap]) a.push(['error', `La empresa no tiene marcado el capítulo RNP "${NOMBRE_CAPITULO[cap]}".`]);
  if (!emp.rnpVigencia) a.push(['warn', 'Registra la vigencia del RNP en "Mi empresa".']);
  else if (fp && /^\d{4}-\d{2}-\d{2}$/.test(fp) && emp.rnpVigencia < fp) a.push(['error', `El RNP vence (${fechaLarga(emp.rnpVigencia)}) antes de la presentación de ofertas.`]);
  if (p.tipoObjeto === 'obra' && p.valorReferencial && (+emp.capacidadMaxContratacion || 0) < p.valorReferencial) {
    a.push(['error', `La capacidad máxima de contratación (${dinero(emp.capacidadMaxContratacion)}) es menor al valor referencial.`]);
  }
  const t = calcularPresupuesto(p);
  if (t.total && t.pctVR !== null) {
    const pr = p.presupuesto;
    if (pr.limInfPct && t.pctVR < pr.limInfPct) a.push(['error', `La oferta (${t.pctVR.toFixed(2)} % del VR) está por debajo del límite inferior (${pr.limInfPct} %).`]);
    if (pr.limSupPct && t.pctVR > pr.limSupPct) a.push(['error', `La oferta (${t.pctVR.toFixed(2)} % del VR) supera el límite superior (${pr.limSupPct} %).`]);
  }
  const pend = p.requisitos.filter((r) => !r.cumple && r.categoria !== 'Contrato').length;
  if (pend) a.push(['warn', `${pend} requisito(s) de admisión, calificación o evaluación pendiente(s).`]);
  const vacias = p.tecnica.filter((s) => !s.contenido.trim()).length;
  if (vacias) a.push(['info', `${vacias} sección(es) de la propuesta técnica sin redactar.`]);
  const marcadores = p.tecnica.reduce((n, s) => n + (s.contenido.match(/\[COMPLETAR/g) || []).length, 0);
  if (marcadores) a.push(['warn', `Hay ${marcadores} dato(s) marcados como [COMPLETAR] en la propuesta técnica.`]);
  return a;
}

function avanceRequisitos(p) {
  const r = p.requisitos.filter((x) => x.categoria !== 'Contrato');
  return r.length ? Math.round((r.filter((x) => x.cumple).length / r.length) * 100) : 0;
}

// ---------- Componentes de formulario ----------

function campo(path, etiqueta, { tipo = 'text', placeholder = '', ancho = '', extra = '' } = {}) {
  const v = getPath(state, path);
  const num = tipo === 'number';
  return `<label class="campo ${ancho}"><span>${esc(etiqueta)}</span>
    <input type="${tipo}" ${num ? 'step="any" data-type="number"' : ''} data-bind="${path}" value="${esc(v == null ? '' : v)}" placeholder="${esc(placeholder)}" ${extra}></label>`;
}

function area(path, etiqueta, { filas = 4, placeholder = '', extra = '' } = {}) {
  return `<label class="campo ancho-total"><span>${esc(etiqueta)}</span>
    <textarea rows="${filas}" data-bind="${path}" placeholder="${esc(placeholder)}" ${extra}>${esc(getPath(state, path) || '')}</textarea></label>`;
}

function selector(path, etiqueta, opciones, { ancho = '', extra = '' } = {}) {
  const v = getPath(state, path);
  const ops = Array.isArray(opciones) ? opciones.map((o) => [o, o]) : Object.entries(opciones);
  return `<label class="campo ${ancho}"><span>${esc(etiqueta)}</span><select data-bind="${path}" ${extra}>
    ${ops.map(([k, t]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
}

function casilla(path, etiqueta, extra = '') {
  return `<label class="casilla"><input type="checkbox" data-bind="${path}" ${getPath(state, path) ? 'checked' : ''} ${extra}> ${esc(etiqueta)}</label>`;
}

function celda(path, { tipo = 'text', extra = '' } = {}) {
  const v = getPath(state, path);
  const num = tipo === 'number';
  return `<input class="celda ${num ? 'num' : ''}" type="${tipo}" ${num ? 'step="any" data-type="number"' : ''} data-bind="${path}" value="${esc(v == null ? '' : v)}" ${extra}>`;
}

function alertasHtml(lista) {
  if (!lista.length) return '<p class="alerta ok">Sin observaciones por ahora.</p>';
  return lista.map(([nivel, t]) => `<p class="alerta ${nivel}">${esc(t)}</p>`).join('');
}

// ---------- Vistas ----------

function vInicio() {
  const procs = state.procesos;
  const activos = procs.filter((p) => p.estado === 'preparacion').length;
  const ganados = procs.filter((p) => p.estado === 'ganada').length;
  const empresaLista = state.empresa.ruc && state.empresa.razonSocial;
  return `
  <section class="tarjeta">
    <h2>Nuevo proceso</h2>
    <p class="ayuda">Crea una carpeta de trabajo para cada procedimiento de selección que encuentres en el SEACE / PLADICOP.</p>
    <div class="fila">
      <label class="campo"><span>Tipo de objeto</span>
        <select id="nuevo-tipo">${Object.entries(TIPOS_OBJETO).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <button class="btn primario" data-action="crear-proceso">+ Crear proceso</button>
    </div>
    ${empresaLista ? '' : '<p class="alerta warn">Primero completa los datos de <a href="#" data-action="ir" data-pagina="empresa">Mi empresa</a>: se reutilizan en todas las propuestas.</p>'}
  </section>
  <section class="indicadores">
    <div><strong>${procs.length}</strong><span>procesos</span></div>
    <div><strong>${activos}</strong><span>en preparación</span></div>
    <div><strong>${ganados}</strong><span>buenas pro</span></div>
    <div><strong>${state.experiencia.length}</strong><span>contratos de experiencia</span></div>
  </section>
  <section class="tarjeta">
    <h2>Mis procesos</h2>
    ${procs.length ? `<div class="tabla-scroll"><table class="tabla">
      <thead><tr><th>Nomenclatura / objeto</th><th>Entidad</th><th>Tipo</th><th class="num">Valor ref.</th><th>Presentación</th><th>Requisitos</th><th>Estado</th><th></th></tr></thead>
      <tbody>${procs.map((p) => {
        const fp = fechaPresentacion(p);
        const d = diasHasta(fp);
        const errores = alertasProceso(p).filter((x) => x[0] === 'error').length;
        return `<tr>
          <td><a href="#" data-action="abrir" data-id="${p.id}"><strong>${esc(p.nomenclatura || 'Sin nomenclatura')}</strong></a><br><small>${esc((p.objeto || '').slice(0, 90))}</small></td>
          <td>${esc(p.entidad)}</td>
          <td>${esc(TIPOS_OBJETO[p.tipoObjeto])}</td>
          <td class="num">${p.valorReferencial ? dinero(p.valorReferencial, p.moneda) : '—'}</td>
          <td>${fp ? esc(fechaLarga(fp)) : '—'}${d !== null && p.estado === 'preparacion' ? `<br><small class="${d <= 3 ? 'rojo' : ''}">${d >= 0 ? `faltan ${d} días` : 'vencido'}</small>` : ''}</td>
          <td><div class="barra"><div style="width:${avanceRequisitos(p)}%"></div></div><small>${avanceRequisitos(p)} %</small></td>
          <td>${esc(ESTADOS[p.estado])}${errores ? `<br><small class="rojo">${errores} alerta(s)</small>` : ''}</td>
          <td class="acciones"><button class="btn" data-action="abrir" data-id="${p.id}">Abrir</button>
            <button class="btn peligro" data-action="eliminar-proceso" data-id="${p.id}" title="Eliminar">✕</button></td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="ayuda">Aún no tienes procesos.</p>'}
  </section>
  <section class="tarjeta">
    <h2>Respaldo</h2>
    <p class="ayuda">Tus datos se guardan solo en este navegador. Descarga un respaldo con frecuencia o para pasarlos a otra computadora.</p>
    <div class="fila">
      <button class="btn" data-action="exportar-json">Descargar respaldo (.json)</button>
      <label class="btn">Restaurar respaldo<input type="file" accept="application/json,.json" id="importar-json" hidden></label>
    </div>
  </section>`;
}

function vEmpresa() {
  const e = 'empresa';
  const filaLista = (lista, i, cols) => `<tr>${cols.map((c) => `<td>${c}</td>`).join('')}
    <td><button class="btn peligro" data-action="quitar" data-lista="${lista}" data-i="${i}" title="Quitar">✕</button></td></tr>`;
  const totalExp = state.experiencia.reduce((s, x) => s + (+x.monto || 0), 0);
  return `
  <section class="tarjeta">
    <h2>Datos del postor</h2>
    <div class="grid">
      ${campo(e + '.ruc', 'RUC', { placeholder: '20XXXXXXXXX' })}
      ${campo(e + '.razonSocial', 'Razón social', { ancho: 'doble' })}
      ${campo(e + '.nombreComercial', 'Nombre comercial')}
      ${campo(e + '.representante', 'Representante legal', { ancho: 'doble' })}
      ${campo(e + '.dniRepresentante', 'DNI del representante')}
      ${campo(e + '.domicilio', 'Domicilio legal', { ancho: 'doble' })}
      ${campo(e + '.ciudad', 'Ciudad (para firmas)')}
      ${campo(e + '.telefono', 'Teléfono')}
      ${campo(e + '.email', 'Correo para notificaciones', { tipo: 'email' })}
      ${campo(e + '.banco', 'Banco')}
      ${campo(e + '.cci', 'CCI (20 dígitos)')}
    </div>
    ${casilla(e + '.mype', 'La empresa está acreditada como MYPE (REMYPE)')}
  </section>
  <section class="tarjeta">
    <h2>Registro Nacional de Proveedores (RNP)</h2>
    <div class="grid">
      ${campo(e + '.rnpVigencia', 'Vigencia de inscripción hasta', { tipo: 'date' })}
      ${campo(e + '.capacidadMaxContratacion', 'Capacidad máx. de contratación (S/) — ejecutor de obras', { tipo: 'number', ancho: 'doble' })}
    </div>
    <div class="fila">${Object.entries(NOMBRE_CAPITULO).map(([k, t]) => casilla(`${e}.rnpCapitulos.${k}`, t)).join('')}</div>
  </section>
  ${seccionMembrete()}
  <section class="tarjeta">
    <h2>Experiencia del postor</h2>
    <p class="ayuda">Contratos ejecutados que puedes acreditar (contrato + conformidad o comprobantes de pago). Adjunta los sustentos (PDF o imagen) en cada fila; luego eliges cuáles presentar en cada proceso.</p>
    ${botonImportarCV('cv-empresa', 'Importar experiencia desde CV / portafolio de la empresa')}
    <div class="tabla-scroll"><table class="tabla editable">
      <thead><tr><th>Cliente / entidad</th><th>Objeto del contrato</th><th>Tipo</th><th>Especialidad / subespecialidad</th><th class="num">Monto (S/)</th><th>Inicio</th><th>Fin / conformidad</th><th>N.° contrato / acta</th><th>Archivos</th><th></th></tr></thead>
      <tbody>${state.experiencia.map((x, i) => filaLista('experiencia', i, [
        celda(`experiencia.${i}.cliente`), celda(`experiencia.${i}.objeto`),
        `<select class="celda" data-bind="experiencia.${i}.tipo">${Object.entries(TIPOS_OBJETO).map(([k, t]) => `<option value="${k}" ${x.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`,
        celda(`experiencia.${i}.especialidad`), celda(`experiencia.${i}.monto`, { tipo: 'number' }),
        celda(`experiencia.${i}.inicio`, { tipo: 'date' }), celda(`experiencia.${i}.fecha`, { tipo: 'date' }),
        celda(`experiencia.${i}.sustento`, { extra: 'placeholder="Contrato N.°, acta..."' }), chipsArchivos(`experiencia.${i}.archivos`),
      ])).join('')}</tbody>
      <tfoot><tr><td colspan="4">Total acreditable</td><td class="num">${dinero(totalExp)}</td><td colspan="5"></td></tr></tfoot>
    </table></div>
    <button class="btn" data-action="agregar" data-lista="experiencia">+ Agregar contrato</button>
  </section>
  <section class="tarjeta">
    <h2>Personal clave</h2>
    <p class="ayuda">Los profesionales, sus CV, experiencias y documentos se gestionan en <a href="#" data-action="ir" data-pagina="profesionales">Profesionales</a>.</p>
  </section>
  <section class="tarjeta">
    <h2>Equipamiento</h2>
    <div class="tabla-scroll"><table class="tabla editable">
      <thead><tr><th>Descripción</th><th>Marca / modelo</th><th class="num">Cantidad</th><th>Tenencia</th><th>Sustento</th><th></th></tr></thead>
      <tbody>${state.equipos.map((x, i) => filaLista('equipos', i, [
        celda(`equipos.${i}.descripcion`), celda(`equipos.${i}.modelo`), celda(`equipos.${i}.cantidad`, { tipo: 'number' }),
        `<select class="celda" data-bind="equipos.${i}.tenencia">${['Propio', 'Alquilado', 'Compromiso de alquiler'].map((t) => `<option ${x.tenencia === t ? 'selected' : ''}>${t}</option>`).join('')}</select>`,
        celda(`equipos.${i}.sustento`, { extra: 'placeholder="Factura, contrato..."' }),
      ])).join('')}</tbody>
    </table></div>
    <button class="btn" data-action="agregar" data-lista="equipos">+ Agregar equipo</button>
  </section>
  ${seccionDocsEmpresa()}`;
}

function vConfig() {
  const key = leerApiKey();
  const api = state.config.modoIA === 'api';
  if (IA.modo() === 'claude') {
    return `<section class="tarjeta">
    <h2>Asistente con IA (Claude)</h2>
    <p class="alerta ok">Conectado directo a tu cuenta de Claude. Las consultas usan tu plan, sin copiar y pegar ni pagos extra.</p>
    <p class="ayuda">La primera vez que uses la IA, claude.ai te pedirá permiso para que esta app use tu cuenta. Cada consulta cuenta dentro del límite de uso de tu plan.</p>
    <p class="ayuda">Los PDF se leen como texto dentro de la app. Si un PDF es escaneado (solo imagen), se envían imágenes de sus primeras páginas; para documentos largos escaneados, mejor usa la versión en Word o con texto.</p>
    <p class="ayuda">La búsqueda de convocatorias en internet se hace pegando el pedido en un chat de Claude, porque la app no puede navegar.</p>
  </section>
  <section class="tarjeta">
    <h3>Contrataciones menores</h3>
    <div class="grid">${campo('config.uit', 'Valor de la UIT vigente (S/)', { tipo: 'number' })}</div>
    <p class="ayuda">Se usa para calcular el tope de 8 UIT. Verifica el valor oficial del año.</p>
    <p class="alerta warn">La IA puede equivocarse. Verifica siempre contra las bases integradas antes de presentar.</p>
  </section>`;
  }
  return `
  <section class="tarjeta">
    <h2>Asistente con IA (Claude)</h2>
    <p class="ayuda">La IA lee tu CV y las bases, llena anexos, te dice si cumples los requisitos y redacta la propuesta técnica. Elige cómo usarla:</p>
    <label class="opcion-modo ${!api ? 'activo' : ''}"><input type="radio" name="modoIA" data-bind="config.modoIA" value="plan" data-rerender ${!api ? 'checked' : ''}>
      <span><strong>Con mi plan de Claude (sin costo extra)</strong><br>
      <small>La app arma el pedido; lo pegas en claude.ai (con tu cuenta Pro/Max), adjuntas el archivo si hace falta y pegas la respuesta de vuelta. Usa los límites de uso de tu plan.</small></span></label>
    <label class="opcion-modo ${api ? 'activo' : ''}"><input type="radio" name="modoIA" data-bind="config.modoIA" value="api" data-rerender ${api ? 'checked' : ''}>
      <span><strong>Automático con API key</strong><br>
      <small>Todo ocurre dentro de la app, sin copiar y pegar. La API se paga aparte en console.anthropic.com (no está incluida en el plan de Claude).</small></span></label>
  </section>
  ${api ? `<section class="tarjeta">
    <h2>API key</h2>
    <div class="grid">
      <label class="campo doble"><span>API key</span><input type="password" id="api-key" value="${esc(key)}" placeholder="sk-ant-..." autocomplete="off"></label>
      ${selector('config.modelo', 'Modelo', MODELOS_IA)}
      ${selector('config.esfuerzo', 'Nivel de razonamiento', { low: 'Bajo (rápido)', medium: 'Medio', high: 'Alto (recomendado)', xhigh: 'Muy alto' })}
    </div>
    ${casilla('config.recordarKey', 'Recordar la API key en este navegador (si no, se borra al cerrarlo)')}
    <div class="fila"><button class="btn primario" data-action="guardar-key">Guardar API key</button>
      <button class="btn" data-action="borrar-key">Borrar API key</button></div>
    ${key ? '' : '<p class="alerta warn">Sin API key, la app usa el modo "con mi plan de Claude".</p>'}
    <p class="alerta info">La key se guarda solo en este navegador y se envía únicamente a api.anthropic.com.</p>
  </section>` : ''}
  <section class="tarjeta">
    <h3>Contrataciones menores</h3>
    <div class="grid">${campo('config.uit', 'Valor de la UIT vigente (S/)', { tipo: 'number' })}</div>
    <p class="ayuda">Se usa para calcular el tope de 8 UIT. Verifica el valor oficial del año.</p>
    <p class="alerta warn">La IA puede equivocarse. Verifica siempre contra las bases integradas antes de presentar: una omisión puede dejar tu oferta como no admitida.</p>
  </section>`;
}

function vProceso() {
  const i = state.procesos.findIndex((p) => p.id === vista.procesoId);
  if (i < 0) { vista.pagina = 'inicio'; return vInicio(); }
  const p = state.procesos[i];
  const tabs = {
    bases: '1. Bases / TDR', resumen: '2. Datos', requisitos: '3. Requisitos', experiencia: '4. Experiencia',
    anexos: '5. Anexos', economica: '6. Oferta económica', tecnica: '7. Propuesta técnica', expediente: '8. Expediente', documentos: 'Formatos propios',
  };
  const cuerpo = {
    bases: tabBases, resumen: tabResumen, requisitos: tabRequisitos, experiencia: tabExperiencia, anexos: tabAnexos,
    economica: tabEconomica, tecnica: tabTecnica, expediente: tabExpediente, documentos: tabDocumentos,
  }[vista.tab] || tabBases;
  return `
  <div class="cabecera-proceso">
    <a href="#" data-action="ir" data-pagina="inicio">← Mis procesos</a>
    <h2>${esc(p.nomenclatura || 'Proceso sin nomenclatura')} <small>${esc(TIPOS_OBJETO[p.tipoObjeto])}</small></h2>
    <p>${esc(p.entidad)}${p.objeto ? ' — ' + esc(p.objeto.slice(0, 160)) : ''}</p>
  </div>
  <nav class="tabs">${Object.entries(tabs).map(([k, t]) => `<button class="${vista.tab === k ? 'activo' : ''}" data-action="tab" data-tab="${k}">${t}</button>`).join('')}</nav>
  ${cuerpo(p, `procesos.${i}`)}`;
}

function tabBases(p, b) {
  const pdf = pdfEnMemoria[p.id];
  const a = p.analisis;
  const ocupado = iaOcupada['analisis-' + p.id];
  return `
  <section class="tarjeta">
    <h2>Bases del procedimiento</h2>
    <p class="ayuda">Descarga las bases integradas desde el SEACE / PLADICOP y súbelas aquí, o pega su texto. La IA extrae datos, cronograma, requisitos, factores de evaluación y alertas.</p>
    <div class="fila">
      <label class="btn">📄 Subir bases / TDR (PDF o Word)<input type="file" accept="application/pdf,.docx" id="subir-pdf" hidden></label>
      ${pdf ? `<span class="etiqueta">${esc(pdf.nombre)} (${(pdf.base64.length * 0.75 / 1048576).toFixed(1)} MB) <button class="btn-link" data-action="quitar-pdf">quitar</button></span>` : '<span class="ayuda">El PDF se usa solo durante esta sesión (no se guarda). Un Word se convierte a texto abajo.</span>'}
    </div>
    ${area(b + '.basesTexto', 'O pega aquí el texto de las bases / términos de referencia / expediente técnico', { filas: 8 })}
    <div class="fila">
      <button class="btn primario" data-action="analizar" ${ocupado ? 'disabled' : ''}>${ocupado ? (IA.modo() === 'plan' ? '⏳ Esperando la respuesta de Claude…' : 'Analizando… (puede tardar 1-3 min)') : '✨ Analizar bases con IA'}</button>
      ${IA.disponible() ? '' : '<span class="ayuda">Requiere API key en <a href="#" data-action="ir" data-pagina="config">Configuración</a>.</span>'}
    </div>
  </section>
  ${a ? `
  <section class="tarjeta">
    <h2>Resultado del análisis</h2>
    <p>${esc(a.resumen)}</p>
    <div class="grid resumen-datos">
      <div><span>Nomenclatura</span>${esc(a.nomenclatura) || '—'}</div>
      <div><span>Entidad</span>${esc(a.entidad) || '—'}</div>
      <div><span>Procedimiento</span>${esc(a.procedimiento) || '—'}</div>
      <div><span>Sistema</span>${esc(a.sistemaContratacion) || '—'}</div>
      <div><span>Valor referencial</span>${a.valorReferencial ? dinero(a.valorReferencial, a.moneda === 'USD' ? 'USD' : 'PEN') : '—'}</div>
      <div><span>Plazo</span>${a.plazoEjecucionDias ? a.plazoEjecucionDias + ' días' : '—'}</div>
    </div>
    ${a.alertas.length ? `<h3>Alertas</h3>${a.alertas.map((t) => `<p class="alerta warn">${esc(t)}</p>`).join('')}` : ''}
    ${a.factoresEvaluacion.length ? `<h3>Factores de evaluación</h3><table class="tabla"><thead><tr><th>Factor</th><th class="num">Puntaje máx.</th><th>Criterio</th></tr></thead><tbody>
      ${a.factoresEvaluacion.map((f) => `<tr><td>${esc(f.factor)}</td><td class="num">${esc(f.puntajeMaximo)}</td><td>${esc(f.criterio)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${a.personalClave.length ? `<h3>Personal clave requerido</h3><table class="tabla"><thead><tr><th>Cargo</th><th>Formación</th><th>Experiencia</th></tr></thead><tbody>
      ${a.personalClave.map((f) => `<tr><td>${esc(f.cargo)}</td><td>${esc(f.formacion)}</td><td>${esc(f.experiencia)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${a.equipamiento.length ? `<h3>Equipamiento estratégico</h3><ul>${a.equipamiento.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${a.experienciaRequerida ? `<h3>Experiencia del postor</h3><p>${esc(a.experienciaRequerida)}</p>` : ''}
    ${a.garantias.length ? `<h3>Garantías</h3><ul>${a.garantias.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${a.penalidades ? `<h3>Penalidades</h3><p>${esc(a.penalidades)}</p>` : ''}
    <p class="ayuda">${a.requisitos.length} requisitos y ${a.cronograma.length} etapas de cronograma detectados.</p>
    <button class="btn primario" data-action="aplicar-analisis">Aplicar al proceso (datos, cronograma y requisitos)</button>
  </section>` : ''}
  ${seccionCumplimiento(p, b)}`;
}

function tabResumen(p, b) {
  return `
  <section class="tarjeta">
    <h2>Alertas</h2>
    ${alertasHtml(alertasProceso(p))}
  </section>
  <section class="tarjeta">
    <h2>Datos del procedimiento</h2>
    <div class="grid">
      ${campo(b + '.nomenclatura', 'Nomenclatura', { placeholder: 'LP-SM-1-2026-XXX-1' })}
      ${campo(b + '.entidad', 'Entidad convocante', { ancho: 'doble' })}
      <label class="campo"><span>Procedimiento</span><input list="lista-proc" data-bind="${b}.procedimiento" value="${esc(p.procedimiento)}"></label>
      <datalist id="lista-proc">${PROCEDIMIENTOS.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <label class="campo"><span>Sistema de contratación</span><input list="lista-sis" data-bind="${b}.sistema" value="${esc(p.sistema)}"></label>
      <datalist id="lista-sis">${SISTEMAS.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      ${campo(b + '.valorReferencial', 'Valor referencial / estimado', { tipo: 'number' })}
      ${selector(b + '.moneda', 'Moneda', { PEN: 'Soles (S/)', USD: 'Dólares (US$)' })}
      ${campo(b + '.plazoDias', 'Plazo de ejecución (días calendario)', { tipo: 'number' })}
      ${campo(b + '.lugar', 'Lugar de ejecución / entrega', { ancho: 'doble' })}
      ${selector(b + '.estado', 'Estado', ESTADOS)}
    </div>
    ${area(b + '.objeto', 'Objeto de la contratación', { filas: 2 })}
    ${casilla(b + '.consorcio', 'Postulo en consorcio')}
    ${area(b + '.notas', 'Notas internas', { filas: 3 })}
  </section>
  <section class="tarjeta">
    <h2>Cronograma</h2>
    <table class="tabla editable"><thead><tr><th>Etapa</th><th>Fecha</th><th></th><th></th></tr></thead><tbody>
    ${p.cronograma.map((c, j) => {
      const d = diasHasta(c.fecha);
      return `<tr><td>${celda(`${b}.cronograma.${j}.etapa`)}</td><td>${celda(`${b}.cronograma.${j}.fecha`, { tipo: 'date' })}</td>
      <td><small>${d === null ? '' : d > 0 ? `en ${d} días` : d === 0 ? 'hoy' : 'pasado'}</small></td>
      <td><button class="btn peligro" data-action="quitar" data-lista="${b}.cronograma" data-i="${j}">✕</button></td></tr>`;
    }).join('')}</tbody></table>
    <button class="btn" data-action="agregar" data-lista="${b}.cronograma">+ Agregar etapa</button>
  </section>`;
}

function tabRequisitos(p, b) {
  const grupos = CATEGORIAS_REQ.map((cat) => {
    const filas = p.requisitos.map((r, j) => ({ r, j })).filter(({ r }) => r.categoria === cat);
    return `<h3>${cat} <small>${filas.filter(({ r }) => r.cumple).length}/${filas.length}</small></h3>
    <table class="tabla editable req"><thead><tr><th>✓</th><th>Requisito</th><th>Ref. bases</th><th>Nota / documento</th><th></th></tr></thead><tbody>
    ${filas.map(({ r, j }) => `<tr class="${r.cumple ? 'hecho' : ''}">
      <td><input type="checkbox" data-bind="${b}.requisitos.${j}.cumple" data-rerender ${r.cumple ? 'checked' : ''}></td>
      <td><textarea class="celda" rows="2" data-bind="${b}.requisitos.${j}.texto">${esc(r.texto)}</textarea></td>
      <td>${celda(`${b}.requisitos.${j}.referencia`)}</td>
      <td>${celda(`${b}.requisitos.${j}.nota`)}</td>
      <td><button class="btn peligro" data-action="quitar" data-lista="${b}.requisitos" data-i="${j}">✕</button></td></tr>`).join('')}
    </tbody></table>
    <button class="btn" data-action="agregar-req" data-cat="${cat}">+ Agregar en ${cat}</button>`;
  }).join('');
  return `<section class="tarjeta">
    <h2>Checklist de requisitos <small>${avanceRequisitos(p)} % listo</small></h2>
    <p class="ayuda">Lista referencial para ${esc(TIPOS_OBJETO[p.tipoObjeto]).toLowerCase()}. Ajústala a lo que piden las bases integradas (o usa "Analizar bases con IA" para cargarla automáticamente).</p>
    ${grupos}</section>`;
}

function tabEconomica(p, b) {
  const pr = p.presupuesto;
  const ob = p.tipoObjeto === 'obra';
  return `
  <section class="tarjeta">
    <h2>${ob ? 'Presupuesto de obra' : 'Estructura de costos'}</h2>
    <p class="ayuda">${ob ? 'Ingresa partidas con metrado y precio unitario (del análisis de precios unitarios). Si es a suma alzada, respeta los metrados del expediente técnico.' : 'Detalla los componentes del costo. Puedes usar cantidad × costo unitario por cada rubro.'}</p>
    <div class="tabla-scroll"><table class="tabla editable">
      <thead><tr><th>Ítem</th><th>Descripción</th><th>Und.</th><th class="num">${ob ? 'Metrado' : 'Cantidad'}</th><th class="num">${ob ? 'P. unitario' : 'Costo unit.'}</th><th class="num">Parcial</th><th></th></tr></thead>
      <tbody>${pr.partidas.map((x, j) => `<tr>
        <td class="corto">${celda(`${b}.presupuesto.partidas.${j}.item`)}</td>
        <td>${celda(`${b}.presupuesto.partidas.${j}.descripcion`)}</td>
        <td class="corto">${celda(`${b}.presupuesto.partidas.${j}.unidad`)}</td>
        <td>${celda(`${b}.presupuesto.partidas.${j}.metrado`, { tipo: 'number', extra: 'data-recalc' })}</td>
        <td>${celda(`${b}.presupuesto.partidas.${j}.pu`, { tipo: 'number', extra: 'data-recalc' })}</td>
        <td class="num" id="parcial-${j}">${dinero((+x.metrado || 0) * (+x.pu || 0), p.moneda)}</td>
        <td><button class="btn peligro" data-action="quitar" data-lista="${b}.presupuesto.partidas" data-i="${j}">✕</button></td></tr>`).join('')}
      </tbody></table></div>
    <div class="fila"><button class="btn" data-action="agregar" data-lista="${b}.presupuesto.partidas">+ Agregar partida</button>
      <label class="btn">Importar CSV (ítem;descripción;und;metrado;pu)<input type="file" accept=".csv,text/csv" id="importar-csv" hidden></label></div>
  </section>
  <section class="tarjeta">
    <h2>Resumen de la oferta</h2>
    <div class="grid">
      ${campo(b + '.presupuesto.ggPct', 'Gastos generales (% del CD)', { tipo: 'number', extra: 'data-recalc' })}
      ${campo(b + '.presupuesto.utilidadPct', 'Utilidad (% del CD)', { tipo: 'number', extra: 'data-recalc' })}
      ${campo(b + '.presupuesto.igvPct', 'IGV (%) — 0 si está exonerado', { tipo: 'number', extra: 'data-recalc' })}
      ${campo(b + '.presupuesto.limInfPct', 'Límite inferior (% del VR)', { tipo: 'number', extra: 'data-recalc' })}
      ${campo(b + '.presupuesto.limSupPct', 'Límite superior (% del VR)', { tipo: 'number', extra: 'data-recalc' })}
      ${campo(b + '.presupuesto.garantiaPct', 'Garantía de fiel cumplimiento (%)', { tipo: 'number', extra: 'data-recalc' })}
    </div>
    <p class="ayuda">Los límites y porcentajes son referenciales: confírmalos en las bases integradas.</p>
    <div id="totales">${htmlTotales(p)}</div>
  </section>`;
}

function htmlTotales(p) {
  const t = calcularPresupuesto(p);
  const pr = p.presupuesto;
  const m = p.moneda;
  const fuera = t.pctVR !== null && t.total && ((pr.limInfPct && t.pctVR < pr.limInfPct) || (pr.limSupPct && t.pctVR > pr.limSupPct));
  return `<table class="tabla totales">
    <tr><td>Costo directo</td><td class="num">${dinero(t.cd, m)}</td></tr>
    <tr><td>Gastos generales (${pr.ggPct} %)</td><td class="num">${dinero(t.gg, m)}</td></tr>
    <tr><td>Utilidad (${pr.utilidadPct} %)</td><td class="num">${dinero(t.ut, m)}</td></tr>
    <tr><td>Subtotal</td><td class="num">${dinero(t.subtotal, m)}</td></tr>
    <tr><td>IGV (${pr.igvPct} %)</td><td class="num">${dinero(t.igv, m)}</td></tr>
    <tr class="total"><td>Monto de la oferta</td><td class="num">${dinero(t.total, m)}</td></tr>
    <tr><td colspan="2"><small>${numeroALetras(t.total, m)}</small></td></tr>
    <tr><td>Valor referencial</td><td class="num">${p.valorReferencial ? dinero(p.valorReferencial, m) : '—'}</td></tr>
    <tr class="${fuera ? 'rojo' : ''}"><td>Oferta respecto al VR</td><td class="num">${t.pctVR === null ? '—' : t.pctVR.toFixed(2) + ' %'}</td></tr>
    <tr><td>Garantía de fiel cumplimiento (${pr.garantiaPct} %)</td><td class="num">${dinero(t.garantia, m)}</td></tr>
  </table>`;
}

function tabTecnica(p, b) {
  const ia = IA.disponible();
  return `
  <section class="tarjeta">
    <h2>Propuesta técnica</h2>
    <p class="ayuda">Redacta cada sección o pide un borrador a la IA. La IA usa las bases, los datos del proceso y los de tu empresa; lo que falte lo marca como <code>[COMPLETAR: …]</code>.</p>
    ${ia ? '' : '<p class="alerta info">Para generar borradores con IA configura tu API key en <a href="#" data-action="ir" data-pagina="config">Configuración</a>.</p>'}
    <div class="fila"><button class="btn" data-action="agregar-seccion">+ Agregar sección</button>
      ${ia ? `<button class="btn primario" data-action="redactar-todas" ${Object.keys(iaOcupada).some((k) => k.startsWith('sec-')) ? 'disabled' : ''}>✨ Redactar secciones vacías</button>` : ''}</div>
  </section>
  ${p.tecnica.map((s, j) => {
    const ocupado = iaOcupada['sec-' + s.id];
    return `<section class="tarjeta seccion">
      <div class="fila entre">${celda(`${b}.tecnica.${j}.titulo`, { extra: 'aria-label="Título de la sección"' })}
        <span class="acciones">
          <button class="btn" data-action="mover" data-i="${j}" data-d="-1" title="Subir">↑</button>
          <button class="btn" data-action="mover" data-i="${j}" data-d="1" title="Bajar">↓</button>
          <button class="btn peligro" data-action="quitar" data-lista="${b}.tecnica" data-i="${j}" title="Eliminar sección">✕</button></span></div>
      <textarea rows="10" data-bind="${b}.tecnica.${j}.contenido" id="sec-${s.id}" placeholder="Contenido de la sección…" ${ocupado ? 'readonly' : ''}>${esc(s.contenido)}</textarea>
      ${ia ? `<div class="fila">
        <input class="celda crece" data-bind="${b}.tecnica.${j}.instrucciones" value="${esc(s.instrucciones || '')}" placeholder="Indicaciones para la IA (opcional): p. ej. enfatizar experiencia en zonas altoandinas">
        <button class="btn primario" data-action="redactar" data-i="${j}" ${ocupado ? 'disabled' : ''}>${ocupado ? 'Redactando…' : s.contenido.trim() ? '✨ Mejorar con IA' : '✨ Redactar con IA'}</button></div>` : ''}
    </section>`;
  }).join('')}`;
}

function tabDocumentos(p, b) {
  const lista = (clave, items, texto) => items.length ? items.map((x, j) => `<label class="casilla"><input type="checkbox" data-action-check="${clave}" data-id="${x.id}" ${p[clave].includes(x.id) ? 'checked' : ''}> ${texto(x)}</label>`).join('')
    : '<p class="ayuda">No hay registros en "Mi empresa".</p>';
  const expRel = state.experiencia.filter((x) => x.tipo === p.tipoObjeto);
  const ocupado = iaOcupada['revision-' + p.id];
  return `
  <section class="tarjeta">
    <h2>¿Qué incluir?</h2>
    <div class="columnas">
      <div><h3>Experiencia</h3>${lista('experienciaSel', expRel.length ? expRel : state.experiencia, (x) => `${esc(x.cliente || '—')} · ${esc((x.objeto || '').slice(0, 60))} · ${dinero(x.monto)}`)}</div>
      <div><h3>Personal clave</h3>${lista('personalSel', state.personal, (x) => `${esc(x.nombre || '—')} · ${esc(x.profesion || '')}`)}</div>
      <div><h3>Equipamiento</h3>${lista('equiposSel', state.equipos, (x) => `${esc(x.descripcion || '—')} (${esc(x.cantidad || 0)})`)}</div>
    </div>
  </section>
  <section class="tarjeta">
    <h2>Exportar</h2>
    <p class="ayuda">Genera los anexos con tus datos ya llenados, la propuesta técnica y la oferta económica. Descárgalos en Word para revisar, firmar y convertir a PDF antes de subirlos a la plataforma.</p>
    <p class="alerta warn">Los formatos son referenciales: usa la numeración y el texto exacto de los anexos de las bases estándar de tu procedimiento.</p>
    <div class="fila">
      <button class="btn primario" data-action="descargar-doc">⬇ Descargar para Word</button>
      ${Plataforma.enClaude ? '' : '<button class="btn" data-action="imprimir">🖨 Imprimir / guardar PDF</button>'}
      ${IA.disponible() ? `<button class="btn" data-action="revisar" ${ocupado ? 'disabled' : ''}>${ocupado ? 'Revisando…' : '✨ Revisar oferta con IA'}</button>` : ''}
    </div>
  </section>
  ${p.revision || ocupado ? `<section class="tarjeta"><h2>Revisión de la IA</h2><div id="revision-ia" class="documento">${textoAHtml(p.revision)}</div></section>` : ''}
  <section class="tarjeta">
    <h2>Vista previa</h2>
    <div class="documento">${documentosHtml(p).map((d) => `<article>${d}</article>`).join('<hr>')}</div>
  </section>`;
}

// ---------- Documentos de la oferta ----------

function documentosHtml(p) {
  const e = state.empresa;
  const t = calcularPresupuesto(p);
  const m = p.moneda;
  const fecha = `${esc(e.ciudad || '________')}, ${fechaLarga(hoyISO())}`;
  const firma = `<p class="firma">${fecha}</p><p class="firma-linea">………………………………………………<br>${esc(e.representante || '[Representante legal]')}<br>DNI ${esc(e.dniRepresentante || '________')}<br>Representante legal de ${esc(e.razonSocial || '[Razón social]')}</p>`;
  const senores = `<p>Señores<br><strong>COMITÉ DE SELECCIÓN / ÓRGANO ENCARGADO DE LAS CONTRATACIONES</strong><br>${esc(p.entidad || '[Entidad]')}<br>${esc(p.procedimiento || '[Procedimiento]')} N.° ${esc(p.nomenclatura || '[Nomenclatura]')}<br>Presente.-</p>`;
  const objeto = esc(p.objeto || '[objeto de la contratación]');
  const tipoTxt = { obra: 'la ejecución de la obra', servicio: 'la prestación del servicio', consultoria_obra: 'la consultoría de obra', bien: 'la entrega de los bienes' }[p.tipoObjeto];
  const docReq = { obra: 'el expediente técnico', servicio: 'los términos de referencia', consultoria_obra: 'los términos de referencia', bien: 'las especificaciones técnicas' }[p.tipoObjeto];
  const exp = state.experiencia.filter((x) => p.experienciaSel.includes(x.id));
  const per = state.personal.filter((x) => p.personalSel.includes(x.id));
  const eq = state.equipos.filter((x) => p.equiposSel.includes(x.id));
  const docs = [];

  docs.push(`<div class="caratula"><h1>OFERTA</h1><p>${esc(p.procedimiento)} N.° ${esc(p.nomenclatura)}</p>
    <p><strong>Objeto:</strong> ${objeto}</p><p><strong>Entidad:</strong> ${esc(p.entidad)}</p>
    <p><strong>Postor:</strong> ${esc(e.razonSocial)}<br>RUC ${esc(e.ruc)}</p></div>`);

  docs.push(`<h2>DECLARACIÓN JURADA DE DATOS DEL POSTOR</h2>${senores}
    <p>El que suscribe, ${esc(e.representante || '[nombre]')}, identificado con DNI N.° ${esc(e.dniRepresentante || '[DNI]')}, representante legal de ${esc(e.razonSocial || '[razón social]')}, con RUC N.° ${esc(e.ruc || '[RUC]')}, DECLARO BAJO JURAMENTO que la siguiente información se sujeta a la verdad:</p>
    <table class="tabla doc"><tbody>
      <tr><td>Nombre, denominación o razón social</td><td>${esc(e.razonSocial)}</td></tr>
      <tr><td>Domicilio legal</td><td>${esc(e.domicilio)}</td></tr>
      <tr><td>RUC</td><td>${esc(e.ruc)}</td></tr>
      <tr><td>Teléfono(s)</td><td>${esc(e.telefono)}</td></tr>
      <tr><td>MYPE</td><td>${e.mype ? 'Sí' : 'No'}</td></tr>
      <tr><td>Correo electrónico</td><td>${esc(e.email)}</td></tr>
    </tbody></table>
    <p>Autorizo que se me notifique al correo electrónico indicado las comunicaciones que se generen en el procedimiento y durante la ejecución contractual, de acuerdo con la normativa de contrataciones públicas.</p>${firma}`);

  docs.push(`<h2>DECLARACIÓN JURADA</h2>${senores}
    <p>Mediante el presente, el suscrito, postor y/o representante legal de ${esc(e.razonSocial || '[razón social]')}, declaro bajo juramento:</p>
    <ol>
      <li>No tener impedimento para postular en el procedimiento de selección ni para contratar con el Estado, conforme a la Ley N.° 32069, Ley General de Contrataciones Públicas, y su Reglamento.</li>
      <li>Conocer las sanciones contenidas en la Ley N.° 32069 y su Reglamento, así como las disposiciones aplicables del TUO de la Ley N.° 27444, Ley del Procedimiento Administrativo General.</li>
      <li>Participar en el presente proceso de contratación en forma independiente, sin mediar consulta, comunicación, acuerdo, arreglo o convenio con ningún proveedor; y conocer las disposiciones del Decreto Legislativo N.° 1034.</li>
      <li>Conocer, aceptar y someterme a las bases, condiciones y reglas del procedimiento de selección.</li>
      <li>Ser responsable de la veracidad de los documentos e información que presento en el procedimiento.</li>
      <li>Comprometerme a mantener la oferta presentada durante el procedimiento de selección y a perfeccionar el contrato en caso de resultar favorecido con la buena pro.</li>
    </ol>${firma}`);

  docs.push(`<h2>DECLARACIÓN JURADA DE CUMPLIMIENTO DE ${docReq.toUpperCase()}</h2>${senores}
    <p>Es grato dirigirme a usted, para hacer de su conocimiento que luego de haber examinado las bases y demás documentos del procedimiento de la referencia y, conociendo todos los alcances y las condiciones detalladas en dichos documentos, el postor que suscribe ofrece ${tipoTxt} de <strong>${objeto}</strong>, de conformidad con ${docReq} que se indican en la sección específica de las bases y los documentos del procedimiento.</p>${firma}`);

  docs.push(`<h2>DECLARACIÓN JURADA DE PLAZO DE ${p.tipoObjeto === 'bien' ? 'ENTREGA' : 'EJECUCIÓN'}</h2>${senores}
    <p>Mediante el presente, con pleno conocimiento de las condiciones que se exigen en las bases del procedimiento de la referencia, me comprometo a ${tipoTxt} objeto del presente procedimiento de selección en el plazo de <strong>${esc(p.plazoDias || '[__]')} días calendario</strong>.</p>${firma}`);

  if (p.consorcio) {
    docs.push(`<h2>PROMESA DE CONSORCIO</h2>${senores}
      <p>Los suscritos declaramos expresamente que hemos convenido en forma irrevocable, durante el lapso que dure el procedimiento de selección, para presentar una oferta conjunta al ${esc(p.procedimiento)} N.° ${esc(p.nomenclatura)}.</p>
      <p>Asimismo, en caso de obtener la buena pro, nos comprometemos a formalizar el contrato de consorcio, de conformidad con lo establecido por la normativa y las bases, bajo las siguientes condiciones:</p>
      <ol><li>Integrantes del consorcio: [COMPLETAR: razón social y RUC de cada consorciado]</li>
      <li>Designamos a [COMPLETAR] como representante común del consorcio.</li>
      <li>Domicilio común del consorcio: [COMPLETAR]</li>
      <li>Correo electrónico común del consorcio: [COMPLETAR]</li>
      <li>Obligaciones de cada integrante y porcentaje de participación: [COMPLETAR] (total 100 %).</li></ol>
      <p>${fecha}</p><p class="firma-linea">Firmas legalizadas de los representantes legales de cada consorciado</p>`);
  }

  docs.push(`<h2>PRECIO DE LA OFERTA</h2>${senores}
    <p>Es grato dirigirme a usted, para hacer de su conocimiento que, de acuerdo con las bases, mi oferta es la siguiente:</p>
    <table class="tabla doc"><thead><tr><th>Concepto</th><th class="num">Precio total</th></tr></thead><tbody>
      <tr><td>${objeto}</td><td class="num">${dinero(t.total, m)}</td></tr>
      <tr><td><strong>TOTAL</strong></td><td class="num"><strong>${dinero(t.total, m)}</strong></td></tr></tbody></table>
    <p>SON: ${numeroALetras(t.total, m)}</p>
    <p>El precio de la oferta incluye todos los tributos, seguros, transporte, inspecciones, pruebas y, de ser el caso, los costos laborales conforme a la legislación vigente, así como cualquier otro concepto que pueda tener incidencia sobre el costo de ${tipoTxt}.${+p.presupuesto.igvPct ? '' : ' (Postor exonerado del IGV: [COMPLETAR sustento]).'}</p>${firma}`);

  if (p.presupuesto.partidas.length) {
    docs.push(`<h2>${p.tipoObjeto === 'obra' ? 'PRESUPUESTO DE OBRA' : 'ESTRUCTURA DE COSTOS'}</h2>
      <table class="tabla doc"><thead><tr><th>Ítem</th><th>Descripción</th><th>Und.</th><th class="num">Cant.</th><th class="num">P. unit.</th><th class="num">Parcial</th></tr></thead><tbody>
      ${p.presupuesto.partidas.map((x) => `<tr><td>${esc(x.item)}</td><td>${esc(x.descripcion)}</td><td>${esc(x.unidad)}</td><td class="num">${esc(x.metrado)}</td><td class="num">${dinero(x.pu, m)}</td><td class="num">${dinero((+x.metrado || 0) * (+x.pu || 0), m)}</td></tr>`).join('')}
      <tr><td colspan="5">Costo directo</td><td class="num">${dinero(t.cd, m)}</td></tr>
      <tr><td colspan="5">Gastos generales (${p.presupuesto.ggPct} %)</td><td class="num">${dinero(t.gg, m)}</td></tr>
      <tr><td colspan="5">Utilidad (${p.presupuesto.utilidadPct} %)</td><td class="num">${dinero(t.ut, m)}</td></tr>
      <tr><td colspan="5">Subtotal</td><td class="num">${dinero(t.subtotal, m)}</td></tr>
      <tr><td colspan="5">IGV (${p.presupuesto.igvPct} %)</td><td class="num">${dinero(t.igv, m)}</td></tr>
      <tr><td colspan="5"><strong>Total</strong></td><td class="num"><strong>${dinero(t.total, m)}</strong></td></tr>
      </tbody></table>`);
  }

  if (exp.length) {
    const total = exp.reduce((s, x) => s + (+x.monto || 0), 0);
    docs.push(`<h2>EXPERIENCIA DEL POSTOR EN LA ESPECIALIDAD</h2>${senores}
      <p>Mediante el presente, el suscrito detalla la siguiente experiencia en la especialidad:</p>
      <table class="tabla doc"><thead><tr><th>N.°</th><th>Cliente</th><th>Objeto del contrato</th><th>Sustento</th><th>Fecha de conformidad</th><th class="num">Monto</th></tr></thead><tbody>
      ${exp.map((x, j) => `<tr><td>${j + 1}</td><td>${esc(x.cliente)}</td><td>${esc(x.objeto)}</td><td>${esc(x.sustento)}</td><td>${esc(fechaLarga(x.fecha))}</td><td class="num">${dinero(x.monto)}</td></tr>`).join('')}
      <tr><td colspan="5"><strong>TOTAL</strong></td><td class="num"><strong>${dinero(total)}</strong></td></tr></tbody></table>${firma}`);
  }

  if (per.length) {
    docs.push(`<h2>PERSONAL CLAVE PROPUESTO</h2>
      <table class="tabla doc"><thead><tr><th>Nombre</th><th>DNI</th><th>Profesión</th><th>Colegiatura</th><th>Cargo</th><th class="num">Años exp.</th></tr></thead><tbody>
      ${per.map((x) => `<tr><td>${esc(x.nombre)}</td><td>${esc(x.dni)}</td><td>${esc(x.profesion)}</td><td>${esc(x.colegiatura)}</td><td>${esc(x.cargo)}</td><td class="num">${esc(x.anios)}</td></tr>`).join('')}
      </tbody></table>`);
    per.forEach((x) => docs.push(`<h2>CARTA DE COMPROMISO DEL PERSONAL CLAVE</h2>${senores}
      <p>Yo, ${esc(x.nombre)}, identificado con DNI N.° ${esc(x.dni || '[DNI]')}, ${esc(x.profesion)}${x.colegiatura ? ' con registro de colegiatura N.° ' + esc(x.colegiatura) : ''}, me comprometo a prestar mis servicios en el cargo de ${esc(x.cargo || '[cargo]')} para ${tipoTxt} de ${objeto}, en caso de que el postor ${esc(e.razonSocial)} resulte favorecido con la buena pro y suscriba el contrato correspondiente.</p>
      <p>Declaro que no tengo compromisos que me impidan cumplir con la participación comprometida durante el plazo de ejecución.</p>
      <p>${fecha}</p><p class="firma-linea">………………………………………………<br>${esc(x.nombre)}<br>DNI ${esc(x.dni)}</p>`));
  }

  if (eq.length) {
    docs.push(`<h2>EQUIPAMIENTO ESTRATÉGICO</h2>
      <table class="tabla doc"><thead><tr><th>Descripción</th><th>Marca / modelo</th><th class="num">Cant.</th><th>Tenencia</th><th>Sustento</th></tr></thead><tbody>
      ${eq.map((x) => `<tr><td>${esc(x.descripcion)}</td><td>${esc(x.modelo)}</td><td class="num">${esc(x.cantidad)}</td><td>${esc(x.tenencia)}</td><td>${esc(x.sustento)}</td></tr>`).join('')}
      </tbody></table>`);
  }

  const secciones = p.tecnica.filter((s) => s.contenido.trim());
  if (secciones.length) {
    docs.push(`<h2>PROPUESTA TÉCNICA</h2>${secciones.map((s, j) => `<h3>${j + 1}. ${esc(s.titulo)}</h3>${textoAHtml(s.contenido)}`).join('')}`);
  }
  return docs;
}

const ESTILO_DOC = `body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.4;color:#000}
h1{text-align:center;font-size:20pt}h2{text-align:center;font-size:12pt;margin-top:0}h3{font-size:11pt}h4{font-size:11pt;margin-bottom:2pt}
table{border-collapse:collapse;width:100%;margin:8pt 0}td,th{border:1px solid #000;padding:3pt 5pt;vertical-align:top;font-size:10pt}
.num{text-align:right}.firma{margin-top:24pt}.firma-linea{margin-top:40pt;text-align:center}.caratula{text-align:center;margin-top:120pt}
.caratula p{font-size:13pt}`;

function documentoCompleto(p) {
  const salto = '<br clear="all" style="page-break-before:always">';
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Oferta ${esc(p.nomenclatura)}</title><style>${ESTILO_DOC}</style></head>
<body>${documentosHtml(p).join(salto)}</body></html>`;
}

const nombreArchivo = (p) => (p.nomenclatura || 'oferta').replace(/[^\w.-]+/g, '_');

// ---------- Contexto para la IA ----------

function contextoIA(p) {
  const e = state.empresa;
  const exp = state.experiencia.filter((x) => !p.experienciaSel.length || p.experienciaSel.includes(x.id));
  const per = state.personal.filter((x) => !p.personalSel.length || p.personalSel.includes(x.id));
  const eq = state.equipos.filter((x) => !p.equiposSel.length || p.equiposSel.includes(x.id));
  const t = calcularPresupuesto(p);
  const datos = {
    procedimiento: {
      nomenclatura: p.nomenclatura, entidad: p.entidad, objeto: p.objeto, tipo: TIPOS_OBJETO[p.tipoObjeto],
      procedimiento: p.procedimiento, sistema: p.sistema, valorReferencial: p.valorReferencial, moneda: p.moneda,
      plazoDias: p.plazoDias, lugar: p.lugar, cronograma: p.cronograma,
    },
    analisisDeBases: p.analisis || 'no disponible',
    postor: {
      razonSocial: e.razonSocial, ruc: e.ruc, mype: e.mype, rnpVigencia: e.rnpVigencia,
      capitulosRNP: Object.keys(e.rnpCapitulos).filter((k) => e.rnpCapitulos[k]).map((k) => NOMBRE_CAPITULO[k]),
      capacidadMaxContratacion: e.capacidadMaxContratacion,
      experiencia: exp.map(({ id, archivos, ...x }) => ({ ...x, clasificacion: (p.clasif || {})[id] || '' })),
      personalClave: per.map(({ id, documentos, ...x }) => ({
        ...x,
        documentos: (documentos || []).map((d) => d.nombre),
        experiencias: (x.experiencias || []).map(({ archivos, ...e }) => ({ ...e, meses: mesesEntre(e.inicio, e.fin), clasificacion: (p.clasif || {})[e.id] || '' })),
      })),
      equipamiento: eq.map(({ id, ...x }) => x),
    },
    ofertaEconomica: { montoTotal: t.total, porcentajeDelVR: t.pctVR },
    requisitos: p.requisitos.map((r) => ({ categoria: r.categoria, requisito: r.texto, listo: r.cumple, nota: r.nota })),
    seccionesPropuestaTecnica: p.tecnica.map((s) => s.titulo),
  };
  return `Datos del procedimiento y del postor (JSON):\n<datos>\n${JSON.stringify(datos, null, 1)}\n</datos>`;
}

function fuenteIA(p) {
  const pdf = pdfEnMemoria[p.id];
  return { pdfBase64: pdf && pdf.base64, pdfNombre: pdf && pdf.nombre, texto: p.basesTexto };
}

// ---------- Acciones ----------

const procesoActual = () => state.procesos.find((p) => p.id === vista.procesoId);

const acciones = {
  ir({ pagina }) { vista.pagina = pagina; render(); window.scrollTo(0, 0); },
  tab({ tab }) { vista.tab = tab; render(); },
  'crear-proceso'() {
    const tipo = document.getElementById('nuevo-tipo').value;
    const p = nuevoProceso(tipo);
    state.procesos.unshift(p);
    guardar();
    Object.assign(vista, { pagina: 'proceso', procesoId: p.id, tab: 'bases' });
    render();
  },
  abrir({ id }) { Object.assign(vista, { pagina: 'proceso', procesoId: id, tab: 'resumen' }); render(); window.scrollTo(0, 0); },
  async 'eliminar-proceso'({ id }) {
    const p = state.procesos.find((x) => x.id === id);
    if (!await confirmar(`¿Eliminar el proceso "${p.nomenclatura || 'sin nomenclatura'}"? Esta acción no se puede deshacer.`)) return;
    state.procesos = state.procesos.filter((x) => x.id !== id);
    guardar();
    render();
  },
  agregar({ lista }) {
    const plantillas = {
      experiencia: { cliente: '', objeto: '', tipo: 'obra', especialidad: '', monto: 0, fecha: '', sustento: '' },
      personal: { nombre: '', dni: '', profesion: '', colegiatura: '', cargo: '', anios: 0, detalle: '' },
      equipos: { descripcion: '', modelo: '', cantidad: 1, tenencia: 'Propio', sustento: '' },
    };
    const arr = getPath(state, lista);
    const clave = lista.split('.').pop();
    let nuevo = plantillas[clave];
    if (clave === 'cronograma') nuevo = { etapa: '', fecha: '' };
    if (clave === 'partidas') nuevo = { item: String(arr.length + 1).padStart(2, '0'), descripcion: '', unidad: '', metrado: 0, pu: 0 };
    arr.push({ id: uid(), ...nuevo });
    guardar();
    render();
  },
  async quitar({ lista, i }) {
    const arr = getPath(state, lista);
    const x = arr[+i];
    const vacio = Object.entries(x).every(([k, v]) => k === 'id' || !v || k === 'tipo' || k === 'tenencia' || k === 'categoria');
    if (!vacio && !await confirmar('¿Quitar este elemento?', { si: 'Quitar' })) return;
    arr.splice(+i, 1);
    guardar();
    render();
  },
  'agregar-req'({ cat }) {
    procesoActual().requisitos.push({ id: uid(), categoria: cat, texto: '', referencia: '', cumple: false, nota: '' });
    guardar();
    render();
  },
  'agregar-seccion'() {
    procesoActual().tecnica.push({ id: uid(), titulo: 'Nueva sección', contenido: '', instrucciones: '' });
    guardar();
    render();
  },
  mover({ i, d }) {
    const arr = procesoActual().tecnica;
    const a = +i;
    const b = a + +d;
    if (b < 0 || b >= arr.length) return;
    [arr[a], arr[b]] = [arr[b], arr[a]];
    guardar();
    render();
  },
  'quitar-pdf'() { delete pdfEnMemoria[vista.procesoId]; render(); },
  async analizar() {
    const p = procesoActual();
    const clave = 'analisis-' + p.id;
    iaOcupada[clave] = true;
    render();
    try {
      p.analisis = await IA.analizarBases(state.config, fuenteIA(p));
      guardar();
    } catch (e) {
      if (IA.describirError(e)) avisar('No se pudo analizar: ' + IA.describirError(e));
    } finally {
      delete iaOcupada[clave];
      render();
    }
  },
  async 'aplicar-analisis'() {
    const p = procesoActual();
    const a = p.analisis;
    if (!a) return;
    const setSi = (k, v) => { if (v) p[k] = v; };
    setSi('nomenclatura', a.nomenclatura);
    setSi('entidad', a.entidad);
    setSi('objeto', a.objeto);
    setSi('procedimiento', a.procedimiento);
    setSi('sistema', a.sistemaContratacion);
    setSi('valorReferencial', a.valorReferencial);
    setSi('plazoDias', a.plazoEjecucionDias);
    setSi('lugar', a.lugar);
    if (/USD|D[ÓO]LAR/i.test(a.moneda || '')) p.moneda = 'USD';
    if (a.cronograma.length) p.cronograma = a.cronograma.map((c) => ({ etapa: c.etapa, fecha: /^\d{4}-\d{2}-\d{2}$/.test(c.fecha) ? c.fecha : '', original: c.fecha }));
    if (a.requisitos.length) {
      const reemplazar = await confirmar(`Se detectaron ${a.requisitos.length} requisitos en las bases. ¿Reemplazo la lista referencial por la de las bases, o los agrego a la lista actual?`, { si: 'Reemplazar', no: 'Agregar' });
      const nuevos = a.requisitos.map((r) => ({ id: uid(), categoria: r.categoria, texto: r.texto, referencia: r.referencia, cumple: false, nota: '' }));
      p.requisitos = reemplazar ? nuevos : [...p.requisitos, ...nuevos];
    }
    if (a.tipoObjeto && a.tipoObjeto !== p.tipoObjeto) {
      avisar(`Las bases indican que el objeto es "${TIPOS_OBJETO[a.tipoObjeto]}", pero el proceso se creó como "${TIPOS_OBJETO[p.tipoObjeto]}". Si es un error, crea un nuevo proceso del tipo correcto.`);
    }
    guardar();
    vista.tab = 'resumen';
    render();
  },
  async redactar({ i }) {
    const p = procesoActual();
    await redactarSeccion(p, p.tecnica[+i]);
  },
  async 'redactar-todas'() {
    const p = procesoActual();
    for (const s of p.tecnica.filter((x) => !x.contenido.trim())) {
      const ok = await redactarSeccion(p, s);
      if (!ok) break;
    }
  },
  async revisar() {
    const p = procesoActual();
    const clave = 'revision-' + p.id;
    iaOcupada[clave] = true;
    p.revision = '';
    render();
    try {
      p.revision = await IA.revisarOferta(state.config, { fuente: fuenteIA(p), contexto: contextoIA(p) }, (delta) => {
        p.revision += delta;
        const el = document.getElementById('revision-ia');
        if (el) el.innerHTML = textoAHtml(p.revision);
      });
      guardar();
    } catch (e) {
      if (IA.describirError(e)) avisar('No se pudo revisar: ' + IA.describirError(e));
    } finally {
      delete iaOcupada[clave];
      render();
    }
  },
  'descargar-doc'() {
    const p = procesoActual();
    // claude.ai no admite .doc: allí se descarga como .html, que Word también abre.
    if (Plataforma.enClaude) descargar(`Oferta_${nombreArchivo(p)}.html`, documentoCompleto(p), 'text/html');
    else descargar(`Oferta_${nombreArchivo(p)}.doc`, documentoCompleto(p), 'application/msword');
  },
  imprimir() {
    const p = procesoActual();
    const w = window.open('', '_blank');
    if (!w) { avisar('Permite las ventanas emergentes para imprimir.'); return; }
    w.document.write(documentoCompleto(p).replace('</style>', '@page{margin:2cm}</style>'));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  },
  'exportar-json'() {
    descargar(`respaldo-propuestas-${hoyISO()}.json`, JSON.stringify(state, null, 1), 'application/json');
  },
  'guardar-key'() {
    guardarApiKey(document.getElementById('api-key').value.trim(), state.config.recordarKey);
    avisar(leerApiKey() ? 'API key guardada.' : 'API key borrada.');
    render();
  },
  'borrar-key'() { guardarApiKey('', false); render(); },
};

async function redactarSeccion(p, s) {
  const clave = 'sec-' + s.id;
  if (iaOcupada[clave]) return false;
  iaOcupada[clave] = true;
  const anterior = s.contenido;
  render();
  let texto = '';
  try {
    s.contenido = '';
    const final = await IA.redactarSeccion(state.config, {
      fuente: fuenteIA(p), contexto: contextoIA(p), seccion: s.titulo, instrucciones: s.instrucciones, borradorActual: anterior,
    }, (delta) => {
      texto += delta;
      const el = document.getElementById('sec-' + s.id);
      if (el) el.value = texto;
    });
    s.contenido = final.trim();
    guardar();
    return true;
  } catch (e) {
    s.contenido = anterior;
    if (IA.describirError(e)) avisar(`No se pudo redactar "${s.titulo}": ` + IA.describirError(e));
    return false;
  } finally {
    delete iaOcupada[clave];
    render();
  }
}

function recalcular() {
  const p = procesoActual();
  if (!p) return;
  p.presupuesto.partidas.forEach((x, j) => {
    const el = document.getElementById('parcial-' + j);
    if (el) el.textContent = dinero((+x.metrado || 0) * (+x.pu || 0), p.moneda);
  });
  const t = document.getElementById('totales');
  if (t) t.innerHTML = htmlTotales(p);
}

// ---------- Eventos ----------

function alCambiar(ev) {
  const el = ev.target;
  if (el.dataset.actionCheck) {
    if (ev.type !== 'change') return;
    const p = procesoActual();
    const arr = p[el.dataset.actionCheck];
    const i = arr.indexOf(el.dataset.id);
    if (el.checked && i < 0) arr.push(el.dataset.id);
    if (!el.checked && i >= 0) arr.splice(i, 1);
    guardar();
    render();
    return;
  }
  const path = el.dataset.bind;
  if (!path) return;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.dataset.type === 'number') v = el.value === '' ? 0 : parseFloat(el.value) || 0;
  else v = el.value;
  setPath(state, path, v);
  guardar();
  if (el.dataset.recalc !== undefined) recalcular();
  if (ev.type === 'change' && el.dataset.rerender !== undefined) render();
}

document.addEventListener('input', alCambiar);
document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.id === 'importar-json') return importarJson(el);
  if (el.id === 'subir-pdf') return subirPdf(el);
  if (el.id === 'importar-csv') return importarCsv(el);
  if (el.dataset.subir) return subirArchivo(el);
  alCambiar(ev);
});

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-action]');
  if (!b || b.disabled) return;
  ev.preventDefault();
  const fn = acciones[b.dataset.action];
  if (fn) fn(b.dataset, b);
});

function leerArchivo(archivo, comoDataUrl) {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => mal(r.error);
    comoDataUrl ? r.readAsDataURL(archivo) : r.readAsText(archivo);
  });
}

async function importarJson(input) {
  const f = input.files[0];
  if (!f) return;
  try {
    const datos = JSON.parse(await leerArchivo(f));
    if (!datos.empresa || !Array.isArray(datos.procesos)) throw new Error('El archivo no parece un respaldo de esta app.');
    if (!await confirmar('Esto reemplazará todos los datos actuales por los del respaldo. ¿Continuar?', { si: 'Restaurar' })) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(datos));
    state = cargar();
    render();
  } catch (e) {
    avisar('No se pudo restaurar: ' + e.message);
  } finally {
    input.value = '';
  }
}

async function subirPdf(input) {
  const f = input.files[0];
  if (!f) return;
  if (f.size > 30 * 1048576) {
    avisar('El PDF supera 30 MB. Divide el documento o pega solo las secciones relevantes como texto.');
    input.value = '';
    return;
  }
  input.value = '';
  if (/\.docx$/i.test(f.name)) {
    const p = procesoActual();
    const texto = await textoDeDocx(f);
    p.basesTexto = (p.basesTexto ? p.basesTexto + '\n\n' : '') + texto;
    guardar();
    render();
    return;
  }
  const dataUrl = await leerArchivo(f, true);
  pdfEnMemoria[vista.procesoId] = { nombre: f.name, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
  render();
}

async function importarCsv(input) {
  const f = input.files[0];
  if (!f) return;
  const p = procesoActual();
  const texto = await leerArchivo(f);
  const num = (s) => parseFloat(String(s || '').replace(/\s/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.')) || 0;
  const filas = texto.split(/\r?\n/).map((l) => l.split(/;|\t/)).filter((c) => c.length >= 5 && c[1]);
  const nuevas = filas.filter((c) => num(c[3]) || num(c[4])).map((c) => ({
    id: uid(), item: c[0].trim(), descripcion: c[1].trim(), unidad: c[2].trim(), metrado: num(c[3]), pu: num(c[4]),
  }));
  input.value = '';
  if (!nuevas.length) { avisar('No se encontraron filas válidas. Formato esperado por línea: ítem;descripción;unidad;metrado;precio unitario'); return; }
  const reemplazar = await confirmar(`Se leyeron ${nuevas.length} partidas. ¿Reemplazo las partidas actuales o las agrego al final?`, { si: 'Reemplazar', no: 'Agregar al final' });
  p.presupuesto.partidas = reemplazar ? nuevas : [...p.presupuesto.partidas, ...nuevas];
  guardar();
  render();
}

// ---------- Render ----------

function render() {
  const app = document.getElementById('app');
  const vistas = { inicio: vInicio, empresa: vEmpresa, config: vConfig, proceso: vProceso, profesionales: vProfesionales, oportunidades: vOportunidades };
  // Conserva el foco y la posición del cursor si el usuario estaba escribiendo.
  const activo = document.activeElement;
  const bind = activo && activo.dataset && activo.dataset.bind;
  const sel = bind && 'selectionStart' in activo ? [activo.selectionStart, activo.selectionEnd] : null;
  app.innerHTML = (vistas[vista.pagina] || vInicio)();
  document.querySelectorAll('header nav [data-pagina]').forEach((a) => {
    a.classList.toggle('activo', a.dataset.pagina === vista.pagina || (vista.pagina === 'proceso' && a.dataset.pagina === 'inicio'));
  });
  if (bind) {
    const el = app.querySelector(`[data-bind="${CSS.escape(bind)}"]`);
    if (el) {
      el.focus();
      try { if (sel) el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* inputs sin selección */ }
    }
  }
}

document.addEventListener('DOMContentLoaded', render);

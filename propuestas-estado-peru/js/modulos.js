'use strict';
// Módulos: profesionales y CV, sustentos, hoja membretada, anexos, clasificación de experiencia,
// evaluación de cumplimiento, expediente foliado y búsqueda de oportunidades.

// ---------- Utilidades comunes ----------

async function conIA(clave, fn) {
  if (iaOcupada[clave]) return;
  iaOcupada[clave] = true;
  render();
  try {
    await fn();
  } catch (e) {
    if (IA.describirError(e)) alert(IA.describirError(e));
  } finally {
    delete iaOcupada[clave];
    guardar();
    render();
  }
}

function botonIA(accion, texto, clave, extra = '') {
  const ocupado = iaOcupada[clave];
  if (!IA.disponible()) return `<span class="ayuda">✨ ${esc(texto)}: configura tu API key en <a href="#" data-action="ir" data-pagina="config">Configuración</a>.</span>`;
  const espera = IA.modo() === 'plan' ? '⏳ Esperando la respuesta de Claude…' : '⏳ Procesando… (puede tardar unos minutos)';
  return `<button class="btn primario" data-action="${accion}" ${extra} ${ocupado ? 'disabled' : ''}>${ocupado ? espera : '✨ ' + esc(texto)}</button>`;
}

function botonImportarCV(tipo, texto) {
  const clave = 'cv-' + tipo;
  if (!IA.disponible()) return `<p class="ayuda">✨ ${esc(texto)}: configura tu API key en <a href="#" data-action="ir" data-pagina="config">Configuración</a>.</p>`;
  return `<div class="fila">${iaOcupada[clave] ? `<span class="btn" aria-busy="true">⏳ ${IA.modo() === 'plan' ? 'Esperando la respuesta de Claude…' : 'Leyendo el CV y separando experiencias…'}</span>`
    : `<label class="btn primario">✨ ${esc(texto)}<input type="file" hidden accept="application/pdf,.docx" data-subir="${tipo}"></label>`}
    <span class="ayuda">PDF o Word. Revisa lo que extrae la IA antes de usarlo.</span></div>`;
}

function chipsArchivos(path) {
  const lista = getPath(state, path) || [];
  return `<div class="chips">${lista.map((f, k) => `<span class="chip"><a href="#" data-action="ver-archivo" data-id="${f.archivoId}" title="${esc(f.nombre)}">${esc(f.nombre.length > 22 ? f.nombre.slice(0, 20) + '…' : f.nombre)}</a><button class="btn-link" data-action="quitar-archivo" data-lista="${path}" data-i="${k}" title="Quitar">✕</button></span>`).join('')}
    <label class="btn chico" title="Adjuntar PDF o imagen">📎<input type="file" hidden multiple accept="application/pdf,image/*" data-subir="adjuntar" data-lista="${path}"></label></div>`;
}

function opcionesPerfil(seleccionado) {
  const ops = [['empresa', `Empresa: ${state.empresa.razonSocial || '(sin nombre)'}`], ...state.personal.map((x) => [x.id, `Profesional: ${x.nombre || '(sin nombre)'}`])];
  return ops.map(([k, t]) => `<option value="${k}" ${k === seleccionado ? 'selected' : ''}>${esc(t)}</option>`).join('');
}

function catalogoDocumentos() {
  return [
    ...state.docsEmpresa.map((d) => ({ ...d, duenio: state.empresa.razonSocial || 'Empresa' })),
    ...state.personal.flatMap((x) => (x.documentos || []).map((d) => ({ ...d, duenio: x.nombre || 'Profesional' }))),
  ];
}

function nombreDocumento(archivoId) {
  const d = catalogoDocumentos().find((x) => x.archivoId === archivoId);
  return d ? `${d.nombre} - ${d.duenio}` : 'Documento';
}

function perfilDe(clave) {
  const e = state.empresa;
  if (clave === 'empresa' || !clave) {
    return {
      tipo: 'empresa', razonSocial: e.razonSocial, ruc: e.ruc, mype: e.mype, rnpVigencia: e.rnpVigencia,
      capitulosRNP: Object.keys(e.rnpCapitulos).filter((k) => e.rnpCapitulos[k]).map((k) => NOMBRE_CAPITULO[k]),
      capacidadMaxContratacion: e.capacidadMaxContratacion,
      experiencia: state.experiencia.map(({ id, archivos, ...x }) => ({ ...x, sustentosAdjuntos: (archivos || []).length })),
      equipamiento: state.equipos.map(({ id, ...x }) => x),
      documentosDisponibles: state.docsEmpresa.map((d) => d.nombre),
      profesionalesDisponibles: state.personal.map((x) => ({ nombre: x.nombre, profesion: x.profesion, mesesExperiencia: mesesSinTraslape(x.experiencias || []) })),
    };
  }
  const x = state.personal.find((y) => y.id === clave);
  if (!x) return {};
  return {
    tipo: 'profesional (persona natural)', nombre: x.nombre, profesion: x.profesion, colegiatura: x.colegiatura,
    fechaColegiatura: x.fechaColegiatura, formacion: x.formacion, capacitaciones: x.capacitaciones,
    documentosDisponibles: (x.documentos || []).map((d) => d.nombre),
    experiencias: (x.experiencias || []).map(({ id, archivos, ...y }) => ({ ...y, meses: mesesEntre(y.inicio, y.fin), sustentosAdjuntos: (archivos || []).length })),
    mesesExperienciaTotalSinTraslape: mesesSinTraslape(x.experiencias || []),
  };
}

function contextoAnexos(p) {
  const postor = p.perfilEval && p.perfilEval !== 'empresa'
    ? { tipo: 'persona natural', ...state.personal.find((x) => x.id === p.perfilEval) }
    : { tipo: 'persona jurídica', ...state.empresa };
  delete postor.experiencias;
  delete postor.documentos;
  return `${contextoIA(p)}

Datos completos del postor para llenar los formatos (JSON):
<postor>
${JSON.stringify(postor, null, 1)}
</postor>
Monto de la oferta: ${dinero(calcularPresupuesto(p).total, p.moneda)} (${numeroALetras(calcularPresupuesto(p).total, p.moneda)}). Postula en consorcio: ${p.consorcio ? 'sí' : 'no'}.`;
}

// ---------- Mi empresa: hoja membretada y documentos ----------

function seccionMembrete() {
  const m = state.membrete;
  return `<section class="tarjeta">
    <h2>Hoja membretada</h2>
    <p class="ayuda">Sube tu hoja membretada en Word (.docx): los separadores y anexos se generan sobre ella, conservando encabezado, pie de página y márgenes. Para que el PDF final salga idéntico, sube también la misma hoja guardada como PDF (en Word: Archivo → Guardar como → PDF).</p>
    <div class="fila">
      ${m.docxId ? `<span class="chip">📄 <a href="#" data-action="ver-archivo" data-id="${m.docxId}">${esc(m.docxNombre)}</a><button class="btn-link" data-action="quitar-membrete" data-cual="docx">✕</button></span>`
        : '<label class="btn">Subir hoja membretada (Word)<input type="file" hidden accept=".docx" data-subir="membrete-docx"></label>'}
      ${m.pdfId ? `<span class="chip">📕 <a href="#" data-action="ver-archivo" data-id="${m.pdfId}">${esc(m.pdfNombre)}</a><button class="btn-link" data-action="quitar-membrete" data-cual="pdf">✕</button></span>`
        : '<label class="btn">Subir la misma hoja en PDF (opcional)<input type="file" hidden accept="application/pdf" data-subir="membrete-pdf"></label>'}
      <button class="btn" data-action="probar-separador">Probar: descargar un separador</button>
    </div>
    <p class="ayuda">Deja el cuerpo de la hoja membretada vacío: todo lo que esté en el cuerpo se reemplaza; el encabezado y el pie se conservan.</p>
  </section>`;
}

function tablaDocumentos(path, vacio) {
  const lista = getPath(state, path) || [];
  return `${lista.length ? `<table class="tabla editable"><thead><tr><th>Nombre del documento</th><th>Archivo</th><th></th></tr></thead><tbody>
    ${lista.map((d, k) => `<tr><td>${celda(`${path}.${k}.nombre`)}</td>
      <td><a href="#" data-action="ver-archivo" data-id="${d.archivoId}">${esc(d.archivoNombre)}</a></td>
      <td><button class="btn peligro" data-action="quitar-archivo" data-lista="${path}" data-i="${k}">✕</button></td></tr>`).join('')}
    </tbody></table>` : `<p class="ayuda">${vacio}</p>`}
    <label class="btn">+ Subir documentos (PDF o imagen)<input type="file" hidden multiple accept="application/pdf,image/*" data-subir="doc-lista" data-lista="${path}"></label>`;
}

function seccionDocsEmpresa() {
  return `<section class="tarjeta">
    <h2>Documentos de la empresa</h2>
    <p class="ayuda">Constancia RNP, vigencia de poder, ficha RUC, DNI del representante, REMYPE, certificados, etc. Luego los incluyes en el expediente.</p>
    ${tablaDocumentos('docsEmpresa', 'Aún no hay documentos.')}
  </section>`;
}

// ---------- Profesionales ----------

const personasAbiertas = new Set();

function vProfesionales() {
  return `<section class="tarjeta">
    <h2>Profesionales y CV</h2>
    <p class="ayuda">Carga el CV de cada profesional (o el tuyo): la IA separa cada experiencia con sus fechas. Luego adjunta a cada experiencia su certificado o constancia, y sube títulos, colegiatura, habilidad y capacitaciones como documentos.</p>
    ${botonImportarCV('cv-persona', 'Importar CV con IA')}
    <button class="btn" data-action="agregar-persona">+ Agregar profesional manualmente</button>
  </section>
  ${state.personal.map((x, i) => {
    const b = `personal.${i}`;
    const exps = x.experiencias || [];
    return `<details class="tarjeta persona" data-persona="${x.id}" ${personasAbiertas.has(x.id) ? 'open' : ''}>
      <summary><strong>${esc(x.nombre || 'Profesional sin nombre')}</strong> · ${esc(x.profesion || '')} · ${exps.length} experiencias · ${mesesSinTraslape(exps)} meses (sin traslapes)</summary>
      <div class="grid">
        ${campo(b + '.nombre', 'Nombre completo', { ancho: 'doble' })}
        ${campo(b + '.dni', 'DNI')}
        ${campo(b + '.profesion', 'Profesión')}
        ${campo(b + '.colegiatura', 'N.° de colegiatura')}
        ${campo(b + '.fechaColegiatura', 'Fecha de colegiatura', { tipo: 'date' })}
        ${campo(b + '.cargo', 'Cargo habitual / al que postula')}
        ${campo(b + '.email', 'Correo')}
        ${campo(b + '.telefono', 'Teléfono')}
      </div>
      ${area(b + '.formacion', 'Formación académica (títulos, grados, especializaciones)', { filas: 3 })}
      ${area(b + '.capacitaciones', 'Capacitaciones (curso, institución, horas, fecha)', { filas: 3 })}
      <h3>Experiencia</h3>
      <div class="tabla-scroll"><table class="tabla editable">
        <thead><tr><th>Entidad / empleador</th><th>Cargo</th><th>Proyecto / servicio</th><th>Inicio</th><th>Fin (vacío = a la fecha)</th><th class="num">Meses</th><th>Certificado / constancia</th><th></th></tr></thead>
        <tbody>${exps.map((e, j) => `<tr>
          <td>${celda(`${b}.experiencias.${j}.entidad`)}</td><td>${celda(`${b}.experiencias.${j}.cargo`)}</td>
          <td><textarea class="celda" rows="2" data-bind="${b}.experiencias.${j}.proyecto">${esc(e.proyecto)}</textarea></td>
          <td>${celda(`${b}.experiencias.${j}.inicio`, { tipo: 'date' })}</td><td>${celda(`${b}.experiencias.${j}.fin`, { tipo: 'date' })}</td>
          <td class="num">${mesesEntre(e.inicio, e.fin)}</td>
          <td>${chipsArchivos(`${b}.experiencias.${j}.archivos`)}</td>
          <td><button class="btn peligro" data-action="quitar" data-lista="${b}.experiencias" data-i="${j}">✕</button></td></tr>`).join('')}</tbody>
      </table></div>
      <button class="btn" data-action="agregar-exp-persona" data-i="${i}">+ Agregar experiencia</button>
      <h3>Documentos del profesional</h3>
      ${tablaDocumentos(b + '.documentos', 'Títulos, colegiatura, certificado de habilidad, DNI, capacitaciones…')}
      <div class="fila"><button class="btn peligro" data-action="quitar" data-lista="personal" data-i="${i}">Eliminar profesional</button></div>
    </details>`;
  }).join('')}`;
}

document.addEventListener('toggle', (ev) => {
  const id = ev.target.dataset && ev.target.dataset.persona;
  if (!id) return;
  if (ev.target.open) personasAbiertas.add(id);
  else personasAbiertas.delete(id);
}, true);

const normalizarFecha = (s) => (/^\d{4}-\d{2}$/.test(s || '') ? s + '-01' : /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : '');
const normalizarFin = (s) => {
  if (/^\d{4}-\d{2}$/.test(s || '')) {
    const [a, m] = s.split('-').map(Number);
    return `${s}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : '';
};

async function importarCV(archivo, tipo) {
  const esEmpresa = tipo === 'cv-empresa';
  await conIA(tipo, async () => {
    const fuente = /\.docx$/i.test(archivo.name)
      ? { texto: await textoDeDocx(archivo) }
      : { pdfBase64: await blobABase64(archivo), pdfNombre: archivo.name };
    const r = await IA.extraerCV(state.config, fuente, esEmpresa);
    const archivoId = await Archivos.guardar(archivo, archivo.name);
    if (esEmpresa) {
      r.experiencias.forEach((e) => state.experiencia.push({
        id: uid(), cliente: e.entidad, objeto: e.proyecto || e.descripcion, tipo: e.tipo || 'servicio', especialidad: '',
        monto: e.monto || 0, inicio: normalizarFecha(e.inicio), fecha: normalizarFin(e.fin), sustento: '', archivos: [],
      }));
      state.docsEmpresa.push({ id: uid(), nombre: 'CV / portafolio de la empresa', archivoId, archivoNombre: archivo.name });
      alert(`Se agregaron ${r.experiencias.length} experiencias de la empresa. Revísalas y adjunta sus sustentos.`);
    } else {
      const t = r.titular;
      const persona = {
        id: uid(), nombre: t.nombre, dni: t.dni, profesion: t.profesion, colegiatura: t.colegiatura, fechaColegiatura: '',
        cargo: '', email: t.email, telefono: t.telefono, anios: 0, detalle: t.resumen,
        formacion: r.formacion.map((f) => [f.titulo, f.institucion, f.fecha].filter(Boolean).join(' - ')).join('\n'),
        capacitaciones: r.capacitaciones.map((f) => [f.nombre, f.institucion, f.horas && f.horas + ' h', f.fecha].filter(Boolean).join(' - ')).join('\n'),
        experiencias: r.experiencias.map((e) => ({
          id: uid(), entidad: e.entidad, cargo: e.cargo, proyecto: e.proyecto || e.descripcion, descripcion: e.descripcion,
          inicio: normalizarFecha(e.inicio), fin: normalizarFin(e.fin), monto: e.monto || 0, archivos: [],
        })),
        documentos: [{ id: uid(), nombre: 'Curriculum vitae', archivoId, archivoNombre: archivo.name }],
      };
      state.personal.push(persona);
      personasAbiertas.add(persona.id);
      alert(`CV importado: ${persona.nombre || 'profesional'} con ${persona.experiencias.length} experiencias. Revisa fechas y adjunta los certificados.`);
    }
  });
}

// ---------- Evaluación de cumplimiento ----------

const ESTADO_REQ = {
  cumple: ['ok', '✔ Cumple'], parcial: ['warn', '◐ Parcial'], no_cumple: ['error', '✘ No cumple'], no_verificable: ['info', '? Verificar'],
};
const VEREDICTO = {
  cumple: ['ok', 'CUMPLES los requisitos'], cumple_parcialmente: ['warn', 'CUMPLES PARCIALMENTE'], no_cumple: ['error', 'NO CUMPLES los requisitos'],
};

function htmlCumplimiento(c) {
  if (!c) return '';
  const [nivel, texto] = VEREDICTO[c.veredicto] || ['info', c.veredicto];
  return `<p class="alerta ${nivel} veredicto">${texto}</p><p>${esc(c.resumen)}</p>
    <div class="tabla-scroll"><table class="tabla"><thead><tr><th>Requisito</th><th>Estado</th><th>Evidencia</th><th>Qué hacer</th></tr></thead><tbody>
    ${c.requisitos.map((r) => {
      const [n, t] = ESTADO_REQ[r.estado] || ['info', r.estado];
      return `<tr><td><small>${esc(r.categoria)}</small><br>${esc(r.requisito)}</td><td><span class="alerta ${n} insignia">${t}</span></td><td>${esc(r.evidencia)}</td><td>${esc(r.accion)}</td></tr>`;
    }).join('')}</tbody></table></div>
    ${c.recomendaciones.length ? `<h3>Recomendaciones</h3><ul>${c.recomendaciones.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
}

function seccionCumplimiento(p, b) {
  return `<section class="tarjeta">
    <h2>¿Cumplo con los requisitos?</h2>
    <p class="ayuda">Compara el TDR / bases con el CV o la experiencia cargada y te dice requisito por requisito si cumples.</p>
    <div class="fila">
      <label class="campo"><span>Evaluar a</span><select data-bind="${b}.perfilEval">${opcionesPerfil(p.perfilEval)}</select></label>
      ${botonIA('evaluar-cumplimiento', 'Evaluar cumplimiento', 'cumple-' + p.id)}
    </div>
    ${htmlCumplimiento(p.cumplimiento)}
  </section>`;
}

// ---------- Pestaña Experiencia ----------

function selectClasif(b, id) {
  const v = (getPath(state, b + '.clasif') || {})[id] || '';
  return `<select class="celda clasif ${v}" data-bind="${b}.clasif.${id}" data-rerender>
    <option value="" ${!v ? 'selected' : ''}>— No usar —</option>
    <option value="especifica" ${v === 'especifica' ? 'selected' : ''}>Específica</option>
    <option value="general" ${v === 'general' ? 'selected' : ''}>General</option></select>`;
}

function tabExperiencia(p, b) {
  const c = p.clasif || {};
  const motivos = p.clasifMotivo || {};
  const expEmp = state.experiencia;
  const sumaEmp = (g) => expEmp.filter((x) => c[x.id] === g).reduce((s, x) => s + (+x.monto || 0), 0);
  const personas = state.personal.filter((x) => p.personalSel.includes(x.id));
  return `<section class="tarjeta">
    <h2>Experiencia general y específica</h2>
    ${area(b + '.defExperiencia', 'Qué piden las bases como experiencia general y específica', { filas: 3, placeholder: (p.analisis && p.analisis.experienciaRequerida) || 'Ej.: Experiencia específica: supervisión de obras de saneamiento…' })}
    ${p.analisis && p.analisis.experienciaRequerida && !p.defExperiencia ? '<button class="btn" data-action="copiar-def-exp">Copiar desde el análisis de bases</button>' : ''}
    <h3>Profesionales que participan en esta oferta</h3>
    <div class="fila">${state.personal.length ? state.personal.map((x) => `<label class="casilla"><input type="checkbox" data-action-check="personalSel" data-id="${x.id}" ${p.personalSel.includes(x.id) ? 'checked' : ''}> ${esc(x.nombre || '—')} <small>(${esc(x.profesion || '')})</small></label>`).join('')
      : '<span class="ayuda">Agrega profesionales en <a href="#" data-action="ir" data-pagina="profesionales">Profesionales</a>.</span>'}</div>
    <div class="fila">${botonIA('clasificar-exp', 'Clasificar experiencias con IA', 'clasif-' + p.id)}</div>
  </section>
  <section class="tarjeta">
    <h2>Empresa <small>específica: ${dinero(sumaEmp('especifica'))} · general: ${dinero(sumaEmp('general') + sumaEmp('especifica'))} (incluye específica)</small></h2>
    ${expEmp.length ? `<div class="tabla-scroll"><table class="tabla"><thead><tr><th>Cliente</th><th>Objeto</th><th>Fecha</th><th class="num">Monto</th><th>Sustentos</th><th>Clasificación</th></tr></thead><tbody>
      ${expEmp.map((x) => `<tr><td>${esc(x.cliente)}</td><td>${esc(x.objeto)}${motivos[x.id] ? `<br><small class="ayuda">IA: ${esc(motivos[x.id])}</small>` : ''}</td><td>${esc(x.fecha || '')}</td>
        <td class="num">${dinero(x.monto)}</td><td>${(x.archivos || []).length || '<span class="rojo">0</span>'}</td><td>${selectClasif(b, x.id)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="ayuda">Sin experiencias de empresa registradas.</p>'}
  </section>
  ${personas.map((x) => {
    const exps = x.experiencias || [];
    const esp = exps.filter((e) => c[e.id] === 'especifica');
    const gen = exps.filter((e) => c[e.id] === 'general' || c[e.id] === 'especifica');
    return `<section class="tarjeta">
      <h2>${esc(x.nombre)} <small>específica: ${mesesSinTraslape(esp)} meses · general: ${mesesSinTraslape(gen)} meses (incluye específica, sin traslapes)</small></h2>
      <div class="tabla-scroll"><table class="tabla"><thead><tr><th>Entidad</th><th>Cargo / proyecto</th><th>Periodo</th><th class="num">Meses</th><th>Sustentos</th><th>Clasificación</th></tr></thead><tbody>
      ${exps.map((e) => `<tr><td>${esc(e.entidad)}</td><td><strong>${esc(e.cargo)}</strong><br>${esc(e.proyecto)}${motivos[e.id] ? `<br><small class="ayuda">IA: ${esc(motivos[e.id])}</small>` : ''}</td>
        <td>${esc(e.inicio || '?')} → ${esc(e.fin || 'a la fecha')}</td><td class="num">${mesesEntre(e.inicio, e.fin)}</td>
        <td>${(e.archivos || []).length || '<span class="rojo">0</span>'}</td><td>${selectClasif(b, e.id)}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  }).join('')}`;
}

// ---------- Pestaña Anexos ----------

function tabAnexos(p, b) {
  return `<section class="tarjeta">
    <h2>Anexos de las bases</h2>
    <p class="ayuda">Si los anexos vienen en Word, súbelos y la IA los llena respetando el formato de la entidad. Si vienen dentro del PDF de las bases, la IA los transcribe y llena, y se generan sobre tu hoja membretada. Después de revisarlos y firmarlos, sube la versión firmada en PDF para el expediente.</p>
    <div class="fila">
      <label class="btn">📄 Subir anexos en Word (.docx)<input type="file" hidden multiple accept=".docx" data-subir="anexo-docx"></label>
      ${botonIA('extraer-anexos', 'Extraer y llenar anexos desde las bases (PDF / texto)', 'anexos-' + p.id)}
      <button class="btn" data-action="anexo-blanco">+ Anexo de texto en blanco</button>
    </div>
    <p class="ayuda">Para usar las bases en PDF, súbelas en la pestaña "1. Bases / TDR" durante esta sesión.</p>
  </section>
  ${(p.anexos || []).map((a, j) => {
    const ab = `${b}.anexos.${j}`;
    const ocupado = iaOcupada['anexo-' + a.id];
    return `<section class="tarjeta">
      <div class="fila entre">${celda(ab + '.titulo', { extra: 'aria-label="Título del anexo"' })}
        <span class="etiqueta">${a.origen === 'docx' ? 'Word de la entidad' : 'Texto (usa tu membrete)'}</span>
        <button class="btn peligro" data-action="quitar-anexo" data-i="${j}" title="Eliminar anexo">✕</button></div>
      ${a.origen === 'docx' ? `<div class="fila">
          ${IA.disponible() ? `<button class="btn primario" data-action="llenar-anexo" data-i="${j}" ${ocupado ? 'disabled' : ''}>${ocupado ? '⏳ Llenando…' : a.llenadoId ? '✨ Volver a llenar con IA' : '✨ Llenar con IA'}</button>` : ''}
          ${a.llenadoId ? `<button class="btn" data-action="descargar-archivo" data-id="${a.llenadoId}" data-nombre="${esc(a.titulo)} (llenado).docx">⬇ Word llenado</button>` : ''}
          <button class="btn" data-action="descargar-archivo" data-id="${a.archivoId}" data-nombre="${esc(a.archivoNombre || a.titulo + '.docx')}">⬇ Original</button>
          ${a.aplicados ? `<span class="ayuda">${a.aplicados} párrafos completados</span>` : ''}</div>`
        : `<textarea rows="12" data-bind="${ab}.contenido">${esc(a.contenido || '')}</textarea>
          <div class="fila"><button class="btn" data-action="anexo-word" data-i="${j}">⬇ Word con mi membrete</button></div>`}
      ${(a.pendientes || []).length ? `<p class="alerta warn">Pendiente de completar: ${a.pendientes.map(esc).join(' · ')}</p>` : ''}
      <div class="fila">${a.firmadoId ? `<span class="chip">✅ Firmado: <a href="#" data-action="ver-archivo" data-id="${a.firmadoId}">${esc(a.firmadoNombre || 'PDF')}</a><button class="btn-link" data-action="quitar-firmado" data-i="${j}">✕</button></span>`
        : `<label class="btn">Subir versión firmada (PDF)<input type="file" hidden accept="application/pdf" data-subir="firmado" data-i="${j}"></label><span class="ayuda">Sin firmar todavía.</span>`}</div>
    </section>`;
  }).join('')}`;
}

// ---------- Pestaña Expediente ----------

const TIPO_ITEM = { separador: 'Separador', anexo: 'Anexo', experiencia: 'Experiencia', documento: 'Documento' };

function tabExpediente(p, b) {
  const o = p.opcionesExpediente;
  const docs = catalogoDocumentos();
  const opcionesDe = (v) => [['empresa', `Empresa (${state.empresa.razonSocial || '—'})`], ...state.personal.map((x) => [x.id, x.nombre || 'Profesional'])]
    .map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const { piezas, avisos } = Expediente.resolver(p);
  const fila = (it, j) => {
    const ib = `${b}.estructura.${j}`;
    let cfg = '';
    if (it.tipo === 'separador') cfg = `${celda(ib + '.titulo', { extra: 'placeholder="Título del separador"' })}${celda(ib + '.subtitulo', { extra: 'placeholder="Subtítulo (opcional)"' })}`;
    else if (it.tipo === 'anexo') cfg = `<select class="celda" data-bind="${ib}.anexoId" data-rerender><option value="">— Elegir anexo —</option>${(p.anexos || []).map((a) => `<option value="${a.id}" ${a.id === it.anexoId ? 'selected' : ''}>${esc(a.titulo)}${a.firmadoId ? ' ✅' : ''}</option>`).join('')}</select>`;
    else if (it.tipo === 'experiencia') {
      cfg = `<select class="celda" data-bind="${ib}.de" data-rerender>${opcionesDe(it.de)}</select>
      <select class="celda" data-bind="${ib}.grupo" data-rerender><option value="especifica" ${it.grupo === 'especifica' ? 'selected' : ''}>Específica</option><option value="general" ${it.grupo === 'general' ? 'selected' : ''}>General</option></select>
      <label class="casilla"><input type="checkbox" data-bind="${ib}.cuadro" ${it.cuadro ? 'checked' : ''}> con cuadro resumen</label>`;
    } else if (it.tipo === 'documento') cfg = `<select class="celda" data-bind="${ib}.archivoId" data-rerender><option value="">— Elegir documento —</option>${docs.map((d) => `<option value="${d.archivoId}" ${d.archivoId === it.archivoId ? 'selected' : ''}>${esc(d.nombre)} · ${esc(d.duenio)}</option>`).join('')}</select>`;
    return `<tr class="${it.tipo === 'separador' ? 'fila-separador' : ''}"><td>${j + 1}</td><td><span class="etiqueta">${TIPO_ITEM[it.tipo]}</span></td><td class="cfg">${cfg}</td>
      <td class="acciones"><button class="btn" data-action="mover-item" data-i="${j}" data-d="-1">↑</button><button class="btn" data-action="mover-item" data-i="${j}" data-d="1">↓</button>
      <button class="btn peligro" data-action="quitar" data-lista="${b}.estructura" data-i="${j}">✕</button></td></tr>`;
  };
  return `<section class="tarjeta">
    <h2>Estructura del expediente</h2>
    <p class="ayuda">Arma el orden de tu oferta. Cada <strong>separador</strong> genera una hoja con tu membrete y abre una carpeta nueva. Las experiencias se toman según la clasificación de la pestaña "4. Experiencia", con sus certificados adjuntos.</p>
    <div class="fila">
      <button class="btn primario" data-action="estructura-sugerida">Armar estructura sugerida</button>
      ${Object.entries(TIPO_ITEM).map(([k, t]) => `<button class="btn" data-action="agregar-item" data-tipo="${k}">+ ${t}</button>`).join('')}
    </div>
    ${(p.estructura || []).length ? `<div class="tabla-scroll"><table class="tabla editable estructura"><thead><tr><th>#</th><th>Tipo</th><th>Contenido</th><th></th></tr></thead><tbody>
      ${p.estructura.map(fila).join('')}</tbody></table></div>` : '<p class="ayuda">La estructura está vacía. Usa "Armar estructura sugerida" para empezar.</p>'}
    <p class="ayuda">${piezas.length} piezas en total.</p>
    ${avisos.map((t) => `<p class="alerta warn">${esc(t)}</p>`).join('')}
  </section>
  <section class="tarjeta">
    <h2>Foliado e índice</h2>
    <div class="grid">
      ${selector(b + '.opcionesExpediente.folioPos', 'Posición del folio', { 'sup-der': 'Arriba a la derecha', 'sup-cen': 'Arriba al centro', 'inf-der': 'Abajo a la derecha', 'inf-cen': 'Abajo al centro' })}
      ${selector(b + '.opcionesExpediente.folioOrden', 'Numeración', { asc: 'Ascendente (1 en la primera hoja)', desc: 'Descendente (1 en la última hoja)' })}
      ${campo(b + '.opcionesExpediente.folioFormato', 'Formato ({n} = número)')}
      ${campo(b + '.opcionesExpediente.folioInicio', 'Empezar en', { tipo: 'number' })}
      ${campo(b + '.opcionesExpediente.folioDigitos', 'Dígitos (0001)', { tipo: 'number' })}
      ${campo(b + '.opcionesExpediente.margenSupCm', 'Margen superior con membrete (cm)', { tipo: 'number' })}
      ${campo(b + '.opcionesExpediente.margenInfCm', 'Margen inferior con membrete (cm)', { tipo: 'number' })}
    </div>
    ${casilla(b + '.opcionesExpediente.indice', 'Agregar índice con número de folio al inicio')}
    <p class="ayuda">Revisa en las bases cómo exigen el foliado. Los folios se estampan sobre todas las hojas, incluidos los certificados escaneados.</p>
  </section>
  <section class="tarjeta">
    <h2>Generar</h2>
    <div class="fila">
      <button class="btn primario" data-action="generar-pdf" ${iaOcupada['exp-' + p.id] ? 'disabled' : ''}>📕 Generar PDF único foliado</button>
      <button class="btn" data-action="generar-zip" ${iaOcupada['exp-' + p.id] ? 'disabled' : ''}>🗂 Descargar carpetas (ZIP con Word y sustentos)</button>
    </div>
    <p id="progreso" class="ayuda">${esc(vista.progreso || '')}</p>
    ${(p.avisosExpediente || []).map((t) => `<p class="alerta warn">${esc(t)}</p>`).join('')}
  </section>`;
}

function estructuraSugerida(p) {
  const it = [];
  const sep = (titulo, subtitulo = '') => it.push({ id: uid(), tipo: 'separador', titulo, subtitulo });
  const c = p.clasif || {};
  if ((p.anexos || []).length) {
    sep('DOCUMENTOS DE PRESENTACIÓN OBLIGATORIA');
    p.anexos.forEach((a) => it.push({ id: uid(), tipo: 'anexo', anexoId: a.id }));
  }
  if (state.docsEmpresa.length) {
    sep('DOCUMENTOS DEL POSTOR');
    state.docsEmpresa.forEach((d) => it.push({ id: uid(), tipo: 'documento', archivoId: d.archivoId }));
  }
  for (const g of ['especifica', 'general']) {
    if (state.experiencia.some((x) => c[x.id] === g)) {
      sep(`EXPERIENCIA ${g === 'especifica' ? 'ESPECÍFICA' : 'GENERAL'} DEL POSTOR`);
      it.push({ id: uid(), tipo: 'experiencia', de: 'empresa', grupo: g, cuadro: true });
    }
  }
  state.personal.filter((x) => p.personalSel.includes(x.id)).forEach((x) => {
    sep(`PERSONAL CLAVE`, `${x.nombre}${x.cargo ? ' - ' + x.cargo : ''}`);
    (x.documentos || []).forEach((d) => it.push({ id: uid(), tipo: 'documento', archivoId: d.archivoId }));
    for (const g of ['especifica', 'general']) {
      if ((x.experiencias || []).some((e) => c[e.id] === g)) {
        sep(`EXPERIENCIA ${g === 'especifica' ? 'ESPECÍFICA' : 'GENERAL'}`, x.nombre);
        it.push({ id: uid(), tipo: 'experiencia', de: x.id, grupo: g, cuadro: true });
      }
    }
  });
  return it;
}

// ---------- Oportunidades ----------

function vOportunidades() {
  const o = state.oportunidades;
  const tope = 8 * (+state.config.uit || 0);
  const pdf = pdfEnMemoria.oportunidad;
  const COMP = { alta: 'ok', media: 'warn', baja: 'error' };
  return `<section class="tarjeta">
    <h2>Oportunidades</h2>
    <div class="fila"><label class="campo"><span>Evaluar con el perfil de</span><select data-bind="oportunidades.perfil">${opcionesPerfil(o.perfil)}</select></label></div>
  </section>
  <section class="tarjeta">
    <h2>¿Cumplo con este TDR?</h2>
    <p class="ayuda">Sube o pega los términos de referencia de una convocatoria (incluidas las menores a 8 UIT) y la IA te dice si cumples, según el CV o la experiencia cargada.</p>
    <div class="fila"><label class="btn">📄 Subir TDR (PDF o Word)<input type="file" hidden accept="application/pdf,.docx" data-subir="tdr-oportunidad"></label>
      ${pdf ? `<span class="chip">${esc(pdf.nombre)}<button class="btn-link" data-action="quitar-tdr">✕</button></span>` : ''}</div>
    ${area('oportunidades.tdrTexto', 'O pega el texto del TDR', { filas: 6 })}
    <div class="fila">${botonIA('evaluar-oportunidad', '¿Cumplo?', 'oportunidad')}
      ${o.resultado ? '<button class="btn" data-action="crear-desde-tdr">Crear proceso con este TDR</button>' : ''}</div>
    ${htmlCumplimiento(o.resultado)}
  </section>
  <section class="tarjeta">
    <h2>Buscar convocatorias menores a 8 UIT</h2>
    <p class="ayuda">La IA busca en internet convocatorias vigentes (portales de entidades, gob.pe, SEACE) compatibles con tu perfil. Tope referencial: 8 UIT = ${dinero(tope)} (UIT de ${dinero(state.config.uit)}, ajustable en Configuración).</p>
    <p class="alerta info">La búsqueda es referencial y puede no encontrar todas las convocatorias: muchas solo se publican en el SEACE/PLADICOP o en el portal de cada entidad. Verifica siempre el enlace y la fecha límite.</p>
    <div class="fila">
      <input class="celda crece" data-bind="oportunidades.consulta" value="${esc(o.consulta || '')}" placeholder="Opcional: región, especialidad, entidades… (p. ej. supervisión de obras en Cusco)">
      ${botonIA('buscar-convocatorias', 'Buscar en internet', 'busqueda')}
    </div>
    ${o.busqueda ? `${o.busqueda.convocatorias.length ? `<div class="tabla-scroll"><table class="tabla"><thead><tr><th>Convocatoria</th><th>Entidad</th><th>Fecha límite</th><th>Monto</th><th>Compatibilidad</th></tr></thead><tbody>
      ${o.busqueda.convocatorias.map((x) => `<tr><td>${/^https?:\/\//.test(x.url) ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.titulo)}</a>` : esc(x.titulo)}<br><small>${esc(x.requisitosClave)}</small></td>
        <td>${esc(x.entidad)}</td><td>${esc(x.fechaLimite)}</td><td>${esc(x.monto)}</td>
        <td><span class="alerta ${COMP[x.compatibilidad] || 'info'} insignia">${esc(x.compatibilidad)}</span><br><small>${esc(x.motivo)}</small></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="ayuda">No se encontraron convocatorias vigentes.</p>'}
      ${o.busqueda.notas ? `<div class="documento">${textoAHtml(o.busqueda.notas)}</div>` : ''}` : ''}
  </section>`;
}

// ---------- Subida de archivos ----------

async function subirArchivo(el) {
  const archivos = Array.from(el.files || []);
  el.value = '';
  if (!archivos.length) return;
  const d = el.dataset;
  const p = procesoActual();
  try {
    switch (d.subir) {
      case 'adjuntar': {
        if (!getPath(state, d.lista)) setPath(state, d.lista, []);
        for (const f of archivos) getPath(state, d.lista).push({ archivoId: await Archivos.guardar(f, f.name), nombre: f.name });
        break;
      }
      case 'doc-lista': {
        if (!getPath(state, d.lista)) setPath(state, d.lista, []);
        for (const f of archivos) {
          getPath(state, d.lista).push({ id: uid(), nombre: f.name.replace(/\.[^.]+$/, ''), archivoId: await Archivos.guardar(f, f.name), archivoNombre: f.name });
        }
        break;
      }
      case 'cv-empresa':
      case 'cv-persona':
        await importarCV(archivos[0], d.subir);
        return;
      case 'membrete-docx':
      case 'membrete-pdf': {
        const cual = d.subir === 'membrete-docx' ? 'docx' : 'pdf';
        await Archivos.borrar(state.membrete[cual + 'Id']);
        state.membrete[cual + 'Id'] = await Archivos.guardar(archivos[0], archivos[0].name);
        state.membrete[cual + 'Nombre'] = archivos[0].name;
        break;
      }
      case 'anexo-docx':
        for (const f of archivos) {
          p.anexos.push({ id: uid(), titulo: f.name.replace(/\.docx$/i, ''), origen: 'docx', archivoId: await Archivos.guardar(f, f.name), archivoNombre: f.name, pendientes: [] });
        }
        break;
      case 'firmado': {
        const a = p.anexos[+d.i];
        await Archivos.borrar(a.firmadoId);
        a.firmadoId = await Archivos.guardar(archivos[0], archivos[0].name);
        a.firmadoNombre = archivos[0].name;
        break;
      }
      case 'tdr-oportunidad': {
        const f = archivos[0];
        if (/\.docx$/i.test(f.name)) {
          state.oportunidades.tdrTexto = await textoDeDocx(f);
          delete pdfEnMemoria.oportunidad;
        } else pdfEnMemoria.oportunidad = { nombre: f.name, base64: await blobABase64(f) };
        break;
      }
      default:
        return;
    }
  } catch (e) {
    alert('No se pudo guardar el archivo: ' + e.message);
  }
  guardar();
  render();
}

// ---------- Acciones ----------

Object.assign(acciones, {
  'ver-archivo'({ id }) { Archivos.abrir(id); },
  'descargar-archivo'({ id, nombre }) { Archivos.descargar(id, nombre); },
  async 'quitar-archivo'({ lista, i }) {
    const arr = getPath(state, lista);
    const x = arr[+i];
    if (!confirm(`¿Quitar "${x.nombre}"?`)) return;
    arr.splice(+i, 1);
    await Archivos.borrar(x.archivoId);
    guardar();
    render();
  },
  async 'quitar-membrete'({ cual }) {
    await Archivos.borrar(state.membrete[cual + 'Id']);
    state.membrete[cual + 'Id'] = '';
    state.membrete[cual + 'Nombre'] = '';
    guardar();
    render();
  },
  async 'probar-separador'() {
    try {
      descargar('Separador de prueba.docx', await Expediente.separadorDocx('EXPERIENCIA ESPECÍFICA', 'Separador de prueba'), MIME_DOCX);
    } catch (e) {
      alert(e.message);
    }
  },
  'agregar-persona'() {
    const x = { id: uid(), nombre: '', dni: '', profesion: '', colegiatura: '', fechaColegiatura: '', cargo: '', email: '', telefono: '', formacion: '', capacitaciones: '', experiencias: [], documentos: [] };
    state.personal.push(x);
    personasAbiertas.add(x.id);
    guardar();
    render();
  },
  'agregar-exp-persona'({ i }) {
    state.personal[+i].experiencias.push({ id: uid(), entidad: '', cargo: '', proyecto: '', inicio: '', fin: '', archivos: [] });
    guardar();
    render();
  },
  async 'evaluar-cumplimiento'() {
    const p = procesoActual();
    await conIA('cumple-' + p.id, async () => {
      p.cumplimiento = await IA.evaluarCumplimiento(state.config, { fuente: fuenteIA(p), contexto: '', perfil: perfilDe(p.perfilEval) });
    });
  },
  'copiar-def-exp'() {
    const p = procesoActual();
    p.defExperiencia = p.analisis.experienciaRequerida;
    guardar();
    render();
  },
  async 'clasificar-exp'() {
    const p = procesoActual();
    const personas = state.personal.filter((x) => p.personalSel.includes(x.id));
    const experiencias = [
      ...state.experiencia.map((x) => ({ id: x.id, titular: 'empresa postora', cliente: x.cliente, objeto: x.objeto, tipo: x.tipo, especialidad: x.especialidad, monto: x.monto, fecha: x.fecha })),
      ...personas.flatMap((x) => (x.experiencias || []).map((e) => ({ id: e.id, titular: `${x.nombre} (${x.profesion})`, entidad: e.entidad, cargo: e.cargo, proyecto: e.proyecto, inicio: e.inicio, fin: e.fin || 'a la fecha' }))),
    ];
    if (!experiencias.length) { alert('No hay experiencias para clasificar.'); return; }
    await conIA('clasif-' + p.id, async () => {
      const r = await IA.clasificarExperiencias(state.config, { fuente: fuenteIA(p), contexto: contextoIA(p), experiencias, definicion: p.defExperiencia });
      p.clasif = p.clasif || {};
      p.clasifMotivo = {};
      r.forEach((x) => {
        p.clasif[x.id] = x.grupo === 'no_aplica' ? '' : x.grupo;
        p.clasifMotivo[x.id] = x.motivo;
      });
    });
  },
  async 'extraer-anexos'() {
    const p = procesoActual();
    await conIA('anexos-' + p.id, async () => {
      const lista = await IA.extraerAnexos(state.config, { fuente: fuenteIA(p), contexto: contextoAnexos(p) });
      lista.forEach((a) => p.anexos.push({ id: uid(), titulo: a.titulo, origen: 'texto', contenido: a.contenido, pendientes: a.pendientes }));
      if (!lista.length) alert('No se encontraron anexos en las bases.');
    });
  },
  'anexo-blanco'() {
    procesoActual().anexos.push({ id: uid(), titulo: 'Nuevo anexo', origen: 'texto', contenido: '', pendientes: [] });
    guardar();
    render();
  },
  async 'quitar-anexo'({ i }) {
    const p = procesoActual();
    const a = p.anexos[+i];
    if (!confirm(`¿Eliminar "${a.titulo}"?`)) return;
    p.anexos.splice(+i, 1);
    await Promise.all([a.archivoId, a.llenadoId, a.firmadoId].map((id) => Archivos.borrar(id)));
    guardar();
    render();
  },
  async 'quitar-firmado'({ i }) {
    const a = procesoActual().anexos[+i];
    await Archivos.borrar(a.firmadoId);
    a.firmadoId = '';
    guardar();
    render();
  },
  async 'llenar-anexo'({ i }) {
    const p = procesoActual();
    const a = p.anexos[+i];
    await conIA('anexo-' + a.id, async () => {
      const original = await Archivos.leer(a.archivoId);
      if (!original) throw new Error('No se encontró el Word original.');
      const { parrafos } = await abrirDocx(original.blob);
      const r = await IA.llenarAnexo(state.config, { fuente: fuenteIA(p), contexto: contextoAnexos(p), parrafos, titulo: a.titulo });
      const { blob, aplicados } = await llenarDocx(original.blob, r.reemplazos);
      await Archivos.borrar(a.llenadoId);
      a.llenadoId = await Archivos.guardar(new Blob([blob], { type: MIME_DOCX }), `${a.titulo} (llenado).docx`);
      a.aplicados = aplicados;
      a.pendientes = r.pendientes;
    });
  },
  async 'anexo-word'({ i }) {
    const a = procesoActual().anexos[+i];
    const m = state.membrete.docxId ? await Archivos.leer(state.membrete.docxId) : null;
    descargar(`${nombreSeguro(a.titulo)}.docx`, await docxDesdeMembrete(m && m.blob, textoABloques(a.contenido)), MIME_DOCX);
  },
  'agregar-item'({ tipo }) {
    const p = procesoActual();
    const base = { id: uid(), tipo };
    if (tipo === 'separador') Object.assign(base, { titulo: '', subtitulo: '' });
    if (tipo === 'anexo') base.anexoId = '';
    if (tipo === 'experiencia') Object.assign(base, { de: 'empresa', grupo: 'especifica', cuadro: true });
    if (tipo === 'documento') base.archivoId = '';
    p.estructura.push(base);
    guardar();
    render();
  },
  'mover-item'({ i, d }) {
    const arr = procesoActual().estructura;
    const a = +i;
    const b = a + +d;
    if (b < 0 || b >= arr.length) return;
    [arr[a], arr[b]] = [arr[b], arr[a]];
    guardar();
    render();
  },
  'estructura-sugerida'() {
    const p = procesoActual();
    if (p.estructura.length && !confirm('¿Reemplazar la estructura actual por la sugerida?')) return;
    p.estructura = estructuraSugerida(p);
    if (!p.estructura.length) alert('Primero agrega anexos, documentos o clasifica experiencias.');
    guardar();
    render();
  },
  async 'generar-pdf'() {
    await generarExpediente('pdf');
  },
  async 'generar-zip'() {
    await generarExpediente('zip');
  },
  'quitar-tdr'() { delete pdfEnMemoria.oportunidad; render(); },
  async 'evaluar-oportunidad'() {
    const o = state.oportunidades;
    const pdf = pdfEnMemoria.oportunidad;
    await conIA('oportunidad', async () => {
      o.resultado = await IA.evaluarCumplimiento(state.config, {
        fuente: { pdfBase64: pdf && pdf.base64, pdfNombre: pdf && pdf.nombre, texto: o.tdrTexto }, contexto: '', perfil: perfilDe(o.perfil),
      });
    });
  },
  'crear-desde-tdr'() {
    const o = state.oportunidades;
    const p = nuevoProceso('servicio');
    p.basesTexto = o.tdrTexto;
    p.cumplimiento = o.resultado;
    p.perfilEval = o.perfil;
    if (o.perfil !== 'empresa') p.personalSel = [o.perfil];
    if (pdfEnMemoria.oportunidad) pdfEnMemoria[p.id] = pdfEnMemoria.oportunidad;
    state.procesos.unshift(p);
    guardar();
    Object.assign(vista, { pagina: 'proceso', procesoId: p.id, tab: 'bases' });
    render();
  },
  async 'buscar-convocatorias'() {
    const o = state.oportunidades;
    await conIA('busqueda', async () => {
      o.busqueda = await IA.buscarConvocatorias(state.config, { perfil: perfilDe(o.perfil), consulta: o.consulta, topeSoles: 8 * (+state.config.uit || 0) });
    });
  },
});

async function generarExpediente(tipo) {
  const p = procesoActual();
  const clave = 'exp-' + p.id;
  if (iaOcupada[clave]) return;
  iaOcupada[clave] = true;
  vista.progreso = 'Iniciando…';
  render();
  const progreso = (t) => {
    vista.progreso = t;
    const el = document.getElementById('progreso');
    if (el) el.textContent = t;
  };
  try {
    const nombre = nombreSeguro(`Expediente ${p.nomenclatura || ''}`);
    if (tipo === 'pdf') {
      const r = await Expediente.pdf(p, progreso);
      p.avisosExpediente = r.avisos;
      descargar(nombre + '.pdf', r.blob, 'application/pdf');
      vista.progreso = `Listo: ${r.paginas} folios${r.paginasIndice ? ` (índice de ${r.paginasIndice} hoja(s))` : ''}.`;
    } else {
      const r = await Expediente.zip(p, progreso);
      p.avisosExpediente = r.avisos;
      descargar(nombre + '.zip', r.blob, 'application/zip');
      vista.progreso = 'Listo: carpetas descargadas.';
    }
  } catch (e) {
    vista.progreso = '';
    alert('No se pudo generar: ' + e.message);
  } finally {
    delete iaOcupada[clave];
    guardar();
    render();
  }
}

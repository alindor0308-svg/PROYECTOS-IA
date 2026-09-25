'use strict';
// Arma el expediente de la oferta según la estructura definida:
// separadores sobre la hoja membretada, anexos, experiencias con sus sustentos y documentos.
// Salidas: un PDF único foliado (con índice opcional) y un ZIP con carpetas y archivos Word.

const A4 = [595.28, 841.89];

// Caracteres que la fuente estándar (WinAnsi) puede dibujar.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function textoPdf(s) {
  return String(s == null ? '' : s).replace(/\t/g, '    ').replace(/[\u2010-\u2012]/g, '-').replace(/[^\n\u0020-\u007E\u00A0-\u00FF]/g,
    (c) => (WIN_ANSI_EXTRA.includes(c) ? c : ' '));
}

function nombreSeguro(s, max = 70) {
  return String(s || 'documento').normalize('NFC').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || 'documento';
}

const pad = (n, largo) => String(n).padStart(largo, '0');

// ---------- Resolución de la estructura en piezas ----------

function experienciasDe(de) {
  if (de === 'empresa') return { titular: state.empresa.razonSocial || 'Empresa', lista: state.experiencia };
  const per = state.personal.find((x) => x.id === de);
  return per ? { titular: per.nombre || 'Profesional', lista: per.experiencias || [] } : { titular: '', lista: [] };
}

const NOMBRE_GRUPO = { especifica: 'Experiencia específica', general: 'Experiencia general' };

function cuadroExperiencia(de, grupo, exps) {
  const empresa = de === 'empresa';
  const filas = [empresa
    ? ['N.°', 'Cliente', 'Objeto del contrato', 'Fecha', 'Monto (S/)']
    : ['N.°', 'Entidad / empresa', 'Cargo', 'Proyecto / servicio', 'Desde', 'Hasta', 'Meses']];
  exps.forEach((x, i) => {
    filas.push(empresa
      ? [String(i + 1), x.cliente, x.objeto, x.fecha || '', dinero(+x.monto || 0).replace('S/', '').trim()]
      : [String(i + 1), x.entidad, x.cargo, x.proyecto, x.inicio || '', x.fin || 'a la fecha', String(mesesEntre(x.inicio, x.fin))]);
  });
  if (empresa) filas.push(['', 'TOTAL', '', '', dinero(exps.reduce((s, x) => s + (+x.monto || 0), 0)).replace('S/', '').trim()]);
  else filas.push(['', 'TOTAL (sin traslapes)', '', '', '', '', String(mesesSinTraslape(exps))]);
  return filas;
}

// Devuelve las piezas en orden y las advertencias encontradas.
function resolverEstructura(p) {
  const piezas = [];
  const avisos = [];
  for (const it of p.estructura || []) {
    if (it.tipo === 'separador') {
      piezas.push({ titulo: it.titulo || 'Separador', separador: true, bloques: [{ t: 'separador', texto: it.titulo || '', subtitulo: it.subtitulo || '' }] });
    } else if (it.tipo === 'anexo') {
      const a = (p.anexos || []).find((x) => x.id === it.anexoId);
      if (!a) { avisos.push('Un anexo de la estructura ya no existe.'); continue; }
      piezas.push({ titulo: a.titulo, anexo: a });
      if (!a.firmadoId) avisos.push(`"${a.titulo}" no tiene versión firmada en PDF: se incluirá el texto sin firma.`);
    } else if (it.tipo === 'experiencia') {
      const { titular, lista } = experienciasDe(it.de);
      const exps = lista.filter((x) => (p.clasif || {})[x.id] === it.grupo)
        .sort((a, b) => String(a.inicio || a.fecha || '').localeCompare(String(b.inicio || b.fecha || '')));
      if (!exps.length) { avisos.push(`No hay experiencias marcadas como "${NOMBRE_GRUPO[it.grupo]}" para ${titular}.`); continue; }
      if (it.cuadro) {
        piezas.push({
          titulo: `Cuadro de ${NOMBRE_GRUPO[it.grupo].toLowerCase()} - ${titular}`,
          bloques: [{ t: 'titulo', texto: `${NOMBRE_GRUPO[it.grupo].toUpperCase()}\n${titular}` }, { t: 'tabla', filas: cuadroExperiencia(it.de, it.grupo, exps) }],
        });
      }
      exps.forEach((x) => {
        const nombre = it.de === 'empresa' ? `${x.cliente} - ${x.objeto}` : `${x.entidad} - ${x.cargo}`;
        if (!(x.archivos || []).length) avisos.push(`Sin sustento adjunto: ${nombre}`);
        (x.archivos || []).forEach((f, k) => piezas.push({ titulo: nombre + (x.archivos.length > 1 ? ` (${k + 1})` : ''), archivoId: f.archivoId, archivoNombre: f.nombre }));
      });
    } else if (it.tipo === 'documento') {
      if (!it.archivoId) { avisos.push('Hay un documento sin archivo seleccionado en la estructura.'); continue; }
      piezas.push({ titulo: it.titulo || nombreDocumento(it.archivoId), archivoId: it.archivoId });
    }
  }
  return { piezas, avisos };
}

// ---------- Dibujo de texto en PDF ----------

function crearLienzo(pdf, fuentes, membrete, opciones) {
  const [ancho, alto] = A4;
  const margen = { izq: 70, der: 60, sup: membrete ? opciones.margenSupPt : 70, inf: membrete ? opciones.margenInfPt : 70 };
  let pagina = null;
  let y = 0;
  const util = ancho - margen.izq - margen.der;
  const nuevaPagina = () => {
    pagina = pdf.addPage(A4);
    if (membrete) membrete.dibujar(pagina);
    y = alto - margen.sup;
    return pagina;
  };
  const partir = (texto, tam, fuente) => {
    const lineas = [];
    for (const parrafo of textoPdf(texto).split('\n')) {
      let actual = '';
      for (const palabra of parrafo.split(/ +/)) {
        const prueba = actual ? actual + ' ' + palabra : palabra;
        if (fuente.widthOfTextAtSize(prueba, tam) <= util || !actual) actual = prueba;
        else { lineas.push(actual); actual = palabra; }
      }
      lineas.push(actual);
    }
    return lineas;
  };
  const partirEn = (texto, tam, fuente, anchoMax) => {
    const lineas = [];
    for (const parrafo of textoPdf(texto).split('\n')) {
      let actual = '';
      for (const palabra of parrafo.split(/ +/)) {
        const prueba = actual ? actual + ' ' + palabra : palabra;
        if (fuente.widthOfTextAtSize(prueba, tam) <= anchoMax || !actual) actual = prueba;
        else { lineas.push(actual); actual = palabra; }
      }
      lineas.push(actual);
    }
    return lineas;
  };
  const asegurar = (h) => { if (!pagina || y - h < margen.inf) nuevaPagina(); };
  const escribir = (texto, { tam = 11, negrita = false, centro = false, sangria = 0, antes = 0, despues = 6 } = {}) => {
    const f = negrita ? fuentes.negrita : fuentes.normal;
    const lh = tam * 1.35;
    y -= antes;
    for (const l of partir(texto, tam, f)) {
      asegurar(lh);
      const w = f.widthOfTextAtSize(l, tam);
      const x = centro ? (ancho - w) / 2 : margen.izq + sangria;
      pagina.drawText(l, { x, y: y - tam, size: tam, font: f });
      y -= lh;
    }
    y -= despues;
  };
  const tabla = (filas) => {
    const n = Math.max(...filas.map((f) => f.length));
    const pesos = Array.from({ length: n }, (_, j) => Math.max(3, ...filas.map((f) => Math.min(40, String(f[j] || '').length))));
    const suma = pesos.reduce((a, b) => a + b, 0);
    const anchos = pesos.map((p) => (p / suma) * util);
    const tam = 9;
    const lh = tam * 1.3;
    filas.forEach((fila, i) => {
      const f = i === 0 ? fuentes.negrita : fuentes.normal;
      const celdas = anchos.map((w, j) => partirEn(fila[j] || '', tam, f, w - 6));
      const h = Math.max(...celdas.map((c) => c.length)) * lh + 6;
      asegurar(h);
      let x = margen.izq;
      celdas.forEach((lineas, j) => {
        pagina.drawRectangle({ x, y: y - h, width: anchos[j], height: h, borderWidth: 0.6, borderColor: PDFLib.rgb(0, 0, 0) });
        lineas.forEach((l, k) => pagina.drawText(l, { x: x + 3, y: y - 3 - tam - k * lh, size: tam, font: f }));
        x += anchos[j];
      });
      y -= h;
    });
    y -= 10;
  };
  const bloques = (lista) => {
    nuevaPagina();
    for (const b of lista) {
      if (b.t === 'salto') nuevaPagina();
      else if (b.t === 'separador') {
        const lineas = partir(b.texto, 26, fuentes.negrita).length + (b.subtitulo ? 2 : 0);
        y = Math.min(y, alto / 2 + (lineas * 34) / 2);
        escribir(b.texto, { tam: 26, negrita: true, centro: true, despues: 12 });
        if (b.subtitulo) escribir(b.subtitulo, { tam: 15, centro: true });
      } else if (b.t === 'titulo') escribir(b.texto, { tam: 12, negrita: true, centro: true, despues: 12 });
      else if (b.t === 'h') escribir(b.texto, { tam: 11, negrita: true, antes: 6 });
      else if (b.t === 'li') escribir('•  ' + b.texto, { sangria: 12 });
      else if (b.t === 'tabla') tabla(b.filas);
      else if (!b.texto) y -= 8;
      else escribir(b.texto, { negrita: b.negrita, centro: b.centro });
    }
  };
  return { bloques };
}

async function prepararMembrete(pdf, fuentes) {
  const m = state.membrete || {};
  if (m.pdfId) {
    const a = await Archivos.leer(m.pdfId);
    if (a) {
      const [fondo] = await pdf.embedPdf(await a.blob.arrayBuffer(), [0]);
      return { dibujar: (pg) => pg.drawPage(fondo, { x: 0, y: 0, width: pg.getWidth(), height: pg.getHeight() }) };
    }
  }
  if (m.docxId) {
    const a = await Archivos.leer(m.docxId);
    if (a) {
      const partes = await partesMembrete(a.blob);
      const imgs = async (lista) => Promise.all(lista.map(async (x) => ({ ...x, img: x.png ? await pdf.embedPng(x.bytes) : await pdf.embedJpg(x.bytes) })));
      const enc = await imgs(partes.encabezado.imagenes);
      const pie = await imgs(partes.pie.imagenes);
      const [ancho, alto] = A4;
      const escala = (x) => {
        const w = Math.min(x.anchoPt || x.img.width, ancho - 40);
        return { w, h: w * (x.img.height / x.img.width) };
      };
      return {
        dibujar(pg) {
          let yTop = alto - 20;
          enc.forEach((x) => {
            const { w, h } = escala(x);
            pg.drawImage(x.img, { x: (ancho - w) / 2, y: yTop - h, width: w, height: h });
            yTop -= h + 4;
          });
          textoPdf(partes.encabezado.texto).split('\n').filter(Boolean).forEach((l) => {
            const w = fuentes.normal.widthOfTextAtSize(l, 8);
            pg.drawText(l, { x: (ancho - w) / 2, y: yTop - 9, size: 8, font: fuentes.normal });
            yTop -= 11;
          });
          let yBot = 20;
          pie.forEach((x) => {
            const { w, h } = escala(x);
            pg.drawImage(x.img, { x: (ancho - w) / 2, y: yBot, width: w, height: h });
            yBot += h + 4;
          });
          textoPdf(partes.pie.texto).split('\n').filter(Boolean).reverse().forEach((l) => {
            const w = fuentes.normal.widthOfTextAtSize(l, 8);
            pg.drawText(l, { x: (ancho - w) / 2, y: yBot, size: 8, font: fuentes.normal });
            yBot += 11;
          });
        },
      };
    }
  }
  return null;
}

async function imagenAJpeg(blob) {
  const bmp = await createImageBitmap(blob);
  const max = 2200;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const salida = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
  return { bytes: new Uint8Array(await salida.arrayBuffer()), ancho: c.width, alto: c.height };
}

async function bloquesDeAnexo(a) {
  if (a.origen === 'texto') return textoABloques(a.contenido);
  const arch = await Archivos.leer(a.llenadoId || a.archivoId);
  if (!arch) return [{ t: 'p', texto: '[No se encontró el archivo del anexo]' }];
  const { parrafos } = await abrirDocx(arch.blob);
  return parrafos.map((x) => ({ t: 'p', texto: x.texto }));
}

// ---------- Folios ----------

function estamparFolio(pagina, texto, fuente, posicion) {
  const tam = 10;
  const box = pagina.getCropBox();
  const rot = ((pagina.getRotation().angle % 360) + 360) % 360;
  const W = box.width;
  const H = box.height;
  const [VW, VH] = rot % 180 ? [H, W] : [W, H];
  const tw = fuente.widthOfTextAtSize(texto, tam);
  const m = 22;
  const vx = posicion.endsWith('der') ? VW - m - tw : posicion.endsWith('izq') ? m : (VW - tw) / 2;
  const vy = posicion.startsWith('sup') ? VH - m - tam : m;
  let x;
  let y;
  if (rot === 90) { x = W - vy; y = vx; }
  else if (rot === 180) { x = W - vx; y = H - vy; }
  else if (rot === 270) { x = vy; y = H - vx; }
  else { x = vx; y = vy; }
  pagina.drawRectangle({
    x: box.x + x - 3 + (rot === 90 ? -tam - 3 : rot === 270 ? 0 : 0),
    y: box.y + y - 3 + (rot === 180 ? -tam - 3 : 0),
    width: rot % 180 ? tam + 6 : tw + 6,
    height: rot % 180 ? tw + 6 : tam + 6,
    color: PDFLib.rgb(1, 1, 1),
    opacity: 0.85,
  });
  pagina.drawText(texto, { x: box.x + x, y: box.y + y, size: tam, font: fuente, rotate: PDFLib.degrees(rot) });
}

// ---------- Generación ----------

const Expediente = {
  resolver: resolverEstructura,

  async pdf(p, progreso = () => {}) {
    const o = { indice: true, folioPos: 'sup-der', folioFormato: 'Folio {n}', folioInicio: 1, folioDigitos: 4, folioOrden: 'asc', margenSupCm: 4, margenInfCm: 3, ...(p.opcionesExpediente || {}) };
    const opciones = { margenSupPt: (+o.margenSupCm || 0) * 28.35, margenInfPt: (+o.margenInfCm || 0) * 28.35 };
    const { piezas, avisos } = resolverEstructura(p);
    if (!piezas.length) throw new Error('La estructura del expediente está vacía.');
    const out = await PDFLib.PDFDocument.create();
    const fuentes = { normal: await out.embedFont(PDFLib.StandardFonts.Helvetica), negrita: await out.embedFont(PDFLib.StandardFonts.HelveticaBold) };
    const membrete = await prepararMembrete(out, fuentes);
    const lienzo = crearLienzo(out, fuentes, membrete, opciones);
    const inicios = [];
    for (const [i, pz] of piezas.entries()) {
      progreso(`Procesando ${i + 1} de ${piezas.length}: ${pz.titulo}`);
      inicios.push(out.getPageCount());
      try {
        if (pz.bloques) lienzo.bloques(pz.bloques);
        else if (pz.anexo) {
          const firmado = pz.anexo.firmadoId && await Archivos.leer(pz.anexo.firmadoId);
          if (firmado) await agregarArchivo(out, firmado);
          else {
            // Los anexos llenados desde texto van sobre la hoja membretada; los de Word de la entidad, sin ella.
            const l = pz.anexo.origen === 'texto' ? lienzo : crearLienzo(out, fuentes, null, opciones);
            l.bloques(await bloquesDeAnexo(pz.anexo));
          }
        } else {
          const a = await Archivos.leer(pz.archivoId);
          if (!a) { avisos.push(`No se encontró el archivo de "${pz.titulo}".`); continue; }
          await agregarArchivo(out, a, avisos, pz.titulo);
        }
      } catch (e) {
        avisos.push(`Error al incluir "${pz.titulo}": ${e.message}`);
      }
    }

    // Índice con número de folio de cada pieza.
    let paginasIndice = 0;
    if (o.indice) {
      progreso('Generando índice…');
      let estimado = 1;
      for (let intento = 0; intento < 4; intento++) {
        const total = out.getPageCount() + estimado;
        const folio = (k) => (o.folioOrden === 'desc' ? (+o.folioInicio || 1) + total - 1 - k : (+o.folioInicio || 1) + k);
        const filas = [['N.°', 'Contenido', 'Folio']];
        let n = 0;
        piezas.forEach((pz, i) => {
          const txt = pz.separador ? pz.titulo.toUpperCase() : '      ' + pz.titulo;
          filas.push([pz.separador ? '' : String(++n), txt, pad(folio(inicios[i] + estimado), +o.folioDigitos || 1)]);
        });
        const idx = await PDFLib.PDFDocument.create();
        const fIdx = { normal: await idx.embedFont(PDFLib.StandardFonts.Helvetica), negrita: await idx.embedFont(PDFLib.StandardFonts.HelveticaBold) };
        crearLienzo(idx, fIdx, await prepararMembrete(idx, fIdx), opciones).bloques([{ t: 'titulo', texto: 'ÍNDICE' }, { t: 'tabla', filas }]);
        if (idx.getPageCount() === estimado || intento === 3) {
          const copias = await out.copyPages(idx, idx.getPageIndices());
          copias.forEach((pg, k) => out.insertPage(k, pg));
          paginasIndice = copias.length;
          break;
        }
        estimado = idx.getPageCount();
      }
    }

    progreso('Foliando…');
    const total = out.getPageCount();
    const fuenteFolio = fuentes.negrita;
    out.getPages().forEach((pg, k) => {
      const n = o.folioOrden === 'desc' ? (+o.folioInicio || 1) + total - 1 - k : (+o.folioInicio || 1) + k;
      estamparFolio(pg, String(o.folioFormato || '{n}').replace('{n}', pad(n, +o.folioDigitos || 1)), fuenteFolio, o.folioPos);
    });
    progreso('Guardando PDF…');
    const bytes = await out.save();
    return { blob: new Blob([bytes], { type: 'application/pdf' }), paginas: total, paginasIndice, avisos };
  },

  async zip(p, progreso = () => {}) {
    const { piezas, avisos } = resolverEstructura(p);
    if (!piezas.length) throw new Error('La estructura del expediente está vacía.');
    const membreteDocx = state.membrete && state.membrete.docxId ? await Archivos.leer(state.membrete.docxId) : null;
    const zip = new JSZip();
    const raiz = zip.folder(nombreSeguro(`Expediente ${p.nomenclatura || ''}`));
    let carpeta = raiz;
    let nCarpeta = 0;
    let nArchivo = 0;
    for (const [i, pz] of piezas.entries()) {
      progreso(`Agregando ${i + 1} de ${piezas.length}: ${pz.titulo}`);
      if (pz.separador) {
        const sub = pz.bloques[0].subtitulo;
        carpeta = raiz.folder(`${pad(++nCarpeta, 2)} ${nombreSeguro(pz.titulo + (sub ? ' - ' + sub : ''), 80)}`);
        nArchivo = 0;
        carpeta.file(`${pad(nArchivo++, 2)} Separador - ${nombreSeguro(pz.titulo, 50)}.docx`, await docxDesdeMembrete(membreteDocx && membreteDocx.blob, pz.bloques));
        continue;
      }
      const base = `${pad(nArchivo++, 2)} ${nombreSeguro(pz.titulo)}`;
      try {
        if (pz.bloques) carpeta.file(base + '.docx', await docxDesdeMembrete(membreteDocx && membreteDocx.blob, pz.bloques));
        else if (pz.anexo) {
          const a = pz.anexo;
          if (a.origen === 'texto') carpeta.file(base + '.docx', await docxDesdeMembrete(membreteDocx && membreteDocx.blob, textoABloques(a.contenido)));
          else {
            const d = await Archivos.leer(a.llenadoId || a.archivoId);
            if (d) carpeta.file(base + '.docx', d.blob);
          }
          const f = a.firmadoId && await Archivos.leer(a.firmadoId);
          if (f) carpeta.file(base + ' (firmado).pdf', f.blob);
        } else {
          const a = await Archivos.leer(pz.archivoId);
          if (!a) { avisos.push(`No se encontró el archivo de "${pz.titulo}".`); continue; }
          const ext = (a.nombre.match(/\.[a-z0-9]+$/i) || [''])[0];
          carpeta.file(base + ext, a.blob);
        }
      } catch (e) {
        avisos.push(`Error al incluir "${pz.titulo}": ${e.message}`);
      }
    }
    progreso('Comprimiendo…');
    return { blob: await zip.generateAsync({ type: 'blob' }), avisos };
  },

  async separadorDocx(titulo, subtitulo) {
    const m = state.membrete && state.membrete.docxId ? await Archivos.leer(state.membrete.docxId) : null;
    return docxDesdeMembrete(m && m.blob, [{ t: 'separador', texto: titulo, subtitulo }]);
  },
};

async function agregarArchivo(out, a, avisos = [], titulo = a.nombre) {
  if (esPdf(a)) {
    const src = await PDFLib.PDFDocument.load(await a.blob.arrayBuffer(), { ignoreEncryption: true });
    const pags = await out.copyPages(src, src.getPageIndices());
    pags.forEach((pg) => out.addPage(pg));
  } else if (esImagen(a)) {
    const { bytes, ancho, alto } = await imagenAJpeg(a.blob);
    const img = await out.embedJpg(bytes);
    const horizontal = ancho > alto * 1.15;
    const [W, H] = horizontal ? [A4[1], A4[0]] : A4;
    const m = 24;
    const k = Math.min((W - 2 * m) / ancho, (H - 2 * m) / alto);
    const pg = out.addPage([W, H]);
    pg.drawImage(img, { x: (W - ancho * k) / 2, y: (H - alto * k) / 2, width: ancho * k, height: alto * k });
  } else {
    avisos.push(`"${titulo}" no es PDF ni imagen (${a.nombre}); conviértelo a PDF para incluirlo en el expediente.`);
  }
}

// ---------- Tiempo de experiencia ----------

function aFecha(s, finDeMes) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return null;
  const d = m[3] ? +m[3] : finDeMes ? new Date(+m[1], +m[2], 0).getDate() : 1;
  return new Date(+m[1], +m[2] - 1, d);
}

function mesesEntre(inicio, fin) {
  const a = aFecha(inicio);
  const b = aFecha(fin, true) || new Date();
  if (!a || b < a) return 0;
  return Math.round(((b - a) / 86400000 + 1) / 30.4375 * 10) / 10;
}

function mesesSinTraslape(exps) {
  const rangos = exps.map((x) => [aFecha(x.inicio), aFecha(x.fin, true) || new Date()]).filter(([a, b]) => a && b >= a).sort((x, y) => x[0] - y[0]);
  let dias = 0;
  let actual = null;
  for (const [a, b] of rangos) {
    if (!actual || a > actual[1]) {
      if (actual) dias += (actual[1] - actual[0]) / 86400000 + 1;
      actual = [a, b];
    } else if (b > actual[1]) actual[1] = b;
  }
  if (actual) dias += (actual[1] - actual[0]) / 86400000 + 1;
  return Math.round((dias / 30.4375) * 10) / 10;
}

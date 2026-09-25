'use strict';
// Lectura y generación de documentos Word (.docx) en el navegador con JSZip.

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // Caracteres de control no permitidos en XML
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

// Texto simple ("## " subtítulos, "- " viñetas, "| a | b |" filas de tabla) -> bloques.
function textoABloques(texto) {
  const bloques = [];
  let tabla = null;
  let blancoPrevio = false;
  for (const linea of String(texto || '').split(/\r?\n/)) {
    const l = linea.trim();
    if (/^\|.*\|$/.test(l)) {
      const celdas = l.slice(1, -1).split('|').map((c) => c.trim());
      if (celdas.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separador de encabezado markdown
      if (!tabla) { tabla = { t: 'tabla', filas: [] }; bloques.push(tabla); }
      tabla.filas.push(celdas);
      blancoPrevio = false;
      continue;
    }
    tabla = null;
    if (!l) {
      if (!blancoPrevio && bloques.length) bloques.push({ t: 'p', texto: '' });
      blancoPrevio = true;
      continue;
    }
    blancoPrevio = false;
    const h = l.match(/^#{1,6}\s+(.*)/);
    const b = l.match(/^[-*•]\s+(.*)/);
    if (h) bloques.push({ t: 'h', texto: h[1] });
    else if (b) bloques.push({ t: 'li', texto: b[1] });
    else bloques.push({ t: 'p', texto: l.replace(/\*\*(.+?)\*\*/g, '$1') });
  }
  return bloques;
}

function runXml(texto, { negrita = false, tam = 0 } = {}) {
  const rpr = (negrita || tam) ? `<w:rPr>${negrita ? '<w:b/>' : ''}${tam ? `<w:sz w:val="${tam}"/><w:szCs w:val="${tam}"/>` : ''}</w:rPr>` : '';
  return String(texto).split('\n').map((parte, i) => `<w:r>${rpr}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${escXml(parte)}</w:t></w:r>`).join('');
}

function parrafoXml(texto, { jc = 'both', negrita = false, tam = 0, antes = 0, despues = 120, saltoAntes = false } = {}) {
  return `<w:p><w:pPr>${saltoAntes ? '<w:pageBreakBefore/>' : ''}<w:spacing w:before="${antes}" w:after="${despues}"/><w:jc w:val="${jc}"/></w:pPr>${texto ? runXml(texto, { negrita, tam }) : ''}</w:p>`;
}

function tablaXml(filas) {
  const n = Math.max(...filas.map((f) => f.length));
  const ancho = Math.floor(9000 / n);
  const borde = (lado) => `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(borde).join('')}</w:tblBorders></w:tblPr>
<w:tblGrid>${Array.from({ length: n }, () => `<w:gridCol w:w="${ancho}"/>`).join('')}</w:tblGrid>
${filas.map((f, i) => `<w:tr>${Array.from({ length: n }, (_, j) => `<w:tc><w:tcPr><w:tcW w:w="${ancho}" w:type="dxa"/></w:tcPr>${parrafoXml(f[j] || '', { jc: 'left', negrita: i === 0 && filas.length > 1, despues: 0 })}</w:tc>`).join('')}</w:tr>`).join('')}
</w:tbl>${parrafoXml('')}`;
}

function bloquesXml(bloques) {
  let primero = true;
  return bloques.map((b) => {
    const saltoAntes = b.t === 'salto';
    let xml = '';
    if (b.t === 'salto') xml = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    else if (b.t === 'separador') {
      xml = parrafoXml(b.texto, { jc: 'center', negrita: true, tam: 56, antes: primero ? 4800 : 0 })
        + (b.subtitulo ? parrafoXml(b.subtitulo, { jc: 'center', tam: 32, antes: 240 }) : '');
    } else if (b.t === 'titulo') xml = parrafoXml(b.texto, { jc: 'center', negrita: true, tam: 26, despues: 240 });
    else if (b.t === 'h') xml = parrafoXml(b.texto, { jc: 'left', negrita: true, antes: 200 });
    else if (b.t === 'li') xml = parrafoXml('•  ' + b.texto, { jc: 'both' });
    else if (b.t === 'tabla') xml = tablaXml(b.filas);
    else xml = parrafoXml(b.texto, { jc: b.centro ? 'center' : b.derecha ? 'right' : 'both', negrita: b.negrita });
    primero = saltoAntes;
    return xml;
  }).join('\n');
}

async function docxMinimo() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}"><w:body><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'blob' });
}

// Crea un .docx con los bloques dados, conservando encabezado, pie, márgenes y estilos de la hoja membretada.
async function docxDesdeMembrete(membreteBlob, bloques) {
  const zip = await JSZip.loadAsync(membreteBlob || await docxMinimo());
  const archivo = zip.file('word/document.xml');
  if (!archivo) throw new Error('La hoja membretada no es un Word (.docx) válido.');
  let xml = await archivo.async('string');
  const inicio = xml.search(/<w:body[^>]*>/);
  const fin = xml.lastIndexOf('</w:body>');
  if (inicio < 0 || fin < 0) throw new Error('No se pudo leer el cuerpo de la hoja membretada.');
  const apertura = xml.slice(inicio).match(/<w:body[^>]*>/)[0];
  const cuerpo = xml.slice(inicio + apertura.length, fin);
  const sect = (cuerpo.match(/<w:sectPr[\s\S]*<\/w:sectPr>\s*$/) || [''])[0];
  xml = xml.slice(0, inicio + apertura.length) + bloquesXml(bloques) + sect + xml.slice(fin);
  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'blob', mimeType: MIME_DOCX });
}

// ----- Anexos en Word: leer párrafos y reemplazar su texto -----

async function abrirDocx(blob) {
  const zip = await JSZip.loadAsync(blob);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('El archivo no es un Word (.docx) válido.');
  const doc = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
  const todos = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));
  // Solo párrafos "hoja" (sin párrafos anidados, p. ej. dentro de cuadros de texto).
  const parrafos = todos.filter((p) => !p.getElementsByTagNameNS(W_NS, 'p').length).map((el) => {
    let enTabla = false;
    for (let n = el.parentNode; n; n = n.parentNode) if (n.localName === 'tc') { enTabla = true; break; }
    const texto = Array.from(el.getElementsByTagNameNS(W_NS, 't')).map((t) => t.textContent).join('');
    return { el, texto, enTabla };
  });
  return { zip, doc, parrafos };
}

function reemplazarParrafo(doc, el, texto) {
  const ts = Array.from(el.getElementsByTagNameNS(W_NS, 't'));
  let run;
  let ref;
  if (ts.length) {
    ref = ts[0];
    run = ref.parentNode;
    ts.slice(1).forEach((t) => t.parentNode.removeChild(t));
    // Quita saltos de línea previos (no de página) para no duplicarlos.
    Array.from(el.getElementsByTagNameNS(W_NS, 'br'))
      .filter((br) => br.getAttributeNS(W_NS, 'type') !== 'page')
      .forEach((br) => br.parentNode.removeChild(br));
  } else {
    run = doc.createElementNS(W_NS, 'w:r');
    ref = doc.createElementNS(W_NS, 'w:t');
    run.appendChild(ref);
    el.appendChild(run);
  }
  const partes = String(texto).split('\n');
  ref.textContent = partes[0];
  ref.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  let despues = ref;
  for (const parte of partes.slice(1)) {
    const br = doc.createElementNS(W_NS, 'w:br');
    const t = doc.createElementNS(W_NS, 'w:t');
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    t.textContent = parte;
    run.insertBefore(br, despues.nextSibling);
    run.insertBefore(t, br.nextSibling);
    despues = t;
  }
}

async function llenarDocx(blob, reemplazos) {
  const { zip, doc, parrafos } = await abrirDocx(blob);
  let aplicados = 0;
  for (const r of reemplazos) {
    const p = parrafos[r.indice];
    if (!p || r.texto === p.texto) continue;
    reemplazarParrafo(doc, p.el, r.texto);
    aplicados++;
  }
  let xml = new XMLSerializer().serializeToString(doc);
  if (!xml.startsWith('<?xml')) xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml;
  zip.file('word/document.xml', xml);
  return { blob: await zip.generateAsync({ type: 'blob', mimeType: MIME_DOCX }), aplicados };
}

async function textoDeDocx(blob) {
  const r = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() });
  return r.value;
}

// ----- Imágenes y textos del encabezado/pie de la hoja membretada (para el PDF) -----

async function partesMembrete(blob) {
  const zip = await JSZip.loadAsync(blob);
  const res = { encabezado: { imagenes: [], texto: '' }, pie: { imagenes: [], texto: '' } };
  const rels = async (ruta) => {
    const f = zip.file(ruta);
    if (!f) return {};
    const d = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
    const m = {};
    Array.from(d.getElementsByTagName('Relationship')).forEach((r) => { m[r.getAttribute('Id')] = r.getAttribute('Target'); });
    return m;
  };
  const docRels = await rels('word/_rels/document.xml.rels');
  const docXml = await zip.file('word/document.xml').async('string');
  const refs = [...docXml.matchAll(/<w:(header|footer)Reference\b[^>]*>/g)].map((m) => ({
    clase: m[1],
    tipo: (m[0].match(/w:type="(\w+)"/) || [])[1] || 'default',
    id: (m[0].match(/r:id="(\w+)"/) || [])[1],
  })).filter((r) => r.tipo === 'default');
  for (const ref of refs) {
    const destino = docRels[ref.id];
    if (!destino) continue;
    const ruta = 'word/' + destino.replace(/^\/?word\//, '');
    const f = zip.file(ruta);
    if (!f) continue;
    const xml = await f.async('string');
    const parte = ref.clase === 'header' ? res.encabezado : res.pie;
    const d = new DOMParser().parseFromString(xml, 'application/xml');
    parte.texto = Array.from(d.getElementsByTagNameNS(W_NS, 'p'))
      .map((p) => Array.from(p.getElementsByTagNameNS(W_NS, 't')).map((t) => t.textContent).join(''))
      .filter((t) => t.trim()).join('\n');
    const mapa = await rels(ruta.replace(/([^/]+)$/, '_rels/$1.rels'));
    const blips = [...xml.matchAll(/<(?:wp:extent)\s+cx="(\d+)"\s+cy="(\d+)"[\s\S]*?r:embed="(\w+)"/g)];
    for (const [, cx, cy, rid] of blips) {
      const t = mapa[rid];
      if (!t) continue;
      const img = zip.file('word/' + t.replace(/^\/?word\//, '').replace(/^\.\.\//, ''));
      if (!img || !/\.(png|jpe?g)$/i.test(t)) continue;
      parte.imagenes.push({
        bytes: await img.async('uint8array'),
        png: /\.png$/i.test(t),
        anchoPt: +cx / 12700,
        altoPt: +cy / 12700,
      });
    }
  }
  return res;
}

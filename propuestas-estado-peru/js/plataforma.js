'use strict';
// Detecta si la app corre dentro de claude.ai (como Artifact) y ofrece:
// - Claude directo con la cuenta del usuario (capacidad "sample"),
// - descargas mediante el sistema de claude.ai (capacidad "downloads"),
// - avisos y confirmaciones propios (claude.ai no muestra alert/confirm).

const Plataforma = {
  enClaude: Boolean(window.claude && typeof window.claude.use === 'function'),
  sample: null,
  downloads: null,
  limites: null,
};

if (Plataforma.enClaude) {
  window.claude.use('sample').then(async (s) => {
    Plataforma.sample = s;
    if (s) Plataforma.limites = await s.limits().catch(() => null);
    if (typeof render === 'function') render();
  }).catch(() => {});
  window.claude.use('downloads').then((d) => { Plataforma.downloads = d; }).catch(() => {});
}

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
}

// ---------- Ventanas propias de aviso y confirmación ----------

function ventana(html, botones) {
  return new Promise((resolver) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialogo-aviso';
    dlg.innerHTML = `<div class="dialogo-texto">${html}</div><div class="fila">${botones.map((b, i) => `<button class="btn ${b.primario ? 'primario' : ''}" data-i="${i}">${esc(b.texto)}</button>`).join('')}</div>`;
    document.body.appendChild(dlg);
    const cerrar = (valor) => { dlg.close(); dlg.remove(); resolver(valor); };
    dlg.querySelectorAll('button').forEach((b) => { b.onclick = () => cerrar(botones[+b.dataset.i].valor); });
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); cerrar(botones[botones.length - 1].valor); });
    dlg.showModal();
    dlg.querySelector('button.primario')?.focus();
  });
}

const textoAHtmlSimple = (t) => esc(t).replace(/\n/g, '<br>');

function avisar(mensaje) {
  return ventana(textoAHtmlSimple(mensaje), [{ texto: 'Entendido', valor: true, primario: true }]);
}

function confirmar(mensaje, { si = 'Aceptar', no = 'Cancelar' } = {}) {
  return ventana(textoAHtmlSimple(mensaje), [{ texto: si, valor: true, primario: true }, { texto: no, valor: false }]);
}

// ---------- Descargas ----------

async function descargar(nombre, contenido, tipo) {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  if (Plataforma.enClaude) {
    if (!Plataforma.downloads) {
      avisar('Las descargas no están disponibles en esta vista de claude.ai.');
      return;
    }
    try {
      await Plataforma.downloads.save({ filename: nombre, data: blob });
    } catch (e) {
      if (e && e.code === 'declined') return;
      if (e && e.code === 'rejected_extension') avisar(`claude.ai no permite descargar archivos "${nombre.split('.').pop()}".`);
      else if (e && e.code === 'rate_limited') avisar('Ya hay una descarga esperando tu confirmación.');
      else avisar('No se pudo descargar el archivo.');
    }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Lectura de PDF (texto o imágenes de páginas escaneadas) ----------

function base64ABytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function textoDePdf(base64) {
  if (!window.pdfjsLib) throw new Error('No se cargó el lector de PDF.');
  const pdf = await window.pdfjsLib.getDocument({ data: base64ABytes(base64) }).promise;
  const paginas = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pag = await pdf.getPage(n);
    const tc = await pag.getTextContent();
    let texto = '';
    let yPrevio = null;
    for (const it of tc.items) {
      const y = it.transform ? it.transform[5] : null;
      if (yPrevio !== null && y !== null && Math.abs(y - yPrevio) > 2) texto += '\n';
      texto += it.str;
      if (it.hasEOL) texto += '\n';
      yPrevio = y;
    }
    paginas.push(`[Página ${n}]\n${texto.replace(/\n{3,}/g, '\n\n').trim()}`);
  }
  return { texto: paginas.join('\n\n'), paginas: pdf.numPages, pdf };
}

async function imagenesDePdf(pdf, maximo) {
  const imgs = [];
  for (let n = 1; n <= Math.min(pdf.numPages, maximo); n++) {
    const pag = await pdf.getPage(n);
    const vp = pag.getViewport({ scale: 1.6 });
    const c = document.createElement('canvas');
    c.width = vp.width;
    c.height = vp.height;
    await pag.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    imgs.push(await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85)));
  }
  return imgs;
}

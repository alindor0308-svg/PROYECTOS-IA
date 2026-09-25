'use strict';
// Archivos (sustentos, anexos, hoja membretada) guardados en IndexedDB de este navegador.

const Archivos = (() => {
  let dbPromesa = null;

  function db() {
    if (!dbPromesa) {
      dbPromesa = new Promise((ok, mal) => {
        const req = indexedDB.open('propuestas-peru-archivos', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('archivos', { keyPath: 'id' });
        req.onsuccess = () => ok(req.result);
        req.onerror = () => mal(req.error);
      });
    }
    return dbPromesa;
  }

  async function tx(modo, fn) {
    const d = await db();
    return new Promise((ok, mal) => {
      const t = d.transaction('archivos', modo);
      const r = fn(t.objectStore('archivos'));
      t.oncomplete = () => ok(r && r.result);
      t.onerror = () => mal(t.error);
      t.onabort = () => mal(t.error || new Error('Operación cancelada (¿sin espacio?)'));
    });
  }

  return {
    async guardar(blob, nombre, id = uid()) {
      await tx('readwrite', (s) => s.put({ id, nombre, tipo: blob.type, blob, fecha: Date.now() }));
      return id;
    },
    async leer(id) {
      if (!id) return null;
      return tx('readonly', (s) => s.get(id));
    },
    async borrar(id) {
      if (id) await tx('readwrite', (s) => s.delete(id));
    },
    async todos() {
      return tx('readonly', (s) => s.getAll());
    },
    async abrir(id) {
      const a = await this.leer(id);
      if (!a) { avisar('El archivo ya no está en este navegador.'); return; }
      if (Plataforma.enClaude) { descargar(a.nombre, a.blob, a.tipo); return; }
      const url = URL.createObjectURL(a.blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    async descargar(id, nombre) {
      const a = await this.leer(id);
      if (!a) { avisar('El archivo ya no está en este navegador.'); return; }
      descargar(nombre || a.nombre, a.blob, a.tipo);
    },
  };
})();

function blobABase64(blob) {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(r.result.slice(r.result.indexOf(',') + 1));
    r.onerror = () => mal(r.error);
    r.readAsDataURL(blob);
  });
}

const esPdf = (a) => a && (a.tipo === 'application/pdf' || /\.pdf$/i.test(a.nombre));
const esImagen = (a) => a && (/^image\//.test(a.tipo) || /\.(jpe?g|png|gif|webp|bmp)$/i.test(a.nombre));
const esDocx = (a) => a && /\.docx$/i.test(a.nombre);

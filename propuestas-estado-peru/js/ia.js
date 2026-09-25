'use strict';
// Asistente con Claude. Dos modos:
// - "plan": sin costo extra. La app arma el pedido, el usuario lo pega en claude.ai (con su plan)
//   y pega la respuesta de vuelta.
// - "api": automático con una API key de Anthropic (se cobra aparte en console.anthropic.com).

const CLAVE_API = 'ppe-api-key';

function leerApiKey() {
  try {
    return sessionStorage.getItem(CLAVE_API) || localStorage.getItem(CLAVE_API) || '';
  } catch (e) {
    return '';
  }
}

function guardarApiKey(key, recordar) {
  try {
    sessionStorage.removeItem(CLAVE_API);
    localStorage.removeItem(CLAVE_API);
    if (!key) return;
    (recordar ? localStorage : sessionStorage).setItem(CLAVE_API, key);
  } catch (e) { /* almacenamiento no disponible */ }
}

const SISTEMA_BASE = `Eres un especialista en contrataciones públicas del Perú (Ley N.° 32069, Ley General de Contrataciones Públicas, su Reglamento y las bases estándar vigentes). Ayudas a una empresa postora a preparar ofertas para procedimientos de selección de obras, servicios, consultorías y bienes.

Reglas:
- Escribe en español formal y técnico, como se presenta una oferta ante una entidad pública peruana.
- Nunca inventes datos del postor: experiencia, montos, nombres, títulos, certificaciones, equipos o fechas. Usa solo lo que se te entrega. Si falta un dato necesario, deja un marcador visible con el formato [COMPLETAR: descripción del dato].
- Ajusta el contenido a lo que exigen las bases, los términos de referencia o el expediente técnico, citando la sección o numeral cuando lo tengas.
- Si algo de las bases es ambiguo, dilo en lugar de suponer.`;

const IA = {
  modo() {
    // Dentro de claude.ai la app habla directo con Claude usando la cuenta del usuario.
    if (typeof Plataforma !== 'undefined' && Plataforma.sample) return 'claude';
    const cfg = (typeof state !== 'undefined' && state.config) || {};
    return cfg.modoIA === 'api' && leerApiKey() && typeof window.Anthropic === 'function' ? 'api' : 'plan';
  },

  disponible() {
    return true;
  },

  cliente() {
    const apiKey = leerApiKey();
    if (!apiKey) throw new Error('Configura tu API key de Anthropic en la pestaña "Configuración".');
    if (typeof window.Anthropic !== 'function') throw new Error('No se cargó la librería de Anthropic (vendor/anthropic-sdk.js).');
    return new window.Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  },

  // Parámetros comunes según el modelo elegido.
  parametros(config, extraOutput = {}) {
    const model = config.modelo || 'claude-opus-5';
    const p = { model };
    const output = { ...extraOutput };
    if (model !== 'claude-haiku-4-5') {
      p.thinking = { type: 'adaptive' };
      output.effort = config.esfuerzo || 'high';
    }
    if (Object.keys(output).length) p.output_config = output;
    if (model === 'claude-opus-5') {
      // Si el modelo declina una solicitud, la API la reintenta con el modelo alternativo recomendado.
      p.betas = ['server-side-fallback-2026-07-01'];
      p.fallbacks = 'default';
    }
    return p;
  },

  verificarRespuesta(msg) {
    if (msg.stop_reason === 'refusal') {
      throw new Error('El modelo declinó la solicitud. Revisa el contenido enviado e inténtalo de nuevo.');
    }
    if (msg.stop_reason === 'max_tokens') {
      throw new Error('La respuesta se cortó por longitud. Intenta con un documento más corto o por partes.');
    }
  },

  textoDe(msg) {
    return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  },

  describirError(e) {
    if (e && e.message === 'Cancelado.') return '';
    if (e && typeof e.code === 'string' && !(e instanceof Error)) return mensajeSample(e);
    const A = window.Anthropic;
    if (A && e instanceof A.AuthenticationError) return 'API key inválida. Revísala en Configuración.';
    if (A && e instanceof A.RateLimitError) return 'Límite de uso alcanzado. Espera un momento y vuelve a intentar.';
    if (A && e instanceof A.BadRequestError) return 'Solicitud rechazada por la API: ' + (e.message || '');
    if (A && e instanceof A.APIConnectionError) return 'No hay conexión con la API de Anthropic.';
    return e.message || String(e);
  },

  // Bloques de contexto (bases en PDF y/o texto) reutilizables entre llamadas, con caché de prompt.
  bloquesBases({ pdfBase64, pdfNombre, texto }) {
    const bloques = [];
    if (pdfBase64) {
      bloques.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
        title: pdfNombre || 'Bases del procedimiento',
      });
    }
    if (texto && texto.trim()) {
      bloques.push({ type: 'text', text: `<bases>\n${texto}\n</bases>` });
    }
    if (bloques.length) bloques[bloques.length - 1].cache_control = { type: 'ephemeral' };
    return bloques;
  },

  async analizarBases(config, fuente) {
    const bloques = IA.bloquesBases(fuente);
    if (!bloques.length) throw new Error('Sube el PDF de las bases o pega su texto.');
    return ejecutarJson(config, {
      titulo: 'Analizar bases',
      bloques,
      esquema: ESQUEMA_ANALISIS,
      pedido: `Analiza las bases y extrae la información para preparar la oferta.
- Usa "" o 0 cuando un dato no figure en las bases; no lo supongas.
- Fechas del cronograma en formato AAAA-MM-DD cuando se puedan determinar; si no, deja la fecha como aparece.
- En "requisitos" incluye cada documento o condición que el postor debe presentar o cumplir, clasificado en Admisión, Calificación, Evaluación o Contrato, con la referencia al numeral de las bases.
- En "alertas" anota plazos críticos, penalidades altas, requisitos difíciles de cumplir, inconsistencias o puntos que convendría consultar u observar.`,
    });
  },

  async redactarSeccion(config, { fuente, contexto, seccion, instrucciones, borradorActual }, alTexto) {
    const pedido = `Redacta la sección "${seccion}" de la propuesta técnica para este procedimiento.

${contexto}

${borradorActual ? `Borrador actual de la sección (mejóralo y consérvale los datos correctos):\n<borrador>\n${borradorActual}\n</borrador>\n` : ''}${instrucciones ? `Indicaciones del usuario: ${instrucciones}\n` : ''}
Formato de salida: texto listo para pegar en la oferta, sin preámbulos ni comentarios sobre lo que haces. Usa "## " para subtítulos, "- " para viñetas y párrafos separados por una línea en blanco. No uses negritas ni tablas.`;
    return ejecutarTexto(config, { titulo: `Redactar: ${seccion}`, bloques: IA.bloquesBases(fuente), pedido }, alTexto);
  },

  async revisarOferta(config, { fuente, contexto }, alTexto) {
    const pedido = `Actúa como el comité de selección y revisa la oferta que se describe a continuación frente a las bases.

${contexto}

Entrega:
## Riesgos de no admisión
## Riesgos en la calificación
## Cómo mejorar el puntaje
## Documentos que faltan
Sé concreto: cita el requisito de las bases y qué falta o qué corregir. Formato: "## " para títulos y "- " para viñetas.`;
    return ejecutarTexto(config, { titulo: 'Revisar oferta', bloques: IA.bloquesBases(fuente), pedido }, alTexto);
  },
};


// ---------- Ejecutores: API automática o modo "plan" (copiar y pegar en claude.ai) ----------

async function ejecutarJson(config, { titulo, bloques = [], pedido, esquema, maxTokens = 32000 }) {
  if (IA.modo() === 'claude') {
    const r = await pedirDirecto({ titulo, bloques, pedido, esquema });
    return completarSegunEsquema(r, esquema);
  }
  if (IA.modo() === 'plan') {
    const texto = await pedirAClaude({ titulo, bloques, pedido, esquema });
    return completarSegunEsquema(extraerJson(texto), esquema);
  }
  const client = IA.cliente();
  const stream = client.beta.messages.stream({
    ...IA.parametros(config, { format: { type: 'json_schema', schema: esquema } }),
    max_tokens: maxTokens,
    system: SISTEMA_BASE,
    messages: [{ role: 'user', content: [...bloques, { type: 'text', text: pedido }] }],
  });
  const msg = await stream.finalMessage();
  IA.verificarRespuesta(msg);
  return JSON.parse(IA.textoDe(msg));
}

async function ejecutarTexto(config, { titulo, bloques = [], pedido }, alTexto = () => {}) {
  if (IA.modo() === 'claude') return pedirDirecto({ titulo, bloques, pedido, alTexto });
  if (IA.modo() === 'plan') {
    const texto = (await pedirAClaude({ titulo, bloques, pedido })).trim();
    alTexto(texto);
    return texto;
  }
  const client = IA.cliente();
  const stream = client.beta.messages.stream({
    ...IA.parametros(config),
    max_tokens: 16000,
    system: SISTEMA_BASE,
    messages: [{ role: 'user', content: [...bloques, { type: 'text', text: pedido }] }],
  });
  stream.on('text', (delta) => alTexto(delta));
  const msg = await stream.finalMessage();
  IA.verificarRespuesta(msg);
  return IA.textoDe(msg);
}

// ---------- Modo "claude": directo desde claude.ai con la cuenta del usuario ----------

const LIMITE_PROMPT = 60000; // bytes; la capacidad acepta hasta 64 KiB por llamada
const bytes = (t) => new TextEncoder().encode(t).length;

function mensajeSample(e) {
  const m = {
    cancelled: '',
    not_granted: 'No diste permiso para que la app use tu cuenta de Claude. Vuelve a abrirla y acepta el permiso para usar la IA.',
    sampling_disabled: 'Claude no está disponible para tu cuenta en esta vista.',
    rate_limited: 'Llegaste al límite de uso de tu plan por ahora. Espera un rato y vuelve a intentar.',
    session_expired: 'Tu sesión de claude.ai expiró. Vuelve a iniciar sesión.',
    refused: 'Claude no quiso responder esta solicitud. Revisa el contenido e inténtalo con otra información.',
    prompt_too_large: 'El documento es demasiado grande para una sola consulta. Pega solo las secciones relevantes.',
    invalid_json: 'Claude respondió en un formato inesperado. Vuelve a intentarlo.',
    empty_completion: 'Claude no devolvió respuesta. Vuelve a intentarlo.',
    image_rejected: 'Una de las páginas escaneadas no se pudo enviar.',
  };
  return m[e.code] !== undefined ? m[e.code] : 'No se pudo completar la consulta con Claude. Vuelve a intentarlo en un momento.';
}

function estadoIA(texto) {
  let el = document.getElementById('estado-ia');
  if (!el) {
    el = document.createElement('div');
    el.id = 'estado-ia';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = texto;
  el.hidden = !texto;
}

// Convierte los adjuntos (PDF) en texto; si el PDF es escaneado, en imágenes de sus primeras páginas.
async function prepararDocumentos(bloques) {
  const textos = [];
  let imagenes = [];
  for (const b of bloques) {
    if (b.type === 'text') { textos.push(b.text); continue; }
    if (b.type !== 'document') continue;
    estadoIA(`Leyendo ${b.title}…`);
    const { texto, paginas, pdf } = await textoDePdf(b.source.data);
    const util = texto.replace(/\[Página \d+\]/g, '').replace(/\s+/g, '');
    if (util.length < 40 * paginas) {
      const max = (Plataforma.limites && Plataforma.limites.images && Plataforma.limites.images.maxCount) || 0;
      if (!max) throw new Error(`"${b.title}" parece escaneado (sin texto) y esta vista no puede enviar imágenes. Usa un PDF con texto o un Word.`);
      imagenes = imagenes.concat(await imagenesDePdf(pdf, max - imagenes.length));
      textos.push(`<documento nombre="${b.title}">(Documento escaneado: se adjuntan imágenes de sus primeras ${Math.min(paginas, max)} páginas.)</documento>`);
    } else {
      textos.push(`<documento nombre="${b.title}">\n${texto}\n</documento>`);
    }
  }
  return { documento: textos.join('\n\n'), imagenes };
}

// Si el documento no entra en una consulta, se extraen por partes los fragmentos relevantes para la tarea.
async function condensar(documento, pedido, sample, titulo) {
  const presupuesto = LIMITE_PROMPT - bytes(pedido) - 4000;
  if (bytes(documento) <= presupuesto) return documento;
  if (presupuesto < 8000) throw Object.assign(new Error('prompt_too_large'), { code: 'prompt_too_large' });
  const tam = 42000;
  const partes = [];
  let actual = '';
  for (const linea of documento.split('\n')) {
    if (bytes(actual) + bytes(linea) > tam && actual) { partes.push(actual); actual = ''; }
    actual += linea + '\n';
  }
  if (actual.trim()) partes.push(actual);
  const tarea = pedido.slice(0, 1500);
  const extractos = [];
  for (const [i, parte] of partes.entries()) {
    estadoIA(`${titulo}: leyendo el documento por partes (${i + 1} de ${partes.length})…`);
    const { text } = await sample(`Te paso un FRAGMENTO (parte ${i + 1} de ${partes.length}) de un documento de contratación pública del Perú.
La tarea final será esta:
<tarea>
${tarea}
</tarea>

Copia TEXTUALMENTE solo las partes del fragmento que sirvan para esa tarea (requisitos, perfiles, experiencia exigida, cronograma, montos, plazos, formatos y anexos, factores de evaluación, penalidades, garantías). Conserva numerales y títulos. No resumas ni comentes. Si nada sirve, responde solo: NADA

<fragmento>
${parte}
</fragmento>`, { cache: { gcTime: 3600000 } });
    if (!/^\s*NADA\s*$/i.test(text)) extractos.push(`[Extracto de la parte ${i + 1}]\n${text.trim()}`);
  }
  let resultado = extractos.join('\n\n');
  if (bytes(resultado) > presupuesto) {
    while (bytes(resultado) > presupuesto) resultado = resultado.slice(0, Math.floor(resultado.length * 0.9));
    resultado += '\n[… recortado por tamaño]';
  }
  return resultado;
}

async function pedirDirecto({ titulo, bloques, pedido, esquema, alTexto }) {
  const sample = Plataforma.sample;
  try {
    estadoIA(`${titulo}: preparando…`);
    const { documento, imagenes } = await prepararDocumentos(bloques);
    const formato = esquema
      ? `\n\nResponde ÚNICAMENTE con JSON válido (sin texto antes ni después) con exactamente esta estructura; donde dice "a | b" elige una sola opción:\n${JSON.stringify(ejemploDeEsquema(esquema))}`
      : '';
    const cabecera = `${SISTEMA_BASE}\n\n`;
    const doc = documento ? await condensar(documento, cabecera + pedido + formato, sample, titulo) : '';
    let prompt = `${cabecera}${doc ? doc + '\n\n' : ''}${pedido}${formato}`;
    if (bytes(prompt) > LIMITE_PROMPT) throw Object.assign(new Error('prompt_too_large'), { code: 'prompt_too_large' });
    estadoIA(`${titulo}: Claude está trabajando… (puede tardar 1-2 minutos)`);
    const opciones = { cache: false };
    if (imagenes.length) opciones.images = imagenes;
    if (esquema) return await sample.json(prompt, opciones);
    if (alTexto) {
      let previo = '';
      opciones.onText = ({ text }) => { alTexto(text.slice(previo.length)); previo = text; };
    }
    const r = await sample(prompt, opciones);
    if (r.truncated) avisar('La respuesta de Claude quedó incompleta por su longitud. Revisa el final del texto.');
    return r.text;
  } catch (e) {
    if (e && e.code === 'prompt_too_large') throw new Error(mensajeSample(e));
    throw e;
  } finally {
    estadoIA('');
  }
}

// Estructura de ejemplo a partir del esquema JSON, para explicarle el formato a Claude en el chat.
function ejemploDeEsquema(e) {
  if (e.type === 'object') return Object.fromEntries(Object.entries(e.properties).map(([k, v]) => [k, ejemploDeEsquema(v)]));
  if (e.type === 'array') return [ejemploDeEsquema(e.items)];
  if (e.enum) return e.enum.join(' | ');
  if (e.type === 'number' || e.type === 'integer') return 0;
  return '';
}

// Rellena campos faltantes y corrige tipos de una respuesta pegada a mano.
function completarSegunEsquema(v, e) {
  if (e.type === 'object') {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    Object.entries(e.properties).forEach(([k, sub]) => { o[k] = completarSegunEsquema(o[k], sub); });
    return o;
  }
  if (e.type === 'array') return Array.isArray(v) ? v.map((x) => completarSegunEsquema(x, e.items)) : [];
  if (e.type === 'number' || e.type === 'integer') {
    const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? (e.type === 'integer' ? Math.round(n) : n) : 0;
  }
  if (e.enum) return e.enum.includes(v) ? v : (e.enum.find((x) => String(v || '').toLowerCase().includes(x.toLowerCase())) || e.enum[e.enum.length - 1]);
  return v == null ? '' : String(v);
}

function extraerJson(texto) {
  const t = String(texto || '').trim();
  const bloque = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidato = bloque ? bloque[1] : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
  try {
    return JSON.parse(candidato);
  } catch (e) {
    throw new Error('La respuesta pegada no es un JSON válido. Copia la respuesta completa de Claude (el bloque que empieza con { y termina con }).');
  }
}

function armarPrompt({ bloques, pedido, esquema }) {
  const adjuntos = bloques.filter((b) => b.type === 'document').map((b) => b.title);
  const textos = bloques.filter((b) => b.type === 'text').map((b) => b.text);
  return `${SISTEMA_BASE}

${adjuntos.length ? `Documento(s) adjunto(s) en este mensaje: ${adjuntos.map((a) => `"${a}"`).join(', ')}. Léelo(s) completo(s).\n\n` : ''}${textos.join('\n\n')}${textos.length ? '\n\n' : ''}${pedido}${esquema ? `

IMPORTANTE: responde ÚNICAMENTE con un bloque \`\`\`json que tenga exactamente esta estructura (reemplaza los valores de ejemplo; donde dice "a | b" elige una sola opción):
${JSON.stringify(ejemploDeEsquema(esquema), null, 1)}` : ''}`;
}

// Abre la ventana de "copiar y pegar" y espera la respuesta que el usuario trae de claude.ai.
function pedirAClaude({ titulo, bloques, pedido, esquema }) {
  const prompt = armarPrompt({ bloques, pedido, esquema });
  const adjuntos = bloques.filter((b) => b.type === 'document');
  return new Promise((resolver, rechazar) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialogo-plan';
    dlg.innerHTML = `<h2>✨ ${esc(titulo || 'Pedir a Claude')}</h2>
      <p class="ayuda">Usa tu plan de Claude, sin costo extra. Sigue los 3 pasos:</p>
      <ol class="pasos">
        <li><strong>Copia el pedido</strong> <button class="btn primario" data-p="copiar">📋 Copiar pedido</button> <span class="ok-copiado" hidden>¡Copiado!</span>
          <details><summary>Ver el pedido (${prompt.length.toLocaleString('es-PE')} caracteres)</summary><textarea readonly rows="8">${esc(prompt)}</textarea></details></li>
        <li><strong>Abre Claude</strong>, pega el pedido${adjuntos.length ? ' y <strong>adjunta</strong> ' + adjuntos.map((a) => `<em>${esc(a.title)}</em> <button class="btn chico" data-p="bajar" data-n="${esc(a.title)}">⬇ bajarlo</button>`).join(', ') : ''} y envíalo.
          <a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">Abrir claude.ai ↗</a></li>
        <li><strong>Copia la respuesta completa de Claude</strong> (botón "Copiar" debajo de la respuesta) y pégala aquí:
          <textarea data-p="respuesta" rows="7" placeholder="${esquema ? 'Pega aquí la respuesta (el bloque JSON)…' : 'Pega aquí la respuesta de Claude…'}"></textarea></li>
      </ol>
      <p class="alerta error" data-p="error" hidden></p>
      <div class="fila"><button class="btn primario" data-p="cargar">Cargar respuesta</button><button class="btn" data-p="cancelar">Cancelar</button></div>`;
    document.body.appendChild(dlg);
    const q = (k) => dlg.querySelector(`[data-p="${k}"]`);
    const cerrar = () => { dlg.close(); dlg.remove(); };
    q('copiar').onclick = async () => {
      try {
        await navigator.clipboard.writeText(prompt);
      } catch (e) {
        const ta = dlg.querySelector('details textarea');
        dlg.querySelector('details').open = true;
        ta.select();
        document.execCommand('copy');
      }
      dlg.querySelector('.ok-copiado').hidden = false;
    };
    dlg.querySelectorAll('[data-p="bajar"]').forEach((b) => {
      b.onclick = () => {
        const a = adjuntos.find((x) => x.title === b.dataset.n);
        const bytes = Uint8Array.from(atob(a.source.data), (c) => c.charCodeAt(0));
        descargar(/\.pdf$/i.test(a.title) ? a.title : a.title + '.pdf', new Blob([bytes], { type: 'application/pdf' }), 'application/pdf');
      };
    });
    q('cargar').onclick = () => {
      const texto = q('respuesta').value;
      if (!texto.trim()) { q('error').hidden = false; q('error').textContent = 'Pega primero la respuesta de Claude.'; return; }
      if (esquema) {
        try { extraerJson(texto); } catch (e) { q('error').hidden = false; q('error').textContent = e.message; return; }
      }
      cerrar();
      resolver(texto);
    };
    q('cancelar').onclick = () => { cerrar(); rechazar(new Error('Cancelado.')); };
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); q('cancelar').onclick(); });
    dlg.showModal();
  });
}

const obj = (props, req = Object.keys(props)) => ({ type: 'object', additionalProperties: false, required: req, properties: props });
const str = { type: 'string' };
const arr = (items) => ({ type: 'array', items });

const ESQUEMA_CV = obj({
  titular: obj({ nombre: str, dni: str, profesion: str, colegiatura: str, email: str, telefono: str, resumen: str }),
  experiencias: arr(obj({
    entidad: str, cargo: str, proyecto: str, descripcion: str, inicio: str, fin: str, monto: { type: 'number' },
    tipo: { type: 'string', enum: ['obra', 'servicio', 'consultoria_obra', 'bien'] },
  })),
  formacion: arr(obj({ titulo: str, institucion: str, fecha: str })),
  capacitaciones: arr(obj({ nombre: str, institucion: str, horas: str, fecha: str })),
});

const ESQUEMA_BUSQUEDA = obj({
  convocatorias: arr(obj({ entidad: str, titulo: str, url: str, fechaLimite: str, monto: str, requisitosClave: str, compatibilidad: str, motivo: str })),
  notas: str,
});

const ESQUEMA_CLASIFICACION = obj({
  resultados: arr(obj({ id: str, grupo: { type: 'string', enum: ['especifica', 'general', 'no_aplica'] }, motivo: str })),
});

const ESQUEMA_LLENADO = obj({
  reemplazos: arr(obj({ indice: { type: 'integer' }, texto: str })),
  pendientes: arr(str),
});

const ESQUEMA_ANEXOS = obj({
  anexos: arr(obj({ titulo: str, contenido: str, pendientes: arr(str) })),
});

const ESQUEMA_CUMPLIMIENTO = obj({
  veredicto: { type: 'string', enum: ['cumple', 'cumple_parcialmente', 'no_cumple'] },
  resumen: str,
  requisitos: arr(obj({
    requisito: str,
    categoria: str,
    estado: { type: 'string', enum: ['cumple', 'parcial', 'no_cumple', 'no_verificable'] },
    evidencia: str,
    accion: str,
  })),
  recomendaciones: arr(str),
});

Object.assign(IA, {
  async extraerCV(config, fuente, esEmpresa) {
    const bloques = IA.bloquesBases(fuente).map((b) => (b.type === 'text' ? { ...b, text: b.text.replace(/<\/?bases>/g, '') } : { ...b, title: fuente.pdfNombre || 'CV' }));
    if (!bloques.length) throw new Error('Sube el CV en PDF o Word.');
    return ejecutarJson(config, {
      titulo: 'Leer CV y separar experiencias',
      bloques,
      esquema: ESQUEMA_CV,
      pedido: `El documento anterior es el ${esEmpresa ? 'currículum / portafolio de experiencia de una EMPRESA' : 'currículum vitae de un PROFESIONAL'}.
Extrae los datos del titular y separa CADA experiencia laboral o contrato como un elemento independiente (si un mismo cargo tuvo varios proyectos, sepáralos).
- Fechas en formato AAAA-MM-DD; si solo hay mes y año usa AAAA-MM; si dice "a la fecha" o "actualidad" deja "fin" vacío.
- "entidad" es el cliente o empleador; "proyecto" el nombre del proyecto, obra o servicio; "cargo" el puesto desempeñado (para empresas: el rol, p. ej. "Contratista" o "Consultor").
- "monto" solo si figura (si no, 0).
- No inventes nada: deja "" si un dato no aparece.`,
    });
  },

  async clasificarExperiencias(config, { fuente, contexto, experiencias, definicion }) {
    const r = await ejecutarJson(config, {
      titulo: 'Clasificar experiencias',
      bloques: IA.bloquesBases(fuente),
      esquema: ESQUEMA_CLASIFICACION,
      pedido: `Clasifica cada experiencia como "especifica", "general" o "no_aplica" para este procedimiento, según las definiciones de experiencia de las bases / términos de referencia.
${definicion ? `Definición indicada por el usuario:\n${definicion}\n` : ''}
${contexto}

Experiencias a clasificar (JSON):
<experiencias>
${JSON.stringify(experiencias, null, 1)}
</experiencias>

Devuelve un resultado por cada id, con un motivo breve que cite el criterio de las bases.`,
    });
    return r.resultados;
  },

  async llenarAnexo(config, { fuente, contexto, parrafos, titulo }) {
    const todos = parrafos.map((x, i) => ({ i, t: x.texto, celda: x.enTabla || undefined })).filter((x) => x.t.trim() || x.celda);
    // En claude.ai cada consulta admite ~60 KB: un Word grande se llena por tandas de párrafos.
    if (IA.modo() === 'claude' && bytes(JSON.stringify(todos)) + bytes(contexto) > 40000) {
      const tandas = [];
      let actual = [];
      for (const x of todos) {
        if (actual.length && bytes(JSON.stringify(actual)) + bytes(JSON.stringify(x)) > 24000) { tandas.push(actual); actual = []; }
        actual.push(x);
      }
      if (actual.length) tandas.push(actual);
      const total = { reemplazos: [], pendientes: [] };
      for (const [k, tanda] of tandas.entries()) {
        const r = await IA.llenarAnexoTanda(config, { fuente: {}, contexto, lista: tanda, titulo: `${titulo} (parte ${k + 1} de ${tandas.length})` });
        total.reemplazos.push(...r.reemplazos);
        total.pendientes.push(...r.pendientes.filter((t) => !total.pendientes.includes(t)));
      }
      return total;
    }
    return IA.llenarAnexoTanda(config, { fuente, contexto, lista: todos, titulo });
  },

  async llenarAnexoTanda(config, { fuente, contexto, lista, titulo }) {
    return ejecutarJson(config, {
      titulo: `Llenar anexo: ${titulo}`,
      bloques: IA.bloquesBases(fuente),
      esquema: ESQUEMA_LLENADO,
      maxTokens: 64000,
      pedido: `Debes llenar el formato "${titulo}" (anexos en Word de las bases) con los datos del postor.
${contexto}

Párrafos del documento (i = índice, t = texto actual, celda = está dentro de una tabla):
<parrafos>
${JSON.stringify(lista)}
</parrafos>

Reglas:
- Devuelve en "reemplazos" solo los párrafos que cambian, con su "indice" y el "texto" completo final del párrafo.
- Conserva textualmente la redacción del formato; solo completa los espacios en blanco (……, ____, [CONSIGNAR …], (…), celdas vacías, etc.).
- Fecha: usa la de hoy (${fechaLarga(hoyISO())}) y la ciudad del postor cuando el formato pida lugar y fecha.
- Si un dato no está disponible, deja el espacio en blanco como estaba y anótalo en "pendientes".
- No llenes anexos que no aplican (p. ej. promesa de consorcio si no postula en consorcio); anótalo en "pendientes".`,
    });
  },

  async extraerAnexos(config, { fuente, contexto }) {
    const bloques = IA.bloquesBases(fuente);
    if (!bloques.length) throw new Error('Sube el PDF de las bases o pega su texto en la pestaña "Bases".');
    const r = await ejecutarJson(config, {
      titulo: 'Extraer y llenar anexos',
      bloques,
      esquema: ESQUEMA_ANEXOS,
      maxTokens: 64000,
      pedido: `Transcribe cada anexo / formato que el postor debe presentar según las bases (declaraciones juradas, carta de oferta, precio, experiencia, etc.) y llénalo con los datos del postor.
${contexto}

Reglas:
- Un elemento por anexo, con su título tal como figura (p. ej. "ANEXO N.° 1 - DECLARACIÓN JURADA DE DATOS DEL POSTOR").
- En "contenido" copia el texto del formato respetando su redacción, completando los espacios con los datos del postor. Usa una línea por párrafo; para tablas usa filas con el formato "| celda | celda |".
- Fecha de hoy: ${fechaLarga(hoyISO())}. Lo que no se pueda completar déjalo como [COMPLETAR: …] y anótalo en "pendientes".
- Omite anexos que claramente no aplican (p. ej. promesa de consorcio si no postula en consorcio).`,
    });
    return r.anexos;
  },

  async evaluarCumplimiento(config, { fuente, contexto, perfil }) {
    const bloques = IA.bloquesBases(fuente);
    if (!bloques.length) throw new Error('Sube el TDR / bases en PDF o Word, o pega su texto.');
    return ejecutarJson(config, {
      titulo: '¿Cumplo con los requisitos?',
      bloques,
      esquema: ESQUEMA_CUMPLIMIENTO,
      pedido: `Evalúa si el postor cumple los requisitos del documento anterior (términos de referencia / bases).
${contexto ? contexto + '\n' : ''}
Perfil del postor evaluado (JSON):
<perfil>
${JSON.stringify(perfil, null, 1)}
</perfil>

Revisa uno por uno los requisitos del perfil exigido (formación, colegiatura/habilitación, experiencia general, experiencia específica, capacitaciones, RNP, equipamiento, etc.).
- Para la experiencia, calcula el tiempo o monto acumulado y compáralo con lo exigido; indica qué experiencias usarías.
- "no_verificable" cuando el requisito depende de un documento que no está en el perfil (p. ej. certificado de habilidad vigente).
- En "accion" di concretamente qué presentar o qué falta.
- Veredicto "cumple" solo si todos los requisitos obligatorios se cumplen.`,
    });
  },

  // Búsqueda web de convocatorias (menores a 8 UIT u otras) compatibles con un perfil.
  async buscarConvocatorias(config, { perfil, consulta, topeSoles }) {
    const model = config.modelo || 'claude-opus-5';
    const herramienta = model === 'claude-haiku-4-5'
      ? { type: 'web_search_20250305', name: 'web_search', max_uses: 10, user_location: { type: 'approximate', country: 'PE' } }
      : { type: 'web_search_20260209', name: 'web_search', max_uses: 10, user_location: { type: 'approximate', country: 'PE' } };
    const pedido = `Busca en internet convocatorias VIGENTES (con plazo de presentación aún abierto a la fecha de hoy, ${fechaLarga(hoyISO())}) de contrataciones del Estado peruano que sean compatibles con el perfil de abajo.
Prioriza contrataciones menores o iguales a 8 UIT${topeSoles ? ` (hasta S/ ${topeSoles.toLocaleString('es-PE')})` : ''} publicadas por entidades públicas (portales institucionales, gob.pe, SEACE/PLADICOP, convocatorias de órdenes de servicio o compra).
${consulta ? `Indicaciones del usuario: ${consulta}\n` : ''}
Perfil del postor (JSON):
<perfil>
${JSON.stringify(perfil, null, 1)}
</perfil>

Al terminar, responde SOLO con un bloque \`\`\`json con este formato:
{"convocatorias":[{"entidad":"","titulo":"","url":"","fechaLimite":"","monto":"","requisitosClave":"","compatibilidad":"alta|media|baja","motivo":""}],"notas":""}
Incluye solo convocatorias con enlace real encontrado en la búsqueda; no inventes enlaces. Si no encuentras vigentes, devuelve la lista vacía y explica en "notas" dónde buscar.`;
    // Desde claude.ai la app no puede navegar por internet: la búsqueda se hace pegando el pedido en un chat.
    if (IA.modo() === 'plan' || IA.modo() === 'claude') {
      const texto = await pedirAClaude({ titulo: 'Buscar convocatorias menores a 8 UIT', bloques: [], pedido: pedido + '\n\nUsa la búsqueda web para encontrarlas.' });
      try {
        return completarSegunEsquema(extraerJson(texto), ESQUEMA_BUSQUEDA);
      } catch (e) {
        return { convocatorias: [], notas: texto };
      }
    }
    const client = IA.cliente();
    const base = IA.parametros(config);
    const messages = [{ role: 'user', content: pedido }];
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      const msg = await client.beta.messages.stream({
        ...base, max_tokens: 32000, system: SISTEMA_BASE, tools: [herramienta], messages,
      }).finalMessage();
      if (msg.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: msg.content });
        continue;
      }
      IA.verificarRespuesta(msg);
      const texto = IA.textoDe(msg);
      const m = texto.match(/```json\s*([\s\S]*?)```/) || texto.match(/(\{[\s\S]*\})/);
      try {
        return JSON.parse(m[1]);
      } catch (e) {
        return { convocatorias: [], notas: texto };
      }
    }
    throw new Error('La búsqueda tomó demasiados pasos. Intenta con una consulta más específica.');
  },
});

const ESQUEMA_ANALISIS = {
  type: 'object',
  additionalProperties: false,
  required: ['nomenclatura', 'entidad', 'objeto', 'tipoObjeto', 'procedimiento', 'sistemaContratacion',
    'valorReferencial', 'moneda', 'plazoEjecucionDias', 'lugar', 'resumen', 'cronograma', 'requisitos',
    'factoresEvaluacion', 'personalClave', 'equipamiento', 'experienciaRequerida', 'garantias', 'penalidades', 'alertas'],
  properties: {
    nomenclatura: { type: 'string' },
    entidad: { type: 'string' },
    objeto: { type: 'string' },
    tipoObjeto: { type: 'string', enum: ['obra', 'servicio', 'consultoria_obra', 'bien'] },
    procedimiento: { type: 'string' },
    sistemaContratacion: { type: 'string' },
    valorReferencial: { type: 'number' },
    moneda: { type: 'string' },
    plazoEjecucionDias: { type: 'integer' },
    lugar: { type: 'string' },
    resumen: { type: 'string' },
    cronograma: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['etapa', 'fecha'],
        properties: { etapa: { type: 'string' }, fecha: { type: 'string' } },
      },
    },
    requisitos: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['categoria', 'texto', 'referencia'],
        properties: {
          categoria: { type: 'string', enum: ['Admisión', 'Calificación', 'Evaluación', 'Contrato'] },
          texto: { type: 'string' },
          referencia: { type: 'string' },
        },
      },
    },
    factoresEvaluacion: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['factor', 'puntajeMaximo', 'criterio'],
        properties: { factor: { type: 'string' }, puntajeMaximo: { type: 'number' }, criterio: { type: 'string' } },
      },
    },
    personalClave: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['cargo', 'formacion', 'experiencia'],
        properties: { cargo: { type: 'string' }, formacion: { type: 'string' }, experiencia: { type: 'string' } },
      },
    },
    equipamiento: { type: 'array', items: { type: 'string' } },
    experienciaRequerida: { type: 'string' },
    garantias: { type: 'array', items: { type: 'string' } },
    penalidades: { type: 'string' },
    alertas: { type: 'array', items: { type: 'string' } },
  },
};

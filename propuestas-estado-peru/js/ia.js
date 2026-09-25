'use strict';
// Integración opcional con Claude (API de Anthropic) directamente desde el navegador.
// La API key se guarda solo en este navegador y viaja únicamente a api.anthropic.com.

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
  disponible() {
    return Boolean(leerApiKey()) && typeof window.Anthropic === 'function';
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
    const client = IA.cliente();
    const bloques = IA.bloquesBases(fuente);
    if (!bloques.length) throw new Error('Sube el PDF de las bases o pega su texto.');
    const params = IA.parametros(config, { format: { type: 'json_schema', schema: ESQUEMA_ANALISIS } });
    const stream = client.beta.messages.stream({
      ...params,
      max_tokens: 32000,
      system: SISTEMA_BASE,
      messages: [{
        role: 'user',
        content: [
          ...bloques,
          {
            type: 'text',
            text: `Analiza las bases anteriores y extrae la información para preparar la oferta.
- Usa "" o 0 cuando un dato no figure en las bases; no lo supongas.
- Fechas del cronograma en formato AAAA-MM-DD cuando se puedan determinar; si no, deja la fecha como aparece.
- En "requisitos" incluye cada documento o condición que el postor debe presentar o cumplir, clasificado en Admisión, Calificación, Evaluación o Contrato, con la referencia al numeral de las bases.
- En "alertas" anota plazos críticos, penalidades altas, requisitos difíciles de cumplir, inconsistencias o puntos que convendría consultar u observar.`,
          },
        ],
      }],
    });
    const msg = await stream.finalMessage();
    IA.verificarRespuesta(msg);
    return JSON.parse(IA.textoDe(msg));
  },

  async redactarSeccion(config, { fuente, contexto, seccion, instrucciones, borradorActual }, alTexto) {
    const client = IA.cliente();
    const bloques = IA.bloquesBases(fuente);
    const pedido = `Redacta la sección "${seccion}" de la propuesta técnica para este procedimiento.

${contexto}

${borradorActual ? `Borrador actual de la sección (mejóralo y consérvale los datos correctos):\n<borrador>\n${borradorActual}\n</borrador>\n` : ''}${instrucciones ? `Indicaciones del usuario: ${instrucciones}\n` : ''}
Formato de salida: texto listo para pegar en la oferta, sin preámbulos ni comentarios sobre lo que haces. Usa "## " para subtítulos, "- " para viñetas y párrafos separados por una línea en blanco. No uses negritas ni tablas.`;
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
  },

  async revisarOferta(config, { fuente, contexto }, alTexto) {
    const client = IA.cliente();
    const bloques = IA.bloquesBases(fuente);
    const pedido = `Actúa como el comité de selección y revisa la oferta que se describe a continuación frente a las bases.

${contexto}

Entrega:
## Riesgos de no admisión
## Riesgos en la calificación
## Cómo mejorar el puntaje
## Documentos que faltan
Sé concreto: cita el requisito de las bases y qué falta o qué corregir. Formato: "## " para títulos y "- " para viñetas.`;
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
  },
};


// Llamada genérica con salida JSON validada por esquema.
async function llamarJson(config, { bloques = [], pedido, esquema, maxTokens = 32000 }) {
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
    return llamarJson(config, {
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
    const r = await llamarJson(config, {
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
    const lista = parrafos.map((x, i) => ({ i, t: x.texto, celda: x.enTabla || undefined })).filter((x) => x.t.trim() || x.celda);
    return llamarJson(config, {
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
    const r = await llamarJson(config, {
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
    return llamarJson(config, {
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
    const client = IA.cliente();
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

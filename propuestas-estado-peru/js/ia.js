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

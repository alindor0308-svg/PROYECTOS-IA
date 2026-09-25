# Propuestas al Estado (Perú)

App web local para preparar ofertas a procedimientos de selección del Estado peruano (Ley N.° 32069): obras, servicios, consultorías y bienes.

## Cómo usarla

1. Descarga esta carpeta y abre `index.html` con doble clic (Chrome, Edge o Firefox). No se instala nada.
2. **Mi empresa**: datos del postor, RNP, experiencia, personal clave y equipos (se reutilizan en todas las ofertas).
3. **Mis procesos → Crear proceso**, y dentro de cada proceso:
   1. **Bases**: sube el PDF o pega el texto; la IA extrae datos, cronograma, requisitos, factores de evaluación y alertas.
   2. **Datos y cronograma**, con alertas (RNP vencido, capacidad de contratación, plazos).
   3. **Requisitos**: checklist de admisión, calificación, evaluación y contrato.
   4. **Oferta económica**: partidas, GG, utilidad, IGV, % del valor referencial, límites, garantía, monto en letras.
   5. **Propuesta técnica**: secciones con borradores de IA que marcan `[COMPLETAR: …]` en vez de inventar datos.
   6. **Anexos y exportar**: declaraciones juradas ya llenadas, experiencia, personal, equipos y propuesta técnica en Word o PDF.

Los datos se guardan solo en tu navegador. Usa **Descargar respaldo** con frecuencia.

## Flujo con CV, anexos y expediente foliado

1. **Profesionales → Importar CV con IA** (PDF o Word): separa cada experiencia con entidad, cargo, proyecto y fechas. Adjunta a cada experiencia su certificado o constancia (PDF o imagen) y sube títulos, colegiatura y habilidad como documentos. En **Mi empresa** puedes hacer lo mismo con el portafolio de la empresa.
2. **Mi empresa → Hoja membretada**: súbela en Word (y opcionalmente en PDF para que el PDF final salga idéntico).
3. En cada proceso:
   - **Bases / TDR → ¿Cumplo?**: compara el TDR con tu CV o la empresa, requisito por requisito.
   - **Experiencia**: marca cada experiencia como *específica* o *general* (a mano o con IA). Calcula meses sin traslapes y montos.
   - **Anexos**: sube los anexos en Word y la IA los llena respetando el formato de la entidad. Si vienen dentro del PDF de las bases, la IA los transcribe, los llena y los genera con tu membrete. Luego sube la versión firmada en PDF.
   - **Expediente**: arma la estructura (separadores, anexos, experiencia específica y general, documentos) o usa la sugerida, y genera:
     - **PDF único foliado** con índice (folio arriba o abajo, ascendente o descendente);
     - **ZIP con carpetas**: una por separador, con los separadores y anexos en Word y los sustentos originales.
4. **Oportunidades**: evalúa rápidamente un TDR contra tu perfil o busca en internet convocatorias vigentes menores a 8 UIT compatibles con tu CV. La búsqueda es referencial: no reemplaza revisar el SEACE / PLADICOP.

Los archivos (CV, certificados, anexos, membrete) se guardan en el navegador (IndexedDB). El respaldo `.json` guarda los datos, no los archivos.

## IA: con tu plan de Claude (sin costo extra) o con API

- **Dentro de claude.ai (recomendado)**: publicada como Artifact en tu cuenta, la app consulta a Claude directo con tu plan, sin copiar ni pegar. La primera vez, claude.ai te pide permiso. Los PDF se leen como texto en la app (los escaneados se envían como imágenes de sus primeras páginas) y los documentos largos se procesan por partes. Para regenerar la página que se publica: `python3 herramientas/armar_artifact.py salida.html`.

- **Con mi plan de Claude** (predeterminado). Cuando pides algo con IA, la app abre una ventana con 3 pasos:
  1. copias el pedido;
  2. lo pegas en claude.ai, adjuntando el PDF si te lo indica;
  3. pegas la respuesta de Claude en la app y ella carga los datos sola.

  Usa los límites de tu plan Pro o Max, sin pagos adicionales.
- **Automático con API key** (opcional, en Configuración). Todo ocurre dentro de la app, pero la API se paga aparte en https://console.anthropic.com.

## Aviso

Los formatos y requisitos son referenciales. Revisa siempre las bases integradas y la normativa vigente antes de presentar.

Librerías incluidas en `vendor/`: `@anthropic-ai/sdk` (MIT, empaquetado para navegador), `pdf-lib` (MIT), `JSZip` (MIT), `mammoth` (BSD-2) y `pdf.js` (Apache-2.0).

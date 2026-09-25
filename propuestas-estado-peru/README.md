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

## IA (opcional)

En **Configuración**, pega una API key de Anthropic (https://console.anthropic.com). Las llamadas van directo del navegador a `api.anthropic.com` y se cobran en tu cuenta.

## Aviso

Los formatos y requisitos son referenciales. Revisa siempre las bases integradas y la normativa vigente antes de presentar.

`vendor/anthropic-sdk.js` es el SDK oficial `@anthropic-ai/sdk` (licencia MIT), empaquetado para el navegador.

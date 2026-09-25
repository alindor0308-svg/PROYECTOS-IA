'use strict';
// Plantillas y catálogos para contrataciones públicas en Perú (Ley N.° 32069 y su Reglamento).
// Son referenciales: los nombres, la numeración de anexos y los requisitos exactos
// siempre los fijan las bases integradas de cada procedimiento.

const TIPOS_OBJETO = {
  obra: 'Obra',
  servicio: 'Servicio',
  consultoria_obra: 'Consultoría de obra',
  bien: 'Bien',
};

// Capítulo del RNP que corresponde a cada tipo de objeto.
const CAPITULO_RNP = {
  obra: 'ejecutorObras',
  consultoria_obra: 'consultorObras',
  servicio: 'servicios',
  bien: 'bienes',
};

const NOMBRE_CAPITULO = {
  bienes: 'Proveedor de bienes',
  servicios: 'Proveedor de servicios',
  consultorObras: 'Consultor de obras',
  ejecutorObras: 'Ejecutor de obras',
};

const PROCEDIMIENTOS = [
  'Licitación pública',
  'Licitación pública abreviada',
  'Concurso público',
  'Concurso público abreviado',
  'Adjudicación simplificada',
  'Comparación de precios',
  'Subasta inversa electrónica',
  'Selección de consultores individuales',
  'Contratación directa',
];

const SISTEMAS = ['Suma alzada', 'Precios unitarios', 'Esquema mixto', 'Tarifas', 'Honorario fijo y comisión de éxito'];

const ESTADOS = {
  preparacion: 'En preparación',
  presentada: 'Oferta presentada',
  ganada: 'Buena pro obtenida',
  perdida: 'No adjudicada',
  descartada: 'Descartada',
};

const ETAPAS = [
  'Convocatoria',
  'Registro de participantes',
  'Formulación de consultas y observaciones',
  'Absolución de consultas e integración de bases',
  'Presentación de ofertas',
  'Evaluación y calificación',
  'Otorgamiento de la buena pro',
];

const CATEGORIAS_REQ = ['Admisión', 'Calificación', 'Evaluación', 'Contrato'];

const REQUISITOS_COMUNES = [
  ['Admisión', 'Declaración jurada de datos del postor'],
  ['Admisión', 'Declaración jurada de veracidad de documentos y de no estar impedido para contratar con el Estado'],
  ['Admisión', 'Declaración jurada de plazo de ejecución / entrega'],
  ['Admisión', 'Promesa de consorcio con firmas legalizadas (solo si postula en consorcio)'],
  ['Admisión', 'Documento del precio de la oferta (incluye IGV, salvo exonerados)'],
  ['Admisión', 'Documento que acredita la representación (vigencia de poder SUNARP), si lo piden las bases'],
  ['Admisión', 'Inscripción vigente en el RNP en el capítulo que corresponde'],
  ['Calificación', 'Experiencia del postor en la especialidad (contratos + conformidades o comprobantes de pago)'],
  ['Evaluación', 'Revisar factores de evaluación y documentos que otorgan puntaje'],
  ['Contrato', 'Garantía de fiel cumplimiento (o retención, si como MYPE lo permite la normativa)'],
  ['Contrato', 'Código de cuenta interbancaria (CCI)'],
  ['Contrato', 'Domicilio y correo para notificaciones'],
  ['Contrato', 'Copia de DNI del representante y vigencia de poder actualizada'],
];

const REQUISITOS_POR_TIPO = {
  obra: [
    ['Admisión', 'Declaración jurada de cumplimiento del expediente técnico'],
    ['Admisión', 'Presupuesto de obra desagregado por partidas (si las bases lo exigen en la oferta)'],
    ['Calificación', 'Capacidad máxima de contratación del RNP igual o mayor al valor referencial'],
    ['Calificación', 'Equipamiento estratégico (documentos de propiedad, alquiler o compromiso)'],
    ['Calificación', 'Personal clave: formación académica (título, colegiatura, habilitación)'],
    ['Calificación', 'Personal clave: experiencia (certificados o constancias)'],
    ['Contrato', 'Cronograma de ejecución de obra (Gantt / PERT-CPM)'],
    ['Contrato', 'Calendario de avance de obra valorizado'],
    ['Contrato', 'Calendario de adquisición de materiales e insumos'],
    ['Contrato', 'Análisis de precios unitarios y desagregado de gastos generales'],
    ['Contrato', 'Garantía por adelanto directo y/o de materiales (si los solicita)'],
    ['Contrato', 'Póliza SCTR y seguros exigidos'],
  ],
  servicio: [
    ['Admisión', 'Declaración jurada de cumplimiento de los términos de referencia'],
    ['Calificación', 'Personal clave: formación y experiencia (si las bases lo exigen)'],
    ['Calificación', 'Equipamiento estratégico (si las bases lo exigen)'],
    ['Admisión', 'Estructura de costos (si las bases lo exigen)'],
    ['Contrato', 'Póliza SCTR / seguros exigidos en los términos de referencia'],
  ],
  consultoria_obra: [
    ['Admisión', 'Declaración jurada de cumplimiento de los términos de referencia'],
    ['Calificación', 'Personal clave: formación académica y colegiatura habilitada'],
    ['Calificación', 'Personal clave: experiencia en la especialidad'],
    ['Calificación', 'Equipamiento estratégico (software, equipos de topografía, etc.)'],
    ['Evaluación', 'Metodología propuesta (si es factor de evaluación)'],
  ],
  bien: [
    ['Admisión', 'Declaración jurada de cumplimiento de las especificaciones técnicas'],
    ['Admisión', 'Fichas técnicas, catálogos, certificados o folletos requeridos'],
    ['Evaluación', 'Garantía comercial / plazo de entrega (si otorgan puntaje)'],
    ['Contrato', 'Registro sanitario u otras autorizaciones (si aplica)'],
  ],
};

const SECCIONES_TECNICAS = {
  obra: [
    'Comprensión del proyecto y visita a obra',
    'Metodología y procedimiento constructivo',
    'Plan de trabajo y cronograma de ejecución',
    'Organización de obra y personal clave',
    'Equipamiento y recursos',
    'Plan de seguridad y salud en el trabajo',
    'Plan de manejo ambiental',
    'Plan de aseguramiento de la calidad',
    'Gestión de riesgos',
    'Mejoras y valores agregados',
  ],
  servicio: [
    'Comprensión del servicio',
    'Enfoque y metodología',
    'Plan de trabajo y cronograma',
    'Organización y equipo de trabajo',
    'Recursos y equipamiento',
    'Control de calidad del servicio',
    'Gestión de riesgos',
    'Seguridad y salud en el trabajo',
    'Mejoras y valores agregados',
  ],
  consultoria_obra: [
    'Comprensión de los términos de referencia',
    'Enfoque técnico y metodología',
    'Plan de trabajo, entregables y cronograma',
    'Equipo profesional y organización',
    'Recursos, software y equipamiento',
    'Control de calidad de los entregables',
    'Gestión de riesgos',
    'Mejoras y valores agregados',
  ],
  bien: [
    'Descripción del bien ofertado',
    'Cumplimiento de especificaciones técnicas',
    'Plazo y condiciones de entrega',
    'Garantía comercial y soporte postventa',
    'Mejoras y valores agregados',
  ],
};

const PARTIDAS_BASE = {
  obra: [
    ['01', 'Obras provisionales y trabajos preliminares', 'glb'],
    ['02', 'Seguridad y salud en el trabajo', 'glb'],
    ['03', 'Movimiento de tierras', 'm3'],
    ['04', 'Concreto simple', 'm3'],
    ['05', 'Concreto armado', 'm3'],
  ],
  servicio: [
    ['01', 'Personal', 'mes'],
    ['02', 'Materiales e insumos', 'glb'],
    ['03', 'Equipos y herramientas', 'glb'],
    ['04', 'Seguros (SCTR, vida ley)', 'glb'],
  ],
  consultoria_obra: [
    ['01', 'Honorarios del personal clave', 'mes'],
    ['02', 'Personal de apoyo', 'mes'],
    ['03', 'Estudios básicos (topografía, suelos, etc.)', 'glb'],
    ['04', 'Movilidad, viáticos y equipos', 'glb'],
  ],
  bien: [
    ['01', 'Bien ofertado', 'und'],
    ['02', 'Transporte y entrega', 'glb'],
  ],
};

const MODELOS_IA = {
  'claude-opus-5': 'Claude Opus 5 (mejor calidad)',
  'claude-sonnet-5': 'Claude Sonnet 5 (más económico)',
  'claude-haiku-4-5': 'Claude Haiku 4.5 (rápido, básico)',
};

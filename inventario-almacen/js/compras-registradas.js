'use strict';
// Facturas de compra transcritas de los PDF y fotos que envía el usuario.
// Al abrir la app, cada factura se agrega una sola vez como entrada al almacén.
// Cada ítem: [cantidad, unidad, descripción de la factura, precio unitario con IGV, equivalencia?]
// La equivalencia asocia el ítem a un material que ya existe (por ejemplo, el de una O/C):
//   { material: 'descripción en el catálogo', factor: n, oc: 'N° de O/C' }
//   factor convierte la unidad de la factura a la del catálogo (tubo de 3 m → factor 3 si la O/C pide metros).

const COMPRAS_REGISTRADAS = [
  {
    proveedor: 'COMERCIALIZADORA ALEYARI',
    ruc: '20601224373',
    documento: 'F001-00000962',
    fecha: '2026-09-28',
    pago: 'CONTADO',
    total: 275.0,
    items: [
      [2, 'UND', 'BIDON VACIO DE 200 LT.', 120],
      [5, 'UND', 'BALDES VACIOS', 7],
    ],
  },
  {
    proveedor: 'IMPORTADORA COMERCIALIZADORA DEL NORTE S.A.C. (EUROTUBO)',
    ruc: '20482690875',
    documento: 'F001-00033993',
    fecha: '2026-09-19',
    pago: 'CONTADO',
    total: 1118.4,
    items: [
      [50, 'UND', 'CURVA PVC SEL 3/4" X 90°', 0.39],
      [50, 'UND', 'TUBO PVC NTP-399.006 3/4" (19,1MM) L X 3M S/P', 2.29],
      [2, 'UND', 'PEGAMENTO OATEY PVC REGULAR 1/4 (32 ONZAS)', 49.8, { material: 'PEGAMENTO PARA TUBO PVC 32 ONZ (1/4 GALON)', oc: '000062' }],
      [50, 'UND', 'CODO PVC DSG. INYECTADO 2" X 90° EUROTUBO', 1.71, { material: 'CODO 90° PVC SIMPLE PRESION P/DESAGUE DN 2"', oc: '000062' }],
      [15, 'UND', 'TUBO PVC NTP-399.003 2" (54MM) DS CL X 3M S/P', 7.13, { material: 'TUBO PVC SP NTP 399.003 CLASE PESADA DN 2"', factor: 3, oc: '000062' }],
      [3, 'UND', 'TEE PVC DSG. INYECTADO 2" X 2" EUROTUBO', 2.2, { material: 'TEE SANITARIA PVC SIMPLE PRESION P/DESGAUE DN 2"', oc: '000062' }],
      [20, 'UND', 'TUBO PVC NTP-399.003 4" (105MM) DS CL X 3M S/P', 18.19, { material: 'TUBO PVC SP NTP 399.003 CLASE PESADA DN 4"', factor: 3, oc: '000062' }],
      [18, 'UND', 'CODO PVC DSG. INYECTADO 4" X 90° EUROTUBO', 5.62, { material: 'CODO 90° PVC SIMPLE PRESION P/DESAGUE DN 4"', oc: '000062' }],
      [10, 'UND', 'TUBO PVC NTP-399.002 1/2" (21MM) PN-10 X 5M S/P', 6.0, { material: 'TUBO PVC NTP-399.002 SP DN 1/2 PN10', factor: 5, oc: '000062' }],
      [50, 'UND', 'CODO PVC PRESION INYECTADO 1/2" X 90° S/P EUROTUBO', 0.7, { material: 'CODO PVC 90° SP DN 1/2', oc: '000062' }],
      [6, 'UND', 'CODO PVC DSG. INYECTADO 3" X 90° EUROTUBO', 3.27, { material: 'CODO 90° PVC SIMPLE PRESION P/DESAGUE DN 3"', oc: '000062' }],
      [9, 'UND', 'CODO PVC DSG. INYECTADO 2" X 45° EUROTUBO', 1.38, { material: 'CODO 45° PVC SIMPLE PRESION O/DESAGUE DN 2"', oc: '000062' }],
      [3, 'UND', 'YEE PVC DSG. INYECTADO 4" X 4" EUROTUBO', 9.61, { material: 'YEE SANITARIA PVC SIMPLE PRESION P/DESAGUE DN 4"', oc: '000062' }],
      [6, 'UND', 'TEE PVC PRESION INYECTADO 1/2" S/P EUROTUBO', 1.02, { material: 'TEE PVC SP DN 1/2', oc: '000062' }],
      [12, 'UND', 'YEE PVC DSG. INYECTADO 3" X 2"', 4.9, { material: 'YEE SANITARIA PVC SIMPLE PRESION P/DESAGUE DN 3"*2"', oc: '000062' }],
    ],
  },
  {
    proveedor: 'IMPORTADORA COMERCIALIZADORA DEL NORTE S.A.C. (EUROTUBO)',
    ruc: '20482690875',
    documento: 'F002-00035209',
    fecha: '2026-09-26',
    pago: 'CONTADO',
    total: 725.3,
    items: [
      [1, 'UND', 'TABLERO EMPOTRABLE D/METAL C/RIEL 8 POLOS (SP)', 30.8],
      [1, 'UND', 'TUBO PVC NTP-399.006 1" (33MM) P X 3M S/P', 5.97],
      [1, 'UND', 'CURVA PVC SAP 1" X 90°', 1.88],
      [40, 'UND', 'CAJA RECTANGULAR GALV. C/SALIDA 3/4" (0.70MM) SP', 2.38],
      [12, 'UND', 'CINTA TEFLON SCHUBERT 1/2"', 0.59, { material: 'CINTA TEFLON INDUSTRIAL', oc: '000062' }],
      [33, 'UND', 'UNION PRESION ROSCA (UPR) PVC INYECTADO 1/2" EUROTUBO', 0.38, { material: 'ADAPTADOR PVC UNION PRESION-ROSCA DN 1/2', oc: '000062' }],
      [27, 'UND', 'NIPLE GALV. 1/2" X 1"', 0.98, { material: 'NIPLE DE FIERRO GALVANIZADO DN 1/2"*1/2"', oc: '000062' }],
      [18, 'UND', 'UNION UNIVERSAL GALV. 1/2"', 11.9, { material: 'UNION UNIVERSAL DE FIERRO GALVANIZADO 1/2"', oc: '000062' }],
      [24, 'UND', 'CODO GALV. 1/2" X 90°', 2.17, { material: 'CODO 90° DE FIERRO GALVANIZADO UNION ROSCADA DN 1/2"', oc: '000062' }],
      [9, 'UND', 'VALV. ESFERICA CIM-14 DE 1/2"', 31.01, { material: 'VALVULA DE BRONCE TIPO ESFERICA PESADA DN 1/2"', oc: '000062' }],
    ],
  },
  {
    proveedor: 'INVERSIONES FERRETEROS PALERMO E.I.R.L. (ELECTROFERRETERIA PALERMO)',
    ruc: '20559675807',
    documento: 'FFF1-00016116',
    fecha: '2026-09-26',
    pago: 'CONTADO',
    total: 25.0,
    items: [
      [1, 'KG', 'GRAPA 1" P/ALAMBRE PUAS', 12],
      [2, 'UND', 'YESO X 5KG APROX.', 6.5],
    ],
  },
  {
    proveedor: 'HOMECENTERS PERUANOS S.A. (PROMART)',
    ruc: '20536557858',
    documento: 'FA38-00820427',
    fecha: '2026-09-27',
    pago: 'TARJETA',
    total: 79.0,
    items: [
      [1, 'UND', 'TABLERO RIEL 2 (COD. 2000000472607)', 79],
    ],
  },
  {
    proveedor: 'INVERSIONES Y CONTRATACIONES LUIS E.I.R.L.',
    ruc: '20605998021',
    documento: 'E001-83',
    fecha: '2026-09-30',
    pago: 'CRÉDITO',
    vence: '2026-11-30',
    version: 2, // v2: tubos de desagüe 2" de 3 m y juegos de baño asociados a la O/C 000062
    total: 14922.46,
    items: [
      [3, 'UND', 'TUBO DE ABASTO 1/2 X1/2 METUSA', 12, { material: 'TUBO DE ABASTO DE ACERO INOXIDABLE 1/2"*1/2 L=35CM', oc: '000062' }],
      [50, 'UND', 'ADAPTADOR 3/4 PVC EUROTUBO', 2, { material: 'ADAPTADOR PVCUNION PRESION-ROSCA DN 3/4', oc: '000062' }],
      [25, 'UND', 'REDUCCION 3/4 A 1/2 AGUA ECHIZO', 2, { material: 'REDUCCION PVC SP DE 3/4 A 1/2', oc: '000062' }],
      [100, 'BOLSA', 'CEMENTO INKA ROJO TIPO ICO ULTRA', 30],
      [20, 'UND', 'TEE DE AGUA 3/4 EUROTUBO', 3, { material: 'TEE PVC SP DN 3/4', oc: '000062' }],
      [22, 'UND', 'ABRAZADERA 3/4 P/SUJETAR TUBO DE AGUA', 2.18],
      [10, 'UND', 'NIPLE 3/4 X 2', 2.5],
      [50, 'UND', 'TUBO DE DESAGUE 2 PVC EUROTUBO (3 M)', 10, { material: 'TUBO PVC SP NTP 399.003 CLASE PESADA DN 2"', factor: 3, oc: '000062' }],
      [177, 'VARILLA', 'FIERRO CORRUGADO ACEROS AREQUIPA 1/2', 33.5],
      [50, 'UND', 'TARUGO DE PLASTICO NARANJA 3/8', 0.4, { material: 'TARUJO PLASTICO DE 3/8" (NARANJA)', oc: '000062' }],
      [12, 'UND', 'ANILLO DE CERA ANDICORP', 6, { material: 'ANILLO DE CERA CON GUIA PARA INODORO', oc: '000062' }],
      // Cada juego = 1 inodoro + 1 lavamanos; el precio se reparte según los precios de la O/C (400 y 130).
      [3, 'JGO', 'JUEGO DE BAÑO TAZA+TANQUE+LAVA CARA', 250, [
        { material: 'INODORO ONEPIECE LOSA VITRIFICADA TANQUE BAJO COLOR BLANCO MODELO OXFORD O SIMILAR', oc: '000062', proporcion: 400 / 530 },
        { material: 'LAVAMANOS DE LOZA VITRIFICADA BLANCA CON PEDESTAL', oc: '000062', proporcion: 130 / 530 },
      ]],
      [6, 'PZA', 'REGISTRO DE BRONCE 4', 12, { material: 'REGISTRO DE BRONCE 4"', oc: '000062' }],
      [200, 'VARILLA', 'FIERRO CORRUGADO ACEROS AREQUIPA 3/8', 19],
      [30, 'UND', 'TUBO DE AGUA 3/4 PVC X 5 M', 10, { material: 'TUBO PVC NTP-399.002 SP DN 3/4 PN10', oc: '000062' }],
      [10, 'UND', 'YEE DE DESAGUE DE 4X4 PVC EUROTUBO', 12, { material: 'YEE SANITARIA PVC SIMPLE PRESION P/DESAGUE DN 4"', oc: '000062' }],
      [20, 'UND', 'CODO DE AGUA 3/4 X 90 EUROTUBO', 2, { material: 'CODO PVC 90° SP DN 3/4', oc: '000062' }],
    ],
  },
];

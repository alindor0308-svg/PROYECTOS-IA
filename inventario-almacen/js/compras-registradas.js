'use strict';
// Facturas de compra transcritas de los PDF que envía el usuario.
// Al abrir la app, cada factura se agrega una sola vez como entrada al almacén.
// Cada ítem: [cantidad, unidad, descripción, precio unitario con IGV].

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
];

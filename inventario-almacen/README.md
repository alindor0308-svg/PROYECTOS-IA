# Inventario de Almacén

App web local para controlar la **entrada y salida de materiales** de un almacén, amarrada a las **órdenes de compra (O/C)** que envían las entidades.

- **Entrada** = compra a un proveedor (factura / boleta, con su costo).
- **Salida** = entrega a la entidad contra una O/C (con N° de guía de remisión).
- El stock, el costo promedio y lo pendiente de cada O/C se calculan solos a partir de los movimientos.

Ya trae cargadas las O/C **000062** (S/ 21,663.87, 69 ítems) y **000063** (S/ 2,067.50, 5 ítems) de la Municipalidad Distrital de Huaso.

## Cómo usarla

1. Descarga `Inventario-Almacen.html` (en la raíz del repositorio) y ábrelo con doble clic en Chrome o Edge. No se instala nada. También puedes abrir `index.html` de esta carpeta.
2. **Panel**: montos por entregar, valor del stock, compras y entregas del periodo, avance de cada O/C, materiales con más valor y gráfico semanal. Pasa el mouse por los gráficos para ver los montos.
3. **Empresa y respaldo**: nombre, RUC, almacén y **logo** (sale en el menú, las actas y los reportes). El botón de abajo del menú cambia entre **modo claro y oscuro**.
4. **Órdenes → Nueva O/C**: registra cada O/C que recibes.
   - Para O/C largas: «Leer la O/C escaneada con Claude» → copia las instrucciones, pégalas en claude.ai con el PDF y pega la respuesta. La app avisa si la suma no cuadra con el total de la O/C.
   - También puedes pegar filas desde Excel o copiadas del PDF.
5. **Por comprar**: lo que falta comprar para cumplir todas las O/C abiertas, descontando el stock. Se puede imprimir para cotizar.
6. **Registrar compra**: cuando llega el material, regístralo con proveedor, factura y costo.
7. **O/C → Registrar entrega**: indica cuánto entregas; descuenta el stock, actualiza lo pendiente e imprime el **acta de entrega** para que firmen.
8. **Stock**: existencias, costo promedio y valor. Cada material tiene su **kardex**. Usa **Conteo físico** una vez al mes para cuadrar con lo real.

## Reglas que aplica la app

- No deja entregar más de lo que hay en stock ni más de lo pendiente en la O/C.
- Nada se borra: los errores se **anulan** con motivo y quedan tachados.
- Los materiales que regresan al almacén se registran como **Devolución** y se descuentan de lo entregado.
- Cada O/C muestra el **costo de los materiales entregados** y el **margen bruto**. Registra los costos con el mismo criterio (con o sin IGV) que los precios de la O/C.

## Respaldo

Los datos se guardan solo en ese navegador y en esa computadora. En **Respaldo** descarga el archivo `.json` cada semana (USB, Drive o correo). Con ese archivo restauras todo en otra computadora.

Los reportes se exportan a Excel como CSV (separado por comas y con punto decimal).

Si cambias el código, vuelve a generar el archivo único con `python3 inventario-almacen/herramienta-empaquetar.py`.

## Facturas de compra numeradas

Cada factura registrada recibe un **N° correlativo de compra** (C-0001, C-0002…) en orden de fecha, visible en «Facturas de compra», en Movimientos, en el kardex y en cada O/C. El número no cambia aunque la factura se anule. Desde el detalle de cada factura se puede imprimir su registro de compra o anularla completa.

## Obra y empresa sin mezclar

Cada factura, O/C y movimiento lleva un **destino**: «Obra C.S. Huaso (O/C 000062 y 000063)» o «Empresa (compras generales)». Arriba, el selector **Ver: Todo / Obra Huaso / Empresa** filtra el Panel, Órdenes, Por comprar, Facturas, Movimientos, Stock y Kardex. Al registrar una compra se elige el destino (si se elige una O/C, toma el de la O/C). Una factura sin O/C puede moverse de destino desde su detalle. Los destinos se renombran o se agregan en «Empresa y respaldo». La numeración de compras (C-0001…) es una sola para todos los destinos.

## Facturas por pagar

Las compras al crédito guardan su fecha de vencimiento. En «Facturas de compra» se ve el estado de pago (por pagar, vencida o pagada), se filtra «Solo por pagar» y se marca cada factura como pagada con fecha y medio de pago. El Panel muestra el total por pagar y el próximo vencimiento.

## Facturas de compra enviadas por chat

Las facturas que el usuario envía en PDF se transcriben en `js/compras-registradas.js`. Al abrir la app, cada factura se agrega **una sola vez** como entrada al almacén (con proveedor, RUC, N° de comprobante y precios con IGV). No se duplica al reabrir, ni si ya estaba registrada a mano con el mismo N° de comprobante. Después de agregar facturas, se regenera `Inventario-Almacen.html`.

| Fecha | Comprobante | Proveedor | Total |
|---|---|---|---|
| 19/09/2026 | F001-00033993 | Importadora Comercializadora del Norte S.A.C. – Eurotubo (RUC 20482690875) | S/ 1,118.40 |
| 26/09/2026 | F002-00035209 | Importadora Comercializadora del Norte S.A.C. – Eurotubo (RUC 20482690875) | S/ 725.30 |
| 26/09/2026 | FFF1-00016116 | Inversiones Ferreteros Palermo E.I.R.L. (RUC 20559675807) | S/ 25.00 |
| 27/09/2026 | FA38-00820427 | Homecenters Peruanos S.A. – Promart (RUC 20536557858) | S/ 79.00 |
| 28/09/2026 | F001-00000962 | Comercializadora Aleyarí (RUC 20601224373) | S/ 275.00 |
| 30/09/2026 | E001-83 | Inversiones y Contrataciones Luis E.I.R.L. (RUC 20605998021), al crédito hasta el 30/11/2026 | S/ 14,922.46 |

Un ítem puede repartirse en varios materiales (por ejemplo, un juego de baño = 1 inodoro + 1 lavamanos, con el precio repartido según la O/C). Si una factura ya cargada se corrige (campo `version`), al abrir la app se reemplazan sus ítems conservando su N° de compra.

Los ítems que corresponden a una O/C se asocian al material de esa O/C (con conversión de unidades, por ejemplo tubos de 3 m a metros); la descripción original de la factura queda en la observación del movimiento.

# Inventario de Almacén

App web local para controlar la **entrada y salida de materiales** de un almacén, amarrada a las **órdenes de compra (O/C)** que envían las entidades.

- **Entrada** = compra a un proveedor (factura / boleta, con su costo).
- **Salida** = entrega a la entidad contra una O/C (con N° de guía de remisión).
- El stock, el costo promedio y lo pendiente de cada O/C se calculan solos a partir de los movimientos.

Ya trae cargadas las O/C **000062** (S/ 21,663.87, 69 ítems) y **000063** (S/ 2,067.50, 5 ítems) de la Municipalidad Distrital de Huaso.

## Cómo usarla

1. Descarga la carpeta `inventario-almacen` y abre `index.html` con doble clic (Chrome o Edge). No se instala nada.
2. **Órdenes → Nueva O/C**: registra cada O/C que recibes.
   - Para O/C largas: «Leer la O/C escaneada con Claude» → copia las instrucciones, pégalas en claude.ai con el PDF y pega la respuesta. La app avisa si la suma no cuadra con el total de la O/C.
   - También puedes pegar filas desde Excel o copiadas del PDF.
3. **Por comprar**: lo que falta comprar para cumplir todas las O/C abiertas, descontando el stock. Se puede imprimir para cotizar.
4. **Registrar compra**: cuando llega el material, regístralo con proveedor, factura y costo.
5. **O/C → Registrar entrega**: indica cuánto entregas; descuenta el stock, actualiza lo pendiente e imprime el **acta de entrega** para que firmen.
6. **Stock**: existencias, costo promedio y valor. Cada material tiene su **kardex**. Usa **Conteo físico** una vez al mes para cuadrar con lo real.

## Reglas que aplica la app

- No deja entregar más de lo que hay en stock ni más de lo pendiente en la O/C.
- Nada se borra: los errores se **anulan** con motivo y quedan tachados.
- Los materiales que regresan al almacén se registran como **Devolución** y se descuentan de lo entregado.
- Cada O/C muestra el **costo de los materiales entregados** y el **margen bruto**. Registra los costos con el mismo criterio (con o sin IGV) que los precios de la O/C.

## Respaldo

Los datos se guardan solo en ese navegador y en esa computadora. En **Respaldo** descarga el archivo `.json` cada semana (USB, Drive o correo). Con ese archivo restauras todo en otra computadora.

Los reportes se exportan a Excel como CSV (separado por comas y con punto decimal).

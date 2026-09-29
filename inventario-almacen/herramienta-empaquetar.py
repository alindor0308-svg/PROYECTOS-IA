# Genera ../Inventario-Almacen.html: la app completa en un solo archivo para abrir con doble clic.
import pathlib

base = pathlib.Path(__file__).parent
h = (base / 'index.html').read_text(encoding='utf-8')
h = h.replace('<link rel="stylesheet" href="css/estilos.css">', '<style>\n' + (base / 'css/estilos.css').read_text(encoding='utf-8') + '\n</style>')
for js in ['js/ordenes-iniciales.js', 'js/compras-registradas.js', 'js/graficos.js', 'js/app.js']:
    codigo = (base / js).read_text(encoding='utf-8').replace('</script', '<\\/script')
    h = h.replace(f'<script src="{js}"></script>', '<script>\n' + codigo + '\n</script>')
assert 'src="js/' not in h and 'href="css/' not in h
(base.parent / 'Inventario-Almacen.html').write_text(h, encoding='utf-8')
print('Listo:', base.parent / 'Inventario-Almacen.html')

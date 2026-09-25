"""Genera la versión de la app para publicarla dentro de claude.ai (Artifact).

claude.ai envuelve la página en su propio <html>/<head>/<body>, así que aquí se
quitan esas etiquetas, se incrusta la hoja de estilos y se omite el SDK de la API
(dentro de claude.ai la app usa directamente la cuenta del usuario).

Uso: python3 herramientas/armar_artifact.py <archivo_salida.html>
"""
import pathlib
import re
import sys

raiz = pathlib.Path(__file__).resolve().parent.parent
html = (raiz / 'index.html').read_text(encoding='utf-8')
css = (raiz / 'css' / 'estilos.css').read_text(encoding='utf-8')

html = re.sub(r'<!DOCTYPE[^>]*>\s*', '', html, flags=re.I)
html = re.sub(r'</?(html|head|body)[^>]*>\s*', '', html, flags=re.I)
html = re.sub(r'\s*<meta[^>]*>', '', html, flags=re.I)
html = html.replace('<link rel="stylesheet" href="css/estilos.css">', f'<style>\n{css}\n</style>')
html = html.replace('  <script src="vendor/anthropic-sdk.js"></script>\n', '')

salida = pathlib.Path(sys.argv[1])
salida.write_text(html.strip() + '\n', encoding='utf-8')
print(f'Generado {salida} ({len(html):,} bytes)')

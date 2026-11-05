"""Use the document skill's Poppler rendering pipeline with an installed Word PDF.

Windows on this machine has Word but not LibreOffice. Export-Report.ps1 creates
the PDF from the DOCX; this adapter replaces only the renderer's conversion hook.
The bundled render_docx.py still performs page rasterisation and output naming.
"""
import argparse
import importlib.util
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument("--renderer",required=True)
parser.add_argument("--docx",required=True)
parser.add_argument("--pdf",required=True)
parser.add_argument("--output",required=True)
args=parser.parse_args()
document=Path(args.docx).resolve(); pdf=Path(args.pdf).resolve()
if not document.is_file() or not pdf.is_file(): raise SystemExit("Export the DOCX to PDF first.")
if pdf.stat().st_mtime < document.stat().st_mtime: raise SystemExit("PDF predates the latest DOCX. Export again before rendering.")
spec=importlib.util.spec_from_file_location("skill_render_docx",args.renderer)
renderer=importlib.util.module_from_spec(spec); spec.loader.exec_module(renderer)
renderer.convert_to_pdf=lambda *a,**kw:(str(pdf),"Converted by installed Microsoft Word through Export-Report.ps1")
pages=renderer.rasterize(str(document),args.output,130,False,False)
print(f"Rendered {len(pages)} pages with render_docx.py and Poppler")

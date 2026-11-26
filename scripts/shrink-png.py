"""Shrinks flat-colour PNG icons: a 256-colour palette (with transparency) and the best deflate. The icons are a few flat colours
on a dark gradient, so nothing visible is lost, and a canvas export (which is not compressed well) drops to a third of its size.
Writes no metadata chunks. Used by scripts/make-icons.js; runs on its own too:  python scripts/shrink-png.py icon-512.png ..."""
import sys
from PIL import Image

for path in sys.argv[1:]:
    img = Image.open(path).convert("RGBA")
    pal = img.quantize(colors=256, method=Image.Quantize.FASTOCTREE)
    pal.save(path, "PNG", optimize=True)
    print(path, "palette", len(pal.getpalette()) // 3 if pal.getpalette() else "-")

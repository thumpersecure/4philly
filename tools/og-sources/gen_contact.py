#!/usr/bin/env python3
"""4philly.net contact OG card. Background art generated with ElevenLabs
(gpt-image-2, flow K9EbYUDTYEk5N1BlxHkO, see contact.txt); text composited here
so it is exact. Output: /root/4philly/og-contact.png (1200x630)."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import pathlib
HERE = pathlib.Path(__file__).parent
F = "/usr/share/fonts/truetype/og-v5/"
bg = Image.open(HERE / "contact-bg.png").convert("RGB")
bg = bg.resize((1200, 675), Image.LANCZOS).crop((0, 30, 1200, 660))   # 1200x630
# soft left-side scrim so the headline always has contrast
scrim = Image.new("L", (1200, 630), 0)
d = ImageDraw.Draw(scrim)
for x in range(0, 760):
    d.line([(x, 0), (x, 630)], fill=int(150 * (1 - x / 760)))
bg.paste(Image.new("RGB", (1200, 630), (6, 30, 70)), (0, 0), scrim)
d = ImageDraw.Draw(bg)
WHITE, RED = (255, 255, 255), (200, 16, 46)
d.text((64, 52), "4", font=ImageFont.truetype(F + "SourceSerif4-Black.otf", 44), fill=WHITE)
d.text((92, 52), "PHILLY", font=ImageFont.truetype(F + "SourceSerif4-Black.otf", 44), fill=(120, 175, 255))
h = ImageFont.truetype(F + "SourceSerif4-Black.otf", 138)
d.text((60, 150), "Got a", font=h, fill=WHITE)
d.text((60, 280), "question?", font=h, fill=WHITE)
d.rectangle([64, 452, 64 + 300, 462], fill=RED)
d.text((64, 500), "4philly.net/contact", font=ImageFont.truetype(F + "IBMPlexMono-Bold.ttf", 40), fill=WHITE)
bg.save(HERE.parent.parent / "og-contact.png")

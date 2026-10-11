#!/usr/bin/env python3
"""Generate /root/4philly/og-about.png (1200x630) - About page OG card, 'The question'."""
from PIL import Image, ImageDraw, ImageFont
import os
W, H = 1200, 630
F = "/usr/share/fonts/truetype/og-v5/"
BLUE, DEEP, RED, WHITE = (13, 95, 166), (10, 61, 115), (200, 16, 46), (255, 255, 255)

img = Image.new("RGB", (W, H), BLUE)
px = img.load()
for y in range(H):  # vertical gradient blue -> deep
    t = y / (H - 1)
    c = tuple(round(BLUE[i] + (DEEP[i] - BLUE[i]) * t) for i in range(3))
    for x in range(W):
        px[x, y] = c
d = ImageDraw.Draw(img)

head = ImageFont.truetype(F + "SourceSerif4-Black.otf", 134)
mono = ImageFont.truetype(F + "IBMPlexMono-SemiBold.ttf", 28)
mono_b = ImageFont.truetype(F + "IBMPlexMono-Bold.ttf", 30)
word = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)

L = 72
d.rectangle([0, 0, 18, H], fill=RED)           # red accent bar, left edge
d.text((L, 58), "4", font=word, fill=WHITE)
d.text((L + 28, 58), "PHILLY", font=word, fill=WHITE)

d.text((L, 140), "Is your landlord", font=head, fill=WHITE)
d.text((L, 140 + 150), "legal?", font=head, fill=WHITE)
lw = d.textlength("legal?", font=head)
d.rectangle([L, 140 + 150 + 178, L + lw, 140 + 150 + 190], fill=RED)  # red underline accent

d.text((L, 548), "Check the public record before you sign.", font=mono, fill=(220, 232, 245))
t = "4philly.net"
d.text((W - L - d.textlength(t, font=mono_b), 548), t, font=mono_b, fill=WHITE)

out = os.path.join(os.path.dirname(__file__), "..", "..", "og-about.png")
img.save(os.path.abspath(out), optimize=True)

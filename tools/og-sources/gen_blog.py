#!/usr/bin/env python3
"""OG card for 4philly.net/blog/ index: real Carto points plotted lon/lat. Writes blog/img/og-blog-index-v2.png + og-sources/blog.txt"""
import json, math, urllib.request, urllib.parse, datetime
from PIL import Image, ImageDraw, ImageFont, ImageFilter
ROOT = "/root/4philly"
F = "/usr/share/fonts/truetype/og-v5/"
CARTO = "https://phl.carto.com/api/v2/sql"
SQL_V = ("SELECT ST_X(the_geom) AS x, ST_Y(the_geom) AS y FROM violations "
         "WHERE violationstatus = 'OPEN' AND the_geom IS NOT NULL AND violationdate >= '2025-01-01' "
         "AND cartodb_id % 10 = 0 ORDER BY cartodb_id LIMIT 9000")
SQL_L = ("SELECT ST_X(the_geom) AS x, ST_Y(the_geom) AS y FROM business_licenses "
         "WHERE licensetype = 'Rental' AND licensestatus = 'Active' AND the_geom IS NOT NULL "
         "AND cartodb_id % 20 = 0 ORDER BY cartodb_id LIMIT 6000")
def q(sql):
    with urllib.request.urlopen(CARTO + "?" + urllib.parse.urlencode({"q": sql}), timeout=90) as r:
        return [(d["x"], d["y"]) for d in json.load(r)["rows"] if d["x"] and d["y"]]
V, L = q(SQL_V), q(SQL_L)
# Philadelphia extent filter (drops geocode outliers)
inb = lambda p: -75.30 < p[0] < -74.94 and 39.86 < p[1] < 40.15
V, L = [p for p in V if inb(p)], [p for p in L if inb(p)]
allp = V + L
x0, x1 = min(p[0] for p in allp), max(p[0] for p in allp)
y0, y1 = min(p[1] for p in allp), max(p[1] for p in allp)
k = math.cos(math.radians(40.0))
W, H, S = 1200, 630, 2
mapH = 585
scale = mapH / (y1 - y0)
mapW = (x1 - x0) * k * scale
if mapW > 640: scale *= 640 / mapW; mapW = 640; mapH = (y1 - y0) * scale
ox = 1200 - 28 - mapW; oy = (H - mapH) / 2 + 4
P = lambda p: ((ox + (p[0] - x0) * k * scale) * S, (oy + (y1 - p[1]) * scale) * S)
BG = (11, 16, 26)
img = Image.new("RGB", (W * S, H * S), BG)
# faint grid
d = ImageDraw.Draw(img)
for gx in range(0, W, 40): d.line([(gx * S, 0), (gx * S, H * S)], fill=(17, 24, 38), width=S)
for gy in range(0, H, 40): d.line([(0, gy * S), (W * S, gy * S)], fill=(17, 24, 38), width=S)
def layer(pts, col, r, glow):
    g = Image.new("RGB", img.size, (0, 0, 0)); gd = ImageDraw.Draw(g)
    for p in pts:
        x, y = P(p); gd.ellipse([x - r * S * 2, y - r * S * 2, x + r * S * 2, y + r * S * 2], fill=tuple(int(c * glow) for c in col))
    g = g.filter(ImageFilter.GaussianBlur(3 * S))
    from PIL import ImageChops
    return ImageChops.add(img, g)
img = layer(L, (60, 140, 255), 1.6, 0.35)
d = ImageDraw.Draw(img)
for p in L:
    x, y = P(p); r = 1.7 * S; d.ellipse([x - r, y - r, x + r, y + r], fill=(70, 150, 255))
img = layer(V, (255, 50, 50), 1.9, 0.5)
d = ImageDraw.Draw(img)
for p in V:
    x, y = P(p); r = 2.3 * S; d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 64, 64))
# left dark fade for text
fade = Image.new("L", img.size, 0); fd = ImageDraw.Draw(fade)
for x in range(0, 760 * S):
    a = 235 if x < 380 * S else int(235 * (1 - (x - 380 * S) / (380 * S)))
    fd.line([(x, 0), (x, H * S)], fill=a)
img = Image.composite(Image.new("RGB", img.size, BG), img, fade)
d = ImageDraw.Draw(img)
f_h = ImageFont.truetype(F + "SourceSerif4-Black.otf", 92 * S)
f_m = ImageFont.truetype(F + "IBMPlexMono-Bold.ttf", 28 * S)
f_s = ImageFont.truetype(F + "IBMPlexMono-SemiBold.ttf", 21 * S)
def txt(xy, s, f, fill, sh=True):
    if sh: d.text((xy[0] + 3 * S, xy[1] + 3 * S), s, font=f, fill=(0, 0, 0))
    d.text(xy, s, font=f, fill=fill)
txt((52 * S, 40 * S), "4PHILLY", f_m, (255, 255, 255))
d.rectangle([52 * S, 82 * S, 112 * S, 86 * S], fill=(255, 64, 64))
y = 112
for i, ln in enumerate(["Every", "violation.", "Every license.", "One search."]):
    pass
lines = [("Every violation.", (255, 255, 255)), ("Every license.", (255, 255, 255)), ("One search.", (255, 90, 90))]
f_h = ImageFont.truetype(F + "SourceSerif4-Black.otf", 84 * S)
# wrap "Every violation." -> two lines at huge size for 150px legibility
lines = [("Every", (255, 255, 255)), ("violation.", (255, 90, 90)), ("Every license.", (255, 255, 255)), ("One search.", (255, 255, 255))]
fs = [96, 96, 66, 66]
y = 100
for (s, c), sz in zip(lines, fs):
    f = ImageFont.truetype(F + "SourceSerif4-Black.otf", sz * S)
    txt((52 * S, y * S), s, f, c); y += int(sz * 1.05)
txt((52 * S, 566 * S), "Renter guides & articles · 4philly.net", f_s, (205, 214, 228))
out = img.resize((W, H), Image.LANCZOS)
out.save(ROOT + "/blog/img/og-blog-index-v2.png", optimize=True)
open(ROOT + "/tools/og-sources/blog.txt", "w").write(
f"""OG card: blog/img/og-blog-index-v2.png  (generator: tools/og-sources/gen_blog.py)
Source: City of Philadelphia open data, Carto API https://phl.carto.com/api/v2/sql
Fetched: {datetime.date.today().isoformat()}
Points plotted at true lon/lat (equirectangular, x scaled by cos(40deg)); no points fabricated or jittered.
Deterministic thinning (cartodb_id modulus) is the only sampling.

Violations (red) SQL:
{SQL_V}
Rows returned/plotted: {len(V)}

Licenses (blue) SQL:
{SQL_L}
Rows returned/plotted: {len(L)}

Total points plotted: {len(V)+len(L)}
(plotted after filtering to lon -75.30..-74.94, lat 39.86..40.15)
""")
print(len(V), len(L))

#!/usr/bin/env python3
"""Render og-main.png (1200x630): phone mockup of a real 4PHILLY lookup result.
Record + query are documented in main.txt. Run: python3 gen_main.py"""
import subprocess, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
HTML = pathlib.Path("/tmp/og-main.html")
OUT = ROOT / "og-main.png"
html = """<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800;900&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--ink:#14171a;--dim:#474e57;--mute:#5d6570;--line:#d8dde4;--panel:#f6f7f9;--accent:#1550e0;--red:#c62f28}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:630px;overflow:hidden}
body{background:#fff;font-family:"Archivo",sans-serif;color:var(--ink);position:relative}
.glow{position:absolute;right:-120px;top:-160px;width:900px;height:900px;background:radial-gradient(closest-side,rgba(21,80,224,.13),rgba(21,80,224,0));}
.mark{position:absolute;left:72px;top:54px;font-weight:800;font-size:34px;letter-spacing:-.02em;display:flex;gap:12px}
.mark b{color:var(--accent);font-weight:800}
.copy{position:absolute;left:72px;top:150px;width:600px}
h1{font-weight:900;font-size:94px;line-height:.98;letter-spacing:-.035em}
h1 em{font-style:normal;color:var(--red)}
.sub{margin-top:34px;font-family:"IBM Plex Mono",monospace;font-size:26px;font-weight:600;color:var(--dim)}
.sub b{color:var(--accent)}
.foot{position:absolute;left:72px;bottom:46px;font-family:"IBM Plex Mono",monospace;font-size:17px;color:var(--mute);letter-spacing:.04em}
/* phone */
.phone{position:absolute;left:740px;top:46px;width:352px;height:690px;border-radius:50px;background:#14171a;padding:13px;box-shadow:0 30px 60px rgba(16,24,40,.30),0 4px 10px rgba(16,24,40,.2);transform:rotate(3deg);transform-origin:50% 40%}
.screen{width:100%;height:100%;border-radius:38px;background:#fff;overflow:hidden;position:relative;padding:34px 20px 0}
.notch{position:absolute;left:50%;top:10px;width:92px;height:22px;margin-left:-46px;background:#14171a;border-radius:12px}
.bar{display:flex;justify-content:space-between;align-items:center;margin-top:14px;font-weight:800;font-size:19px}
.bar b{color:var(--accent)}
.bar span{font-family:"IBM Plex Mono",monospace;font-size:10px;color:var(--mute);letter-spacing:.1em}
.addr{margin-top:20px;font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.12em;color:var(--mute)}
.street{font-weight:800;font-size:27px;letter-spacing:-.02em;margin-top:2px}
.zip{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--mute);margin-top:2px}
.badge{margin-top:18px;border-radius:10px;background:var(--red);color:#fff;padding:14px 14px 13px}
.badge .k{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.14em;opacity:.9}
.badge .v{font-weight:900;font-size:30px;letter-spacing:-.01em;margin-top:2px;line-height:1}
.badge .d{font-family:"IBM Plex Mono",monospace;font-size:12px;margin-top:7px;font-weight:600}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}
.cell{border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:10px 11px}
.cell h4{font-family:"IBM Plex Mono",monospace;font-size:9px;letter-spacing:.1em;color:var(--mute);font-weight:600}
.cell .n{font-weight:900;font-size:30px;line-height:1.05;margin-top:3px;color:var(--red)}
.cell .t{font-weight:800;font-size:15px;margin-top:9px;color:var(--red)}
.cell small{display:block;font-family:"IBM Plex Mono",monospace;font-size:10px;color:var(--mute);margin-top:2px}
.src{margin-top:12px;font-family:"IBM Plex Mono",monospace;font-size:9.5px;color:var(--mute);line-height:1.5;border-top:1px solid var(--line);padding-top:10px}
</style></head><body>
<div class="glow"></div>
<div class="mark"><span>4</span><b>PHILLY</b></div>
<div class="copy">
  <h1>Is your <em>landlord</em> legit?</h1>
  <div class="sub">Check the City record. <b>4philly.net</b></div>
</div>
<div class="foot">Real City open data &middot; Licenses &middot; Violations</div>
<div class="phone"><div class="screen"><div class="notch"></div>
  <div class="bar"><div>4 <b>PHILLY</b></div><span>LOOKUP</span></div>
  <div class="addr">PROPERTY</div>
  <div class="street">4151 N 8TH ST</div>
  <div class="zip">PHILADELPHIA, PA 19140</div>
  <div class="badge"><div class="k">RENTAL LICENSE</div><div class="v">LICENSE EXPIRED</div><div class="d">Expired Aug 24, 2026</div></div>
  <div class="grid">
    <div class="cell"><h4>OPEN VIOLATIONS</h4><div class="n">16</div><small>L&amp;I, still open</small></div>
    <div class="cell"><h4>RENTAL LICENSE</h4><div class="t">Expired</div><small>Lic. 904213</small></div>
  </div>
  <div class="src">Source: City of Philadelphia open data (Carto). Snapshot Oct 11, 2026.</div>
</div></div>
</body></html>"""
HTML.write_text(html)
subprocess.run(["/usr/bin/chromium","--headless","--disable-gpu","--no-sandbox","--hide-scrollbars",
  "--force-device-scale-factor=1","--virtual-time-budget=6000","--window-size=1200,630",
  f"--screenshot={OUT}", f"file://{HTML}"], check=True, capture_output=True)
print("wrote", OUT)

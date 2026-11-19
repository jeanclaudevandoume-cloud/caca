# Before/after contact sheet + metrics:  python3 tools/sheet.py <tagA> <tagB> [out.png]
# Metrics per vantage: luma std (contrast) and mean saturation, computed on the 3D view
# (the top 70 px of UI are excluded).
import sys, json, os
from PIL import Image, ImageDraw, ImageStat
a, b = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else f'shots/sheet-{a}-{b}.png'
names = [n[:-4] for n in sorted(os.listdir(f'shots/{b}')) if n.endswith('.png') and os.path.exists(f'shots/{a}/{n}')]
def metrics(path):
    im = Image.open(path).convert('RGB')
    im = im.crop((0, 70, im.width, im.height))
    l = ImageStat.Stat(im.convert('L'))
    s = ImageStat.Stat(im.convert('HSV').split()[1])
    return round(l.stddev[0] / 255, 3), round(s.mean[0] / 255, 3), round(l.mean[0] / 255, 3)
W, H = 550, 310
sheet = Image.new('RGB', (W * 2 + 30, (H + 24) * len(names) + 10), (30, 30, 34))
d = ImageDraw.Draw(sheet)
rows = {}
for i, n in enumerate(names):
    y = i * (H + 24) + 5
    ma, mb = metrics(f'shots/{a}/{n}.png'), metrics(f'shots/{b}/{n}.png')
    rows[n] = {'before': ma, 'after': mb}
    for j, (tag, m) in enumerate(((a, ma), (b, mb))):
        im = Image.open(f'shots/{tag}/{n}.png').convert('RGB'); im.thumbnail((W, H))
        sheet.paste(im, (10 + j * (W + 10), y + 20))
        d.text((10 + j * (W + 10), y + 4), f'{n} [{tag}]  contrast {m[0]}  sat {m[1]}  mean {m[2]}', fill=(230, 230, 230))
sheet.save(out)
print(json.dumps(rows, indent=1))
print('sheet:', out)

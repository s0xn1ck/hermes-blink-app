from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).parent
SIZE = 24
BLACK = (0, 0, 0, 255)
CLEAR = (0, 0, 0, 0)


def canvas():
    image = Image.new('RGBA', (SIZE, SIZE), CLEAR)
    return image, ImageDraw.Draw(image)


def save(image, name):
    image.save(OUT / name, format='PNG', optimize=True)


# 1. Blink eye: compact almond with a crisp pupil and two motion rays.
image, draw = canvas()
draw.line([(3, 12), (7, 8), (12, 6), (17, 8), (21, 12)], fill=BLACK, width=2)
draw.line([(3, 12), (7, 16), (12, 18), (17, 16), (21, 12)], fill=BLACK, width=2)
draw.ellipse((9, 9, 15, 15), fill=BLACK)
draw.line([(17, 5), (19, 3)], fill=BLACK, width=1)
draw.line([(20, 7), (22, 6)], fill=BLACK, width=1)
save(image, 'blink-eye-24.png')

# 2. Hermes spark: diamond lens with a fast lightning core.
image, draw = canvas()
draw.line([(12, 2), (21, 12), (12, 22), (3, 12), (12, 2)], fill=BLACK, width=2)
draw.polygon([(13, 5), (7, 13), (11, 13), (9, 19), (17, 10), (13, 10)], fill=BLACK)
save(image, 'blink-spark-24.png')

# 3. Smart glasses: two lenses, bridge, temples, and status glint.
image, draw = canvas()
draw.rounded_rectangle((2, 8, 10, 16), radius=2, outline=BLACK, width=2)
draw.rounded_rectangle((14, 8, 22, 16), radius=2, outline=BLACK, width=2)
draw.line([(10, 11), (14, 11)], fill=BLACK, width=2)
draw.line([(2, 10), (0, 8)], fill=BLACK, width=2)
draw.line([(22, 10), (24, 8)], fill=BLACK, width=2)
draw.point((19, 10), fill=BLACK)
draw.point((20, 9), fill=BLACK)
save(image, 'blink-glasses-24.png')

# Review sheet only: nearest-neighbor enlargement preserves exact pixels.
files = ['blink-eye-24.png', 'blink-spark-24.png', 'blink-glasses-24.png']
sheet = Image.new('RGBA', (24 * 3 + 16, 24), (255, 255, 255, 255))
for index, filename in enumerate(files):
    icon = Image.open(OUT / filename)
    sheet.alpha_composite(icon, (index * 32, 0))
sheet.resize((sheet.width * 12, sheet.height * 12), Image.Resampling.NEAREST).save(OUT / 'blink-icons-preview.png')

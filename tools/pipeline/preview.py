"""预览图生成 + 联系表 HTML"""

import os
from PIL import Image


def generate_preview(png_16_path, output_path, scale=16):
    """生成 256x256 放大预览图"""
    img = Image.open(png_16_path)
    preview = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    preview.save(output_path)


def generate_comparison(raw_path, small_path, svg_path, output_path, scale=16):
    """生成三联对比图：原图 | 缩放 | 最终"""
    raw = Image.open(raw_path).convert("RGBA").resize((256, 256), Image.LANCZOS)
    small = Image.open(small_path).convert("RGBA")
    small_up = small.resize((256, 256), Image.NEAREST)

    # 拼接
    comparison = Image.new("RGBA", (256 * 2 + 16, 256), (20, 20, 30, 255))
    comparison.paste(raw, (0, 0))
    comparison.paste(small_up, (256 + 16, 0))
    comparison.save(output_path)


def generate_contact_sheet(items, output_html, svg_dir, preview_dir):
    """生成 HTML 联系表页面，用于批量审查

    Args:
        items: [(名称, 得分, 是否通过), ...]
        output_html: 输出 HTML 路径
        svg_dir: SVG 文件目录
        preview_dir: 预览图目录
    """
    rows = []
    for name, score, passed in items:
        svg_path = os.path.join(svg_dir, f"{name}.svg")
        preview_path = os.path.join(preview_dir, f"{name}.png")
        status = "✓" if passed else "✗"
        color = "#a7f070" if passed else "#b13e53"

        rows.append(f'''
    <div class="card" style="border-color: {color}">
      <img src="{os.path.relpath(svg_path, os.path.dirname(output_html))}" width="128" height="128"
           style="image-rendering: pixelated">
      <div class="name">{name}</div>
      <div class="score" style="color: {color}">{status} {score:.0f}</div>
    </div>''')

    html = f'''<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Pipeline Review</title>
<style>
  body {{ background: #0a0a0f; color: #ccc; font-family: system-ui; padding: 32px; }}
  h1 {{ color: #ffcd75; font-weight: 300; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; margin-top: 24px; }}
  .card {{ background: #111; border: 2px solid #333; border-radius: 8px; padding: 16px; text-align: center; }}
  .card img {{ display: block; margin: 0 auto 8px; }}
  .name {{ font-size: 12px; color: #888; }}
  .score {{ font-size: 14px; font-weight: bold; margin-top: 4px; }}
</style>
</head>
<body>
<h1>Pipeline Review — {len(items)} items</h1>
<p>{sum(1 for _,_,p in items if p)} passed / {sum(1 for _,_,p in items if not p)} failed</p>
<div class="grid">{"".join(rows)}
</div>
</body>
</html>'''

    with open(output_html, "w") as f:
        f.write(html)
    print(f"联系表: {output_html}")

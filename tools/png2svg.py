#!/usr/bin/env python3
"""
PNG → SVG 像素画转换器
将 16x16 或 32x32 的像素画 PNG 转换为优化的 SVG（path 格式）

功能：
1. 读取 PNG，逐像素提取颜色
2. 自动对齐到 HARVEST-20 调色板（可选）
3. 同色像素合并为连续水平路径段，最小化文件体积
4. 输出与项目格式一致的 SVG

用法：
  python3 png2svg.py input.png [output.svg] [--no-snap]
  python3 png2svg.py input.png --snap   # 强制对齐调色板
"""

import sys
import os
import math
from PIL import Image
from collections import defaultdict

# HARVEST-20 调色板
HARVEST_20 = {
    "墨黑": (0x1a, 0x1c, 0x2c),
    "梅紫": (0x5d, 0x27, 0x5d),
    "玫瑰": (0xb1, 0x3e, 0x53),
    "橘色": (0xef, 0x7d, 0x57),
    "金黄": (0xff, 0xcd, 0x75),
    "嫩芽": (0xa7, 0xf0, 0x70),
    "三叶草": (0x38, 0xb7, 0x64),
    "青色": (0x25, 0x71, 0x79),
    "深海": (0x29, 0x36, 0x6f),
    "海洋": (0x3b, 0x5d, 0xc9),
    "天空": (0x41, 0xa6, 0xf6),
    "冰蓝": (0x73, 0xef, 0xf7),
    "雪白": (0xf4, 0xf4, 0xf4),
    "雾灰": (0x94, 0xb0, 0xc2),
    "石板": (0x56, 0x6c, 0x86),
    "夜蓝": (0x33, 0x3c, 0x57),
    "树皮": (0x6b, 0x3e, 0x2e),
    "木纹": (0xa8, 0x77, 0x5e),
    "麦穗": (0xd4, 0xa5, 0x6a),
    "松针": (0x4a, 0x5e, 0x3b),
}

def color_distance(c1, c2):
    """加权欧氏距离（人眼对绿色更敏感）"""
    dr = c1[0] - c2[0]
    dg = c1[1] - c2[1]
    db = c1[2] - c2[2]
    return math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db)

def snap_to_palette(r, g, b):
    """将颜色对齐到最近的 HARVEST-20 色"""
    best = None
    best_dist = float('inf')
    for name, (pr, pg, pb) in HARVEST_20.items():
        d = color_distance((r, g, b), (pr, pg, pb))
        if d < best_dist:
            best_dist = d
            best = (pr, pg, pb)
    return best

def rgb_to_hex(r, g, b):
    return f"#{r:02x}{g:02x}{b:02x}"

def optimize_paths(pixels_by_color, width, height):
    """将同色像素合并为水平路径段"""
    paths = {}
    for hex_color, pixel_set in pixels_by_color.items():
        segments = []
        for y in range(height):
            x = 0
            while x < width:
                if (x, y) in pixel_set:
                    # 找到连续的水平像素段
                    start_x = x
                    while x < width and (x, y) in pixel_set:
                        x += 1
                    run_len = x - start_x
                    segments.append(f"M{start_x} {y}h{run_len}v1h-{run_len}z")
                else:
                    x += 1
        if segments:
            paths[hex_color] = "".join(segments)
    return paths

def png_to_svg(input_path, output_path=None, snap=False):
    img = Image.open(input_path).convert("RGBA")
    width, height = img.size

    if width > 64 or height > 64:
        print(f"警告: 图片尺寸 {width}x{height} 过大，像素画通常为 16x16 或 32x32")

    # 按颜色分组像素
    pixels_by_color = defaultdict(set)
    palette_report = defaultdict(int)
    snapped_count = 0

    for y in range(height):
        for x in range(width):
            r, g, b, a = img.getpixel((x, y))
            if a < 128:  # 透明像素跳过
                continue

            if snap:
                orig = (r, g, b)
                r, g, b = snap_to_palette(r, g, b)
                if orig != (r, g, b):
                    snapped_count += 1

            hex_color = rgb_to_hex(r, g, b)
            pixels_by_color[hex_color].add((x, y))
            palette_report[hex_color] += 1

    # 优化路径
    paths = optimize_paths(pixels_by_color, width, height)

    # 按像素数排序（多的先画，少的后画覆盖在上面）
    sorted_colors = sorted(paths.keys(), key=lambda c: palette_report[c], reverse=True)

    # 生成 SVG
    svg_lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" shape-rendering="crispEdges">'
    ]

    for color in sorted_colors:
        svg_lines.append(f'<path fill="{color}" d="{paths[color]}"/>')

    svg_lines.append('</svg>')
    svg_content = "\n".join(svg_lines)

    # 输出
    if output_path is None:
        output_path = os.path.splitext(input_path)[0] + ".svg"

    with open(output_path, "w") as f:
        f.write(svg_content)

    # 报告
    print(f"✓ 转换完成: {input_path} → {output_path}")
    print(f"  尺寸: {width}×{height}")
    print(f"  颜色数: {len(paths)}")
    print(f"  像素总数: {sum(palette_report.values())}")
    if snap:
        print(f"  调色板矫正: {snapped_count} 个像素被对齐到 HARVEST-20")
    print(f"  文件大小: {len(svg_content)} bytes")

    # 调色板合规检查
    harvest_hexes = {rgb_to_hex(*v) for v in HARVEST_20.values()}
    non_palette = [c for c in paths.keys() if c not in harvest_hexes]
    if non_palette:
        print(f"  ⚠ 非 HARVEST-20 颜色: {', '.join(non_palette)}")
        print(f"    用 --snap 参数自动矫正")
    else:
        print(f"  ✓ 所有颜色均符合 HARVEST-20 调色板")

    return output_path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = None
    snap = False

    for arg in sys.argv[2:]:
        if arg == "--snap":
            snap = True
        elif arg == "--no-snap":
            snap = False
        elif not arg.startswith("-"):
            output_path = arg

    png_to_svg(input_path, output_path, snap)

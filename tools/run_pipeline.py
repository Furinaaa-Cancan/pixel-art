#!/usr/bin/env python3
"""
AI 像素画生产管线 — 批量编排器

用法：
  python3 tools/run_pipeline.py items.txt [--local|--replicate] [--retries 3]

items.txt 格式（每行一个，| 分隔名称和描述）：
  turnip | a cute white turnip with green leaves
  axe | a wooden axe with metal head
  salmon | a pink salmon fish

环境变量：
  REPLICATE_API_TOKEN — 使用 Replicate 后端时需要
"""

import os
import sys
import datetime

# 添加项目根目录到 path
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from pipeline.generate import generate
from pipeline.downscale import smart_downscale
from pipeline.postprocess import postprocess
from pipeline.preview import generate_preview, generate_contact_sheet
from png2svg import png_to_svg


def score_svg(filepath):
    """简化版质量评分 (0-100)"""
    import re
    from pipeline.palette import HARVEST_20_HEXES, OUTLINE_HEX

    with open(filepath) as f:
        content = f.read()

    # 解析像素
    pixels = {}
    for match in re.finditer(r'<path\s+fill="([^"]+)"\s+d="([^"]+)"', content):
        color = match.group(1).lower()
        d = match.group(2)
        for m in re.finditer(r'M(\d+)[, ](\d+)h(\d+)v(\d+)', d):
            x, y, w, h = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
            for dx in range(w):
                for dy in range(h):
                    pixels[(x + dx, y + dy)] = color

    if not pixels:
        return 0.0, False

    colors_used = set(pixels.values())
    total_pixels = len(pixels)

    # 1. 调色板合规 (30分)
    non_palette = [c for c in colors_used if c not in HARVEST_20_HEXES]
    palette_score = max(0, 30 - len(non_palette) * 10)

    # 2. 轮廓完整性 (30分)
    outline_gaps = 0
    for (x, y), color in pixels.items():
        if color == OUTLINE_HEX:
            continue
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nx, ny = x + dx, y + dy
            if (nx, ny) not in pixels:
                outline_gaps += 1
                break
    outline_ratio = outline_gaps / max(1, total_pixels)
    outline_score = max(0, 30 - int(outline_ratio * 100))

    # 3. 颜色数合理 4-12 (20分)
    n_colors = len(colors_used)
    if 4 <= n_colors <= 12:
        color_score = 20
    elif 3 <= n_colors <= 15:
        color_score = 10
    else:
        color_score = 0

    # 4. 填充率 30-80% (20分)
    fill_ratio = total_pixels / 256  # 16x16
    if 0.25 <= fill_ratio <= 0.85:
        fill_score = 20
    elif 0.15 <= fill_ratio <= 0.95:
        fill_score = 10
    else:
        fill_score = 0

    total = palette_score + outline_score + color_score + fill_score
    return total, total >= 60


def process_item(name, description, backend, output_dirs, retries=3):
    """处理单个物品，返回 (得分, 是否通过)"""
    print(f"\n{'='*50}")
    print(f"生成: {name}")
    if description:
        print(f"描述: {description}")

    for attempt in range(retries):
        seed = attempt * 1337

        # 1. 生成
        print(f"  [{attempt+1}/{retries}] 生成 512x512 (seed={seed})...")
        try:
            raw_img = generate(name, description, seed=seed, backend=backend)
        except Exception as e:
            print(f"  生成失败: {e}")
            continue

        raw_path = os.path.join(output_dirs["raw"], f"{name}_{attempt}.png")
        raw_img.save(raw_path)
        print(f"  原图: {raw_path}")

        # 2. 智能缩放
        print(f"  缩放到 16x16...")
        try:
            small_img = smart_downscale(raw_img, target_size=16)
        except Exception as e:
            print(f"  缩放失败: {e}")
            continue

        # 3. 后处理
        print(f"  后处理（轮廓/光影/微光）...")
        processed = postprocess(small_img)

        small_path = os.path.join(output_dirs["small"], f"{name}.png")
        processed.save(small_path)

        # 4. 转 SVG
        svg_path = os.path.join(output_dirs["svg"], f"{name}.svg")
        png_to_svg(small_path, svg_path, snap=True)

        # 5. 质量评分
        score, passed = score_svg(svg_path)
        status = "✓ 通过" if passed else "✗ 未通过"
        print(f"  得分: {score:.0f}/100 {status}")

        # 6. 生成预览
        preview_path = os.path.join(output_dirs["preview"], f"{name}.png")
        generate_preview(small_path, preview_path, scale=16)

        if passed:
            return score, True

        print(f"  重试...")

    return score, False


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        print(__doc__)
        sys.exit(1)

    items_file = args[0]
    backend = "local"
    retries = 3

    for i, arg in enumerate(args[1:], 1):
        if arg == "--local":
            backend = "local"
        elif arg == "--replicate":
            backend = "replicate"
        elif arg == "--retries" and i + 1 < len(args):
            retries = int(args[i + 1])

    # 解析物品清单
    items = []
    with open(items_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("|", 1)
            name = parts[0].strip()
            desc = parts[1].strip() if len(parts) > 1 else None
            items.append((name, desc))

    print(f"管线启动: {len(items)} 个物品, 后端={backend}, 最大重试={retries}")

    # 创建输出目录
    date_str = datetime.datetime.now().strftime("%Y-%m-%d")
    base_dir = os.path.join(ROOT, "tools", "pipeline_runs", date_str)
    output_dirs = {}
    for sub in ["raw", "nobg", "small", "svg", "preview"]:
        d = os.path.join(base_dir, sub)
        os.makedirs(d, exist_ok=True)
        output_dirs[sub] = d

    # 处理
    results = []
    for name, desc in items:
        score, passed = process_item(name, desc, backend, output_dirs, retries)
        results.append((name, score, passed))

    # 生成联系表
    html_path = os.path.join(base_dir, "review.html")
    generate_contact_sheet(results, html_path, output_dirs["svg"], output_dirs["preview"])

    # 汇总
    passed = sum(1 for _, _, p in results if p)
    failed = sum(1 for _, _, p in results if not p)
    print(f"\n{'='*50}")
    print(f"完成: {passed} 通过, {failed} 未通过")
    print(f"联系表: {html_path}")

    if passed > 0:
        print(f"\n通过的 SVG 在: {output_dirs['svg']}/")
        print(f"复制到 assets/: cp {output_dirs['svg']}/*.svg assets/")


if __name__ == "__main__":
    main()

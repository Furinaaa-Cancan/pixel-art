#!/usr/bin/env python3
"""
像素画 SVG 质量校验工具
检测常见问题：轮廓缺口、调色板违规、空洞像素、轮廓被覆盖

用法：
  python3 quality_check.py assets/turnip.svg
  python3 quality_check.py assets/*.svg           # 批量检查
  python3 quality_check.py assets/ --new-only     # 只检查新风格（16x16）
"""

import sys
import os
import re
from collections import defaultdict

# HARVEST-20 调色板
HARVEST_20_HEXES = {
    "#1a1c2c", "#5d275d", "#b13e53", "#ef7d57", "#ffcd75",
    "#a7f070", "#38b764", "#257179", "#29366f", "#3b5dc9",
    "#41a6f6", "#73eff7", "#f4f4f4", "#94b0c2", "#566c86",
    "#333c57", "#6b3e2e", "#a8775e", "#d4a56a", "#4a5e3b",
}

OUTLINE_COLOR = "#1a1c2c"

def parse_svg_paths(svg_content):
    """解析 SVG 中所有 path 元素的 fill 和像素坐标"""
    paths = []
    for match in re.finditer(r'<path\s+[^>]*fill="([^"]+)"[^>]*d="([^"]+)"', svg_content):
        color = match.group(1).lower()
        d = match.group(2)
        pixels = set()
        # 解析 M{x} {y}h{w}v1h-{w}z 和 M{x},{y}h{w}v{h}h-{w}z 格式
        for m in re.finditer(r'M(\d+)[, ](\d+)h(\d+)v(\d+)', d):
            x, y, w, h = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
            for dx in range(w):
                for dy in range(h):
                    pixels.add((x + dx, y + dy))
        paths.append((color, pixels))
    return paths

def get_viewbox(svg_content):
    """获取 viewBox 尺寸"""
    m = re.search(r'viewBox="0 0 (\d+) (\d+)"', svg_content)
    if m:
        return int(m.group(1)), int(m.group(2))
    return 16, 16

def build_pixel_grid(paths, width, height):
    """按 SVG 渲染顺序构建最终像素网格（后面的覆盖前面的）"""
    grid = {}
    for color, pixels in paths:
        for px in pixels:
            grid[px] = color  # 后面的颜色覆盖前面的
    return grid

def check_outline_completeness(grid, width, height):
    """检查轮廓是否完整包围所有非透明像素"""
    issues = []
    filled_pixels = set(grid.keys())

    for (x, y), color in grid.items():
        # 检查每个非透明像素的四个方向
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nx, ny = x + dx, y + dy
            # 如果邻居在画布外或是透明的
            if (nx, ny) not in filled_pixels:
                # 那么当前像素应该是轮廓色
                if color != OUTLINE_COLOR and color != "#333c57":
                    # 检查是否有同方向的轮廓像素保护
                    issues.append({
                        "type": "outline_gap",
                        "x": x, "y": y,
                        "color": color,
                        "direction": f"({dx},{dy})",
                        "msg": f"像素({x},{y}) 颜色{color}暴露在外，缺少轮廓保护（方向{dx},{dy}）"
                    })
    return issues

def check_palette_compliance(grid):
    """检查所有颜色是否在 HARVEST-20 内"""
    issues = []
    colors_used = set(c for c in grid.values())
    for color in colors_used:
        if color not in HARVEST_20_HEXES:
            count = sum(1 for c in grid.values() if c == color)
            issues.append({
                "type": "palette_violation",
                "color": color,
                "count": count,
                "msg": f"颜色 {color} 不在 HARVEST-20 调色板中（使用了 {count} 次）"
            })
    return issues

def check_interior_holes(grid, width, height):
    """检查是否有被填充像素包围的空洞"""
    issues = []
    filled = set(grid.keys())

    for y in range(height):
        for x in range(width):
            if (x, y) not in filled:
                # 检查四方向是否都被包围
                surrounded = True
                for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    # 沿该方向走到边缘，看是否能走出去
                    nx, ny = x + dx, y + dy
                    found_edge = False
                    while 0 <= nx < width and 0 <= ny < height:
                        if (nx, ny) in filled:
                            found_edge = True
                            break
                        nx += dx
                        ny += dy
                    if not found_edge:
                        surrounded = False
                        break
                if surrounded:
                    issues.append({
                        "type": "interior_hole",
                        "x": x, "y": y,
                        "msg": f"内部空洞：像素({x},{y}) 被填充像素包围但未着色"
                    })
    return issues

def check_outline_overwrite(paths):
    """检查轮廓是否被后续填充覆盖"""
    issues = []
    outline_pixels = set()
    for color, pixels in paths:
        if color == OUTLINE_COLOR:
            outline_pixels.update(pixels)

    # 检查后续路径是否覆盖了轮廓像素
    seen_outline = False
    for color, pixels in paths:
        if color == OUTLINE_COLOR:
            seen_outline = True
            continue
        if seen_outline and color != OUTLINE_COLOR:
            overwritten = outline_pixels & pixels
            if overwritten:
                for px in overwritten:
                    issues.append({
                        "type": "outline_overwrite",
                        "x": px[0], "y": px[1],
                        "color": color,
                        "msg": f"轮廓像素({px[0]},{px[1]}) 被 {color} 覆盖"
                    })
    return issues

def analyze_svg(filepath):
    """完整分析一个 SVG 文件"""
    with open(filepath) as f:
        content = f.read()

    width, height = get_viewbox(content)
    paths = parse_svg_paths(content)
    grid = build_pixel_grid(paths, width, height)

    all_issues = []
    all_issues.extend(check_palette_compliance(grid))
    all_issues.extend(check_outline_overwrite(paths))
    all_issues.extend(check_interior_holes(grid, width, height))

    # 轮廓完整性（只统计边缘暴露数量，不逐个报告）
    outline_gaps = check_outline_completeness(grid, width, height)
    if outline_gaps:
        # 汇总而非逐个报告
        gap_count = len(outline_gaps)
        all_issues.append({
            "type": "outline_summary",
            "msg": f"轮廓缺口：{gap_count} 个像素暴露在外缺少 #1a1c2c 轮廓"
        })

    return {
        "file": os.path.basename(filepath),
        "size": f"{width}x{height}",
        "colors": len(set(grid.values())),
        "pixels": len(grid),
        "issues": all_issues,
    }

def severity(issue):
    if issue["type"] == "outline_overwrite":
        return "MEDIUM"
    elif issue["type"] == "palette_violation":
        return "WARN"
    elif issue["type"] == "interior_hole":
        return "MEDIUM"
    elif issue["type"] == "outline_summary":
        return "INFO"
    return "INFO"

def main():
    files = []
    new_only = "--new-only" in sys.argv

    for arg in sys.argv[1:]:
        if arg.startswith("-"):
            continue
        if os.path.isdir(arg):
            files.extend(
                os.path.join(arg, f)
                for f in sorted(os.listdir(arg))
                if f.endswith(".svg") and not f.startswith("palette-")
            )
        elif os.path.isfile(arg):
            files.append(arg)

    if not files:
        print(__doc__)
        sys.exit(1)

    total_issues = 0
    critical_files = []

    for filepath in files:
        result = analyze_svg(filepath)

        if new_only and result["size"] != "16x16":
            continue

        issues = result["issues"]
        if not issues:
            print(f"  ✓ {result['file']} — {result['size']}, {result['colors']}色, OK")
        else:
            total_issues += len(issues)
            marker = "✗" if any(severity(i) == "MEDIUM" for i in issues) else "⚠"
            print(f"  {marker} {result['file']} — {result['size']}, {result['colors']}色")
            for issue in issues:
                sev = severity(issue)
                print(f"    [{sev}] {issue['msg']}")
            if any(severity(i) == "MEDIUM" for i in issues):
                critical_files.append(result['file'])

    print(f"\n{'='*50}")
    print(f"检查完成: {len(files)} 个文件, {total_issues} 个问题")
    if critical_files:
        print(f"需要修复: {', '.join(critical_files)}")

if __name__ == "__main__":
    main()

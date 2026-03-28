#!/usr/bin/env python3
"""
批量 PNG → SVG 转换
扫描指定目录下所有 PNG，转换为项目格式 SVG

用法：
  python3 batch_generate.py input_dir/ output_dir/ [--snap]

示例工作流：
  1. 用 AI 生成像素画 PNG（Stable Diffusion / DALL-E / Midjourney）
  2. 放入 input/ 目录
  3. 运行: python3 batch_generate.py input/ assets/ --snap
  4. 运行: python3 quality_check.py assets/ --new-only
"""

import sys
import os

# 添加当前目录到路径
sys.path.insert(0, os.path.dirname(__file__))
from png2svg import png_to_svg

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    input_dir = sys.argv[1]
    output_dir = sys.argv[2]
    snap = "--snap" in sys.argv

    if not os.path.isdir(input_dir):
        print(f"错误: 输入目录不存在: {input_dir}")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    png_files = sorted(f for f in os.listdir(input_dir) if f.lower().endswith(".png"))

    if not png_files:
        print(f"输入目录无 PNG 文件: {input_dir}")
        sys.exit(1)

    print(f"发现 {len(png_files)} 个 PNG 文件")
    print(f"{'启用' if snap else '未启用'}调色板矫正")
    print("=" * 50)

    success = 0
    failed = 0

    for png_file in png_files:
        input_path = os.path.join(input_dir, png_file)
        svg_name = os.path.splitext(png_file)[0] + ".svg"
        output_path = os.path.join(output_dir, svg_name)

        try:
            png_to_svg(input_path, output_path, snap)
            success += 1
        except Exception as e:
            print(f"✗ {png_file}: {e}")
            failed += 1

    print("=" * 50)
    print(f"完成: {success} 成功, {failed} 失败")

if __name__ == "__main__":
    main()

"""智能 512→16 缩放器 — 管线核心算法

将 AI 生成的 512x512 像素画风格图像缩放为真正的 16x16 像素画，
保留轮廓、形状和颜色层次。
"""

import numpy as np
from PIL import Image
from collections import Counter
from .palette import snap_to_palette, is_dark, OUTLINE_COLOR


def remove_background(image):
    """用 rembg 去除背景，返回 RGBA 图像"""
    from rembg import remove
    return remove(image)


def remove_background_simple(image, tolerance=30):
    """简单去背景：检测四角主色，泛洪移除（rembg 失败时的备选）"""
    img = image.convert("RGBA")
    pixels = np.array(img)
    h, w = pixels.shape[:2]

    # 采样四角
    corners = [
        pixels[0, 0, :3], pixels[0, w-1, :3],
        pixels[h-1, 0, :3], pixels[h-1, w-1, :3],
    ]

    # 找最常见角落颜色
    corner_tuples = [tuple(c) for c in corners]
    bg_color = Counter(corner_tuples).most_common(1)[0][0]

    # 将接近背景色的像素设为透明
    bg = np.array(bg_color)
    diff = np.sqrt(np.sum((pixels[:, :, :3].astype(float) - bg.astype(float)) ** 2, axis=2))
    mask = diff < tolerance
    pixels[mask, 3] = 0

    return Image.fromarray(pixels)


def smart_downscale(image, target_size=16, transparency_threshold=0.6, use_rembg=True):
    """智能缩放：512x512 → 16x16

    算法：
    1. 去除背景
    2. 将图像分成 block_size × block_size 的块
    3. 每块判定：透明占比 > threshold → 透明
    4. 非透明块：边缘像素检测 → 深色边缘=轮廓像素
    5. 非轮廓块：加权主色 → snap 到 HARVEST-20

    Args:
        image: PIL Image (RGBA, 任意尺寸)
        target_size: 输出尺寸（默认 16）
        transparency_threshold: 透明判定阈值（默认 0.6）
        use_rembg: 是否用 rembg 去背景（默认 True）

    Returns:
        PIL Image (RGBA, target_size x target_size)
    """
    # Step 0: 去背景
    if use_rembg:
        try:
            img = remove_background(image)
        except Exception:
            img = remove_background_simple(image)
    else:
        img = remove_background_simple(image)

    # 确保尺寸是 target_size 的倍数
    w, h = img.size
    block_w = w // target_size
    block_h = h // target_size

    # 裁剪到精确的倍数尺寸
    crop_w = block_w * target_size
    crop_h = block_h * target_size
    offset_x = (w - crop_w) // 2
    offset_y = (h - crop_h) // 2
    img = img.crop((offset_x, offset_y, offset_x + crop_w, offset_y + crop_h))

    pixels = np.array(img)
    output = np.zeros((target_size, target_size, 4), dtype=np.uint8)

    for ty in range(target_size):
        for tx in range(target_size):
            # 提取块
            y0, y1 = ty * block_h, (ty + 1) * block_h
            x0, x1 = tx * block_w, (tx + 1) * block_w
            block = pixels[y0:y1, x0:x1]

            output[ty, tx] = _analyze_block(block, block_w, block_h, transparency_threshold)

    return Image.fromarray(output, "RGBA")


def _analyze_block(block, block_w, block_h, threshold):
    """分析单个块，返回 (R, G, B, A) 输出像素"""
    # 提取 alpha 通道
    alphas = block[:, :, 3]
    total = block_w * block_h
    transparent_count = np.sum(alphas < 128)

    # Step 1: 透明度判定
    if transparent_count / total > threshold:
        return (0, 0, 0, 0)

    # 提取不透明像素
    opaque_mask = alphas >= 128
    opaque_pixels = block[opaque_mask][:, :3]  # (N, 3)

    if len(opaque_pixels) == 0:
        return (0, 0, 0, 0)

    # Step 2: 边缘深色检测 → 轮廓像素
    edge_pixels = _get_edge_pixels(block, block_w, block_h)
    if len(edge_pixels) > 0:
        dark_count = sum(1 for r, g, b in edge_pixels if is_dark(r, g, b))
        if dark_count / len(edge_pixels) > 0.5:
            # 这个块的边缘大部分是深色 → 轮廓像素
            r, g, b = snap_to_palette(*OUTLINE_COLOR)
            return (r, g, b, 255)

    # Step 3: 加权主色计算
    # 边缘像素 2x 权重（保留轮廓信息）
    weighted_colors = []
    for y in range(block_h):
        for x in range(block_w):
            if block[y, x, 3] < 128:
                continue
            r, g, b = int(block[y, x, 0]), int(block[y, x, 1]), int(block[y, x, 2])
            # 跳过非常深的颜色（轮廓色不参与主色投票）
            if is_dark(r, g, b):
                continue
            weight = 2 if _is_edge_position(x, y, block_w, block_h) else 1
            weighted_colors.extend([(r, g, b)] * weight)

    if not weighted_colors:
        # 全是深色 → 轮廓
        r, g, b = snap_to_palette(*OUTLINE_COLOR)
        return (r, g, b, 255)

    # 计算加权平均色
    colors = np.array(weighted_colors)
    avg_r = int(np.median(colors[:, 0]))
    avg_g = int(np.median(colors[:, 1]))
    avg_b = int(np.median(colors[:, 2]))

    # Snap 到 HARVEST-20
    r, g, b = snap_to_palette(avg_r, avg_g, avg_b)
    return (r, g, b, 255)


def _get_edge_pixels(block, block_w, block_h):
    """提取块最外圈的不透明像素 RGB"""
    edges = []
    for y in range(block_h):
        for x in range(block_w):
            if not _is_edge_position(x, y, block_w, block_h):
                continue
            if block[y, x, 3] >= 128:
                edges.append((int(block[y, x, 0]), int(block[y, x, 1]), int(block[y, x, 2])))
    return edges


def _is_edge_position(x, y, w, h):
    """判断是否在块的最外圈（2px 边缘带）"""
    return x < 2 or x >= w - 2 or y < 2 or y >= h - 2

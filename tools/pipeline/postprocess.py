"""像素画后处理 — 轮廓强制 / 光影矫正 / 魔法微光 / 居中"""

import numpy as np
from PIL import Image
from .palette import OUTLINE_COLOR, snap_to_palette, is_dark, get_lighter, get_darker


def postprocess(image, add_sparkle=True, enforce_outline=True, enforce_center=True):
    """完整后处理管线

    Args:
        image: PIL Image (RGBA, 16x16)
        add_sparkle: 是否添加魔法微光（默认 True）
        enforce_outline: 是否强制轮廓（默认 True）
        enforce_center: 是否强制居中+呼吸空间（默认 True）

    Returns:
        PIL Image (RGBA, 16x16)
    """
    pixels = np.array(image)
    h, w = pixels.shape[:2]

    if enforce_center:
        pixels = _enforce_centering(pixels, w, h)

    if enforce_outline:
        pixels = _enforce_outline(pixels, w, h)

    pixels = _enforce_lighting(pixels, w, h)

    if add_sparkle:
        pixels = _add_sparkle(pixels, w, h)

    return Image.fromarray(pixels, "RGBA")


def _enforce_outline(pixels, w, h):
    """所有暴露在外（邻接透明/画布边）的非轮廓像素 → 设为轮廓色"""
    result = pixels.copy()

    for y in range(h):
        for x in range(w):
            if result[y, x, 3] < 128:
                continue

            r, g, b = int(result[y, x, 0]), int(result[y, x, 1]), int(result[y, x, 2])
            if (r, g, b) == OUTLINE_COLOR:
                continue

            # 检查是否暴露在外
            exposed = False
            for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                ny, nx = y + dy, x + dx
                if ny < 0 or ny >= h or nx < 0 or nx >= w:
                    exposed = True
                    break
                if result[ny, nx, 3] < 128:
                    exposed = True
                    break

            if exposed:
                result[y, x] = [OUTLINE_COLOR[0], OUTLINE_COLOR[1], OUTLINE_COLOR[2], 255]

    return result


def _enforce_lighting(pixels, w, h):
    """基于位置微调光影：左上偏亮，右下偏暗"""
    result = pixels.copy()

    # 找到物品的 bounding box
    opaque = np.where(result[:, :, 3] >= 128)
    if len(opaque[0]) == 0:
        return result

    min_y, max_y = opaque[0].min(), opaque[0].max()
    min_x, max_x = opaque[1].min(), opaque[1].max()
    center_y = (min_y + max_y) / 2
    center_x = (min_x + max_x) / 2

    for y in range(h):
        for x in range(w):
            if result[y, x, 3] < 128:
                continue

            r, g, b = int(result[y, x, 0]), int(result[y, x, 1]), int(result[y, x, 2])
            if (r, g, b) == OUTLINE_COLOR:
                continue

            # 计算相对位置（-1=左上, +1=右下）
            rel_x = (x - center_x) / max(1, (max_x - min_x) / 2)
            rel_y = (y - center_y) / max(1, (max_y - min_y) / 2)
            position_score = (rel_x + rel_y) / 2  # -1=左上角, +1=右下角

            snapped = snap_to_palette(r, g, b)

            if position_score < -0.6:
                # 左上 → 尝试变亮
                lighter = get_lighter(*snapped)
                if lighter:
                    result[y, x] = [lighter[0], lighter[1], lighter[2], 255]
            elif position_score > 0.6:
                # 右下 → 尝试变暗
                darker = get_darker(*snapped)
                if darker:
                    result[y, x] = [darker[0], darker[1], darker[2], 255]

    return result


def _add_sparkle(pixels, w, h):
    """在物品左上区域添加 1px 魔法微光"""
    result = pixels.copy()

    # 找到非轮廓、非透明的最左上像素
    for y in range(h):
        for x in range(w):
            if result[y, x, 3] < 128:
                continue
            r, g, b = int(result[y, x, 0]), int(result[y, x, 1]), int(result[y, x, 2])
            if (r, g, b) == OUTLINE_COLOR:
                continue
            # 检查不是已经是白色
            if r > 240 and g > 240 and b > 240:
                return result  # 已有微光
            # 设置微光
            result[y, x] = [0xf4, 0xf4, 0xf4, 255]
            return result

    return result


def _enforce_centering(pixels, w, h):
    """确保物品居中，四边至少 1px 呼吸空间"""
    opaque = np.where(pixels[:, :, 3] >= 128)
    if len(opaque[0]) == 0:
        return pixels

    min_y, max_y = int(opaque[0].min()), int(opaque[0].max())
    min_x, max_x = int(opaque[1].min()), int(opaque[1].max())

    # 检查是否需要偏移
    item_h = max_y - min_y + 1
    item_w = max_x - min_x + 1

    # 如果物品太大（>14px），无法保证 1px 呼吸空间，跳过
    if item_h > h - 2 or item_w > w - 2:
        return pixels

    # 计算理想偏移（居中）
    ideal_y = (h - item_h) // 2
    ideal_x = (w - item_w) // 2
    shift_y = ideal_y - min_y
    shift_x = ideal_x - min_x

    if shift_y == 0 and shift_x == 0:
        return pixels

    # 创建新画布并偏移
    result = np.zeros_like(pixels)
    for y in range(h):
        for x in range(w):
            if pixels[y, x, 3] < 128:
                continue
            ny, nx = y + shift_y, x + shift_x
            if 0 <= ny < h and 0 <= nx < w:
                result[ny, nx] = pixels[y, x]

    return result

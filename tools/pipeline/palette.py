"""HARVEST-20 调色板定义和颜色工具函数"""

import math

# HARVEST-20 调色板 (RGB 元组)
HARVEST_20 = {
    "墨黑":   (0x1a, 0x1c, 0x2c),
    "梅紫":   (0x5d, 0x27, 0x5d),
    "玫瑰":   (0xb1, 0x3e, 0x53),
    "橘色":   (0xef, 0x7d, 0x57),
    "金黄":   (0xff, 0xcd, 0x75),
    "嫩芽":   (0xa7, 0xf0, 0x70),
    "三叶草": (0x38, 0xb7, 0x64),
    "青色":   (0x25, 0x71, 0x79),
    "深海":   (0x29, 0x36, 0x6f),
    "海洋":   (0x3b, 0x5d, 0xc9),
    "天空":   (0x41, 0xa6, 0xf6),
    "冰蓝":   (0x73, 0xef, 0xf7),
    "雪白":   (0xf4, 0xf4, 0xf4),
    "雾灰":   (0x94, 0xb0, 0xc2),
    "石板":   (0x56, 0x6c, 0x86),
    "夜蓝":   (0x33, 0x3c, 0x57),
    "树皮":   (0x6b, 0x3e, 0x2e),
    "木纹":   (0xa8, 0x77, 0x5e),
    "麦穗":   (0xd4, 0xa5, 0x6a),
    "松针":   (0x4a, 0x5e, 0x3b),
}

HARVEST_20_LIST = list(HARVEST_20.values())
HARVEST_20_HEXES = {rgb_to_hex(*v) for v in HARVEST_20.values()} if False else set()

OUTLINE_COLOR = (0x1a, 0x1c, 0x2c)
OUTLINE_HEX = "#1a1c2c"

# 光影梯度链（亮→暗）
GRADIENT_CHAINS = [
    [(0xf4, 0xf4, 0xf4), (0x94, 0xb0, 0xc2), (0x56, 0x6c, 0x86), (0x33, 0x3c, 0x57)],  # 灰
    [(0xa7, 0xf0, 0x70), (0x38, 0xb7, 0x64), (0x4a, 0x5e, 0x3b)],  # 绿
    [(0xd4, 0xa5, 0x6a), (0xa8, 0x77, 0x5e), (0x6b, 0x3e, 0x2e)],  # 棕
    [(0x73, 0xef, 0xf7), (0x41, 0xa6, 0xf6), (0x3b, 0x5d, 0xc9), (0x29, 0x36, 0x6f)],  # 蓝
    [(0xff, 0xcd, 0x75), (0xef, 0x7d, 0x57), (0xb1, 0x3e, 0x53), (0x5d, 0x27, 0x5d)],  # 暖
]


def rgb_to_hex(r, g, b):
    return f"#{r:02x}{g:02x}{b:02x}"


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


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
    for pr, pg, pb in HARVEST_20_LIST:
        d = color_distance((r, g, b), (pr, pg, pb))
        if d < best_dist:
            best_dist = d
            best = (pr, pg, pb)
    return best


def is_dark(r, g, b, threshold=80):
    """判断颜色是否为深色（用于轮廓检测）"""
    luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return luminance < threshold


def get_lighter(r, g, b):
    """在梯度链中找到更亮的颜色"""
    for chain in GRADIENT_CHAINS:
        for i, c in enumerate(chain):
            if c == (r, g, b) and i > 0:
                return chain[i - 1]
    return None


def get_darker(r, g, b):
    """在梯度链中找到更暗的颜色"""
    for chain in GRADIENT_CHAINS:
        for i, c in enumerate(chain):
            if c == (r, g, b) and i < len(chain) - 1:
                return chain[i + 1]
    return None


# 初始化 hex 集合
HARVEST_20_HEXES = {rgb_to_hex(*v) for v in HARVEST_20.values()}

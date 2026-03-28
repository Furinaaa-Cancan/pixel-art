"""AI 像素画生成器 — 本地 SDXL + Replicate 双后端"""

import os
import io
import torch
from PIL import Image

# 延迟导入避免无 GPU 环境报错
_pipe = None


def _get_local_pipe():
    """延迟加载本地 SDXL 管线（首次调用下载 ~6GB 模型）"""
    global _pipe
    if _pipe is not None:
        return _pipe

    from diffusers import StableDiffusionXLPipeline

    print("加载 pixel-art-xl 模型（首次需下载 ~6GB）...")
    _pipe = StableDiffusionXLPipeline.from_pretrained(
        "nerijs/pixel-art-xl",
        torch_dtype=torch.float16,
        variant="fp16",
    )
    _pipe.to("mps")
    # 降低显存峰值
    _pipe.enable_attention_slicing()
    print("模型加载完成。")
    return _pipe


PROMPT_TEMPLATE = (
    "pixel art, {item}, 16x16 sprite, game item icon, single item centered, "
    "transparent background, clean pixel edges, limited color palette, "
    "stardew valley style, cozy warm colors, top-left lighting, dark outline, "
    "no text, no watermark, no frame"
)

NEGATIVE_PROMPT = (
    "blurry, anti-aliased, gradient, photorealistic, 3d render, text, watermark, "
    "multiple items, busy background, smooth edges, noise, high detail, "
    "border, frame, ui elements"
)


def generate_local(item_name, description=None, seed=None, size=512, steps=30):
    """用本地 pixel-art-xl 模型生成像素画

    Args:
        item_name: 物品名（英文）
        description: 额外描述（可选）
        seed: 随机种子（可选，用于可复现性）
        size: 生成尺寸（默认 512）
        steps: 推理步数（默认 30）

    Returns:
        PIL.Image (RGBA, size x size)
    """
    pipe = _get_local_pipe()

    item_desc = description or item_name
    prompt = PROMPT_TEMPLATE.format(item=item_desc)

    generator = None
    if seed is not None:
        generator = torch.Generator("mps").manual_seed(seed)

    result = pipe(
        prompt=prompt,
        negative_prompt=NEGATIVE_PROMPT,
        width=size,
        height=size,
        num_inference_steps=steps,
        guidance_scale=7.5,
        generator=generator,
    )

    image = result.images[0]
    return image.convert("RGBA")


def generate_replicate(item_name, description=None, seed=None, size=512):
    """用 Replicate API 生成像素画（需要 REPLICATE_API_TOKEN 环境变量）

    Returns:
        PIL.Image (RGBA, size x size)
    """
    import replicate
    import requests

    item_desc = description or item_name
    prompt = PROMPT_TEMPLATE.format(item=item_desc)

    input_params = {
        "prompt": prompt,
        "negative_prompt": NEGATIVE_PROMPT,
        "width": size,
        "height": size,
        "num_inference_steps": 30,
    }
    if seed is not None:
        input_params["seed"] = seed

    output = replicate.run(
        "nerijs/pixel-art-xl:5c28a9d2d8dfe181a2055baf29537091c0bea2ae7e4e3c6a360c8a51b792e030",
        input=input_params,
    )

    # output 是 URL 列表
    url = output[0] if isinstance(output, list) else str(output)
    response = requests.get(url)
    image = Image.open(io.BytesIO(response.content))
    return image.convert("RGBA")


def generate(item_name, description=None, seed=None, backend="local", size=512):
    """统一生成入口"""
    if backend == "local":
        return generate_local(item_name, description, seed, size)
    elif backend == "replicate":
        return generate_replicate(item_name, description, seed, size)
    else:
        raise ValueError(f"未知后端: {backend}")

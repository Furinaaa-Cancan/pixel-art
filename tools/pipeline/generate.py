"""AI 像素画生成器 — 本地 SDXL + LoRA"""

import os
import io
import torch
from PIL import Image

_pipe = None


def _get_local_pipe():
    """加载 SDXL base + pixel-art-xl LoRA"""
    global _pipe
    if _pipe is not None:
        return _pipe

    from diffusers import DiffusionPipeline

    print("加载 SDXL base 模型（首次需下载 ~6.5GB）...")
    _pipe = DiffusionPipeline.from_pretrained(
        "stabilityai/stable-diffusion-xl-base-1.0",
        torch_dtype=torch.float16,
        variant="fp16",
    )

    print("加载 pixel-art-xl LoRA 权重...")
    _pipe.load_lora_weights(
        "nerijs/pixel-art-xl",
        weight_name="pixel-art-xl.safetensors",
        adapter_name="pixel",
    )
    _pipe.set_adapters(["pixel"], adapter_weights=[1.2])

    _pipe.to("mps")
    _pipe.enable_attention_slicing()
    print("模型加载完成。")
    return _pipe


PROMPT_TEMPLATE = (
    "pixel art, {item}, game item icon, single item centered, "
    "clean pixel edges, limited color palette, warm cozy colors, "
    "top-left lighting, dark outline"
)

NEGATIVE_PROMPT = (
    "blurry, anti-aliased, gradient, photorealistic, 3d render, text, watermark, "
    "multiple items, busy background, smooth edges, noise, frame, border"
)


def generate_local(item_name, description=None, seed=None, size=512, steps=30):
    """用本地 SDXL + pixel-art-xl LoRA 生成像素画

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

    # 按 LoRA 作者建议：缩小 8 倍得到像素完美的图
    # 512 / 8 = 64, 这是中间态，后续再缩到 16
    pixel_size = size // 8
    pixel_img = image.resize((pixel_size, pixel_size), Image.NEAREST)

    return pixel_img.convert("RGBA")


def generate_replicate(item_name, description=None, seed=None, size=512):
    """用 Replicate API 生成（备选）"""
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

    url = output[0] if isinstance(output, list) else str(output)
    response = requests.get(url)
    image = Image.open(io.BytesIO(response.content))

    # 缩小 8 倍
    pixel_size = size // 8
    pixel_img = image.resize((pixel_size, pixel_size), Image.NEAREST)

    return pixel_img.convert("RGBA")


def generate(item_name, description=None, seed=None, backend="local", size=512):
    """统一入口"""
    if backend == "local":
        return generate_local(item_name, description, seed, size)
    elif backend == "replicate":
        return generate_replicate(item_name, description, seed, size)
    else:
        raise ValueError(f"未知后端: {backend}")

from PIL import Image
import cairosvg
import io

# 输入输出
svg_path = "input.svg"
output_path = "output.png"

# 缩放比例（85%）
scale = 0.85

# SVG -> PNG
png_data = cairosvg.svg2png(url=svg_path)

# 读取图像
img = Image.open(io.BytesIO(png_data)).convert("RGBA")

# 原始尺寸
w, h = img.size

# 缩小后的尺寸
new_w = int(w * scale)
new_h = int(h * scale)

# 高质量缩放
small_img = img.resize((new_w, new_h), Image.LANCZOS)

# 创建白底画布（保持原尺寸）
background = Image.new("RGB", (w, h), "white")

# 居中
x = (w - new_w) // 2
y = (h - new_h) // 2

# 粘贴
background.paste(small_img, (x, y), small_img)

# 保存
background.save(output_path)

print(f"Saved to {output_path}")
from PIL import Image, ImageDraw

size = 1024
white = (255, 255, 255, 255)
image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=230, fill=(59, 91, 219, 255))
draw.ellipse((232, 232, 792, 792), outline=white, width=52)
draw.line((512, 512, 512, 340), fill=white, width=52)
draw.line((512, 512, 640, 586), fill=white, width=52)
image.save("app-icon.png")

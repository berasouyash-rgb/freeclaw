import os
from PIL import Image

day_path = r"C:\Users\lenovo\.gemini\antigravity-cli\brain\3f34cc2c-53ab-4f28-9721-222ae031406f\.user_uploaded\uploaded_media_0_1794321278686.jpg"
night_path = r"C:\Users\lenovo\.gemini\antigravity-cli\brain\3f34cc2c-53ab-4f28-9721-222ae031406f\.user_uploaded\uploaded_media_1_1794321278686.jpg"

out_dir = r"C:\Users\lenovo\freeclaw\freeclaw\freeclaw\voice-box\public\campus"
os.makedirs(out_dir, exist_ok=True)

im_day = Image.open(day_path)
im_night = Image.open(night_path)
w, h = im_day.size

# Let's inspect where the button is. In im_day, the Start Now button is vibrant blue: rgb around (30..80, 100..160, 240..255)
button_bottom = 0
for y in range(300, 420):
    for x in range(w // 2 - 100, w // 2 + 100):
        r, g, b = im_day.getpixel((x, y))
        if b > 200 and r < 80: # blue button
            if y > button_bottom:
                button_bottom = y

print(f"Blue button bottom: {button_bottom}")

# Let's inspect where 'SOUYASH BERA' starts around y=700..850
text_top = h
for y in range(650, 800):
    for x in range(100, 500):
        r, g, b = im_day.getpixel((x, y))
        # Text is black/dark blue in day mode
        if r < 40 and g < 40 and b < 80:
            if y < text_top:
                text_top = y
                break

print(f"Bottom text top: {text_top}")

# Campus scenery sits between button_bottom + 10 and text_top - 5
y_start = max(button_bottom + 10, 360)
y_end = min(text_top - 10, 750)
print(f"Cropping from y={y_start} to y={y_end} (height={y_end - y_start})")

crop_box = (0, y_start, w, y_end)
cropped_day = im_day.crop(crop_box)
cropped_night = im_night.crop(crop_box)

cropped_day.save(os.path.join(out_dir, "campus-day.webp"), "WEBP", quality=85)
cropped_night.save(os.path.join(out_dir, "campus-night.webp"), "WEBP", quality=85)
cropped_day.save(os.path.join(out_dir, "campus-day.jpg"), "JPEG", quality=85)
cropped_night.save(os.path.join(out_dir, "campus-night.jpg"), "JPEG", quality=85)

print("Saved clean campus scenery:", cropped_day.size)

"""Generate all app icon PNGs from the Contop SVG icon."""
import os
import sys

import struct

try:
    import cairosvg
    from PIL import Image
    from io import BytesIO
except ImportError:
    print("Install deps: python -m pip install cairosvg pillow")
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Icon geometry - square composition (300x300 centered in 512x512, ~18% padding):
#   Phone height (300) = total base width (300)
#   Phone:   x=106, y=106, w=150, h=300, rx=14  (1:2 ratio, behind)
#   Desktop: x=166, y=256, w=240, h=150, rx=12  (16:10 ratio, foreground)
#   Chevron: 226,298 → 270,331 → 226,364
#   Underscore: 288,364 → 356,364
#   Bounding box: (106,106) to (406,406) = 300x300, centered in 512x512

STROKE_COLOR = "#095BB9"  # Space Blue (UX spec accent)
BG_COLOR = "#000000"      # Pure black

# Shapes with opaque fill (desktop covers phone), thicker strokes for small-size clarity
ICON_SHAPES = f'''
    <rect x="106" y="106" width="150" height="300" rx="14"
          stroke="{STROKE_COLOR}" stroke-width="36" fill="{BG_COLOR}"/>
    <rect x="166" y="256" width="240" height="150" rx="12"
          stroke="{STROKE_COLOR}" stroke-width="36" fill="{BG_COLOR}"/>
    <polyline points="226,298 270,331 226,364"
              stroke="{STROKE_COLOR}" stroke-width="28"
              stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <line x1="288" y1="364" x2="356" y2="364"
          stroke="{STROKE_COLOR}" stroke-width="28" stroke-linecap="round"/>
'''

# App icon: black bg with rounded corners, icon already has built-in padding
APP_ICON_SVG = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <rect width="512" height="512" rx="80" fill="{BG_COLOR}"/>
  {ICON_SHAPES}
</svg>'''

# Mobile app icon: square corners (OS applies its own mask) and content scaled to
# ~75% to add breathing room that compensates for iOS superellipse / Android legacy
# masking.  Without this the icon looks "zoomed in" compared to the README version.
MOBILE_ICON_SVG = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <rect width="512" height="512" fill="{BG_COLOR}"/>
  <g transform="translate(256,256) scale(0.75) translate(-256,-256)">
    {ICON_SHAPES}
  </g>
</svg>'''

# Android adaptive foreground: scaled to 58% so content fills ~57% of the visible
# area after the launcher mask crops to the inner 66.7% of the 108dp canvas.
# Previous 70% scale made content fill ~69% of visible area - too tight.
ADAPTIVE_FG_SVG = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <g transform="translate(256,256) scale(0.58) translate(-256,-256)">
    {ICON_SHAPES}
  </g>
</svg>'''

# Splash logo: same shapes on black
SPLASH_SVG = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  {ICON_SHAPES}
</svg>'''


def svg_to_png(svg_str: str, size: int) -> Image.Image:
    png_bytes = cairosvg.svg2png(bytestring=svg_str.encode(), output_width=size, output_height=size)
    return Image.open(BytesIO(png_bytes)).convert("RGBA")


def save(img: Image.Image, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG")
    print(f"  {path}")


def save_ico(images: list[Image.Image], path: str):
    """Write an ICO file preserving the exact order of images.

    Pillow's ICO plugin sorts entries largest-first, which causes Tauri's
    codegen to pick the 256px entry (entries()[0]) and downscale it for the
    taskbar - producing a blurry icon.  This writer puts entries in the
    order given so we can place 32x32 first.
    See https://github.com/tauri-apps/tauri/issues/14596
    """
    count = len(images)
    header = struct.pack("<HHH", 0, 1, count)  # reserved, type=ICO, count

    # Serialize each image as PNG
    png_blobs = []
    for img in images:
        buf = BytesIO()
        img.save(buf, format="PNG")
        png_blobs.append(buf.getvalue())

    # Directory starts right after header (6 bytes)
    # Each directory entry is 16 bytes
    data_offset = 6 + count * 16

    directory = b""
    for img, blob in zip(images, png_blobs):
        w = img.width if img.width < 256 else 0   # 0 means 256 in ICO spec
        h = img.height if img.height < 256 else 0
        entry = struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(blob), data_offset)
        directory += entry
        data_offset += len(blob)

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(header)
        f.write(directory)
        for blob in png_blobs:
            f.write(blob)


def main():
    print("Generating Contop icons...\n")

    # --- 1. Desktop (Tauri) icons ---
    tauri_icons = os.path.join(ROOT, "contop-desktop", "src-tauri", "icons")
    master = svg_to_png(APP_ICON_SVG, 1024)

    desktop_sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }

    print("[Desktop - Tauri]")
    for name, size in desktop_sizes.items():
        # Render directly from SVG for crisp results at every size
        resized = svg_to_png(APP_ICON_SVG, size)
        save(resized, os.path.join(tauri_icons, name))

    # ICO (Windows) - 32x32 MUST be the first entry.
    # Tauri's codegen reads only entries()[0] for the runtime window/taskbar icon
    # (see https://github.com/tauri-apps/tauri/issues/14596).
    # Pillow sorts entries largest-first which puts 256px first → blurry taskbar.
    # We use a custom writer that preserves our ordering.
    ico_sizes = [32, 16, 20, 24, 40, 48, 64, 128, 256]
    ico_images = [svg_to_png(APP_ICON_SVG, s) for s in ico_sizes]
    ico_path = os.path.join(tauri_icons, "icon.ico")
    save_ico(ico_images, ico_path)
    print(f"  {ico_path}")

    # ICNS (macOS) - Pillow supports it
    try:
        icns_path = os.path.join(tauri_icons, "icon.icns")
        master.save(icns_path, format="ICNS")
        print(f"  {icns_path}")
    except Exception as e:
        print(f"  (Skipped icon.icns - {e})")

    # --- 2. Mobile source assets (used by expo prebuild) ---
    print("\n[Mobile - Source assets for Expo]")
    mobile_assets = os.path.join(ROOT, "contop-mobile", "assets", "images")
    mobile_master = svg_to_png(MOBILE_ICON_SVG, 1024)
    save(mobile_master, os.path.join(mobile_assets, "icon.png"))
    fg = svg_to_png(ADAPTIVE_FG_SVG, 432)
    save(fg, os.path.join(mobile_assets, "adaptive-icon-foreground.png"))
    splash = svg_to_png(SPLASH_SVG, 512)
    save(splash, os.path.join(mobile_assets, "splash-logo.png"))

    # --- 3. Android native icons (mipmap webp + splash PNGs) ---
    print("\n[Mobile - Android native icons]")
    android_res = os.path.join(ROOT, "contop-mobile", "android", "app", "src", "main", "res")

    # Launcher icons (ic_launcher + ic_launcher_round)
    launcher_sizes = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for density, size in launcher_sizes.items():
        resized = mobile_master.resize((size, size), Image.LANCZOS)
        for name in ("ic_launcher.webp", "ic_launcher_round.webp"):
            out = os.path.join(android_res, f"mipmap-{density}", name)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            resized.save(out, "WEBP", quality=90)
            print(f"  {out}")

    # Adaptive foreground icons
    fg_sizes = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
    for density, size in fg_sizes.items():
        fg_resized = svg_to_png(ADAPTIVE_FG_SVG, size)
        out = os.path.join(android_res, f"mipmap-{density}", "ic_launcher_foreground.webp")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        fg_resized.save(out, "WEBP", quality=90)
        print(f"  {out}")

    # Splash screen PNGs
    splash_sizes = {"mdpi": 288, "hdpi": 432, "xhdpi": 576, "xxhdpi": 864, "xxxhdpi": 1152}
    for density, size in splash_sizes.items():
        splash_img = svg_to_png(SPLASH_SVG, size)
        save(splash_img, os.path.join(android_res, f"drawable-{density}", "splashscreen_logo.png"))

    # --- 4. iOS native icons ---
    print("\n[Mobile - iOS native icons]")
    ios_assets = os.path.join(ROOT, "contop-mobile", "ios", "contopmobile", "Images.xcassets")
    save(mobile_master,
         os.path.join(ios_assets, "AppIcon.appiconset", "AppIcon.png"))
    save(svg_to_png(SPLASH_SVG, 512),
         os.path.join(ios_assets, "SplashScreenLegacy.imageset", "SplashScreenLegacy.png"))

    # --- 5. Root project icon (for README) ---
    print("\n[Root]")
    save(master.resize((256, 256), Image.LANCZOS), os.path.join(ROOT, "contop-icon.png"))

    print("\nDone! All icons generated.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import os
import json

# 1. Locate the 'images/gallery' folder (adjust if your structure differs)
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))      # .../scripts
GALLERY_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', 'images', 'gallery'))

# 2. Collect category folders automatically
categories = [
    d for d in os.listdir(GALLERY_DIR)
    if os.path.isdir(os.path.join(GALLERY_DIR, d))
]

manifest = {}
for cat in sorted(categories):
    cat_dir = os.path.join(GALLERY_DIR, cat)
    # Only image files
    files = sorted(f for f in os.listdir(cat_dir)
                   if f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.mp4', '.webm', '.ogg')))
    manifest[cat] = files

# 3. Write manifest.json alongside the folders
out_path = os.path.join(GALLERY_DIR, 'manifest.json')
with open(out_path, 'w', encoding='utf-8') as fp:
    json.dump(manifest, fp, indent=2)

print(f'✔ Gallery manifest written to {out_path}')

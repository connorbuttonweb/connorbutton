import tkinter as tk
from tkinter import messagebox, filedialog
import random
import json
import os
import sys
import subprocess

# Try to enable rich image previews with Pillow (recommended)
try:
    from PIL import Image, ImageTk  # type: ignore
    HAS_PIL = True
except Exception:
    HAS_PIL = False

SAVE_FILE = "dnd_save.json"

root = tk.Tk()
root.title("D&D Toolkit")
root.geometry("500x850")

# ---------------------- Time & Survival ----------------------
# Total days since campaign start (sleep increments this)
total_days = 0

# Survival reset windows
FOOD_RESET = 7
WATER_RESET = 3

# Current countdowns
food_days_left = FOOD_RESET
water_days_left = WATER_RESET

# Forward-declare UI refs so linting is happy
time_frame = None
campaign_lbl = None
food_lbl = None
water_lbl = None

def _split_ymd(days: int):
    years = days // 360
    rem = days % 360
    months = rem // 30
    d = rem % 30
    return years, months, d

def _update_time_labels():
    if (time_frame is None or
        campaign_lbl is None or
        food_lbl is None or
        water_lbl is None):
        return
    y, m, d = _split_ymd(total_days)
    campaign_lbl.config(text=f"Campaign Time: {y}y {m}m {d}d  (Total: {total_days} days)")
    food_lbl.config(text=f"Food: {food_days_left} day(s) remaining")
    water_lbl.config(text=f"Water: {water_days_left} day(s) remaining")

def _check_starvation_dehydration():
    msgs = []
    if food_days_left <= 0:
        msgs.append("⚠️ You are STARVING (food counter reached 0).")
    if water_days_left <= 0:
        msgs.append("⚠️ You are DEHYDRATED (water counter reached 0).")
    if msgs:
        messagebox.showwarning("Survival Warning", "\n".join(msgs))

def sleep_next_day():
    global total_days, food_days_left, water_days_left
    total_days += 1
    food_days_left -= 1
    water_days_left -= 1
    _update_time_labels()
    _check_starvation_dehydration()

def eat_food():
    global food_days_left
    food_days_left = FOOD_RESET
    _update_time_labels()
    messagebox.showinfo("Eat", f"You eat a meal. Food counter reset to {FOOD_RESET} days.")

def drink_water():
    global water_days_left
    water_days_left = WATER_RESET
    _update_time_labels()
    messagebox.showinfo("Drink", f"You drink water. Water counter reset to {WATER_RESET} days.")
# ---------------------- Dice Roller Logic ----------------------
def roll_dice(sides, rolls=1, adv=False, disadv=False):
    results = [random.randint(1, sides) for _ in range(rolls)]
    if adv:
        result = max(random.randint(1, sides), random.randint(1, sides))
        output_label.config(text=f"Advantage roll (D{sides}): {result}")
        return
    elif disadv:
        result = min(random.randint(1, sides), random.randint(1, sides))
        output_label.config(text=f"Disadvantage roll (D{sides}): {result}")
        return

    if rolls == 1:
        output_label.config(text=f"You rolled a {results[0]} on a D{sides}!")
    else:
        output_label.config(text=f"Rolls: {results}  |  Total = {sum(results)}")

# Initialize the labels with current state
_update_time_labels()

# ---------------------- Inventory Window ----------------------
inventory_items = []  # now stores dicts: {"name": str, "qty": int}
inventory_win = None

def open_inventory():
    global inventory_win
    if inventory_win is not None and tk.Toplevel.winfo_exists(inventory_win):
        inventory_win.deiconify()
        inventory_win.lift()
        return

    inventory_win = tk.Toplevel(root)
    inventory_win.title("Inventory")
    inventory_win.geometry("360x420")

    add_frame = tk.Frame(inventory_win)
    add_frame.pack(fill="x", padx=10, pady=(10, 6))

    tk.Label(add_frame, text="Add:").pack(side="left")
    add_entry = tk.Entry(add_frame)
    add_entry.pack(side="left", fill="x", expand=True, padx=6)

    def add_item(event=None):
        text = add_entry.get().strip()
        if not text:
            return
        # check if item already exists -> increment qty
        for it in inventory_items:
            if it["name"].lower() == text.lower():
                it["qty"] += 1
                break
        else:
            inventory_items.append({"name": text, "qty": 1})
        add_entry.delete(0, "end")
        refresh_items()

    add_btn = tk.Button(add_frame, text="Add", command=add_item)
    add_btn.pack(side="left")
    add_entry.bind("<Return>", add_item)

    list_container = tk.Frame(inventory_win)
    list_container.pack(fill="both", expand=True, padx=10, pady=6)

    canvas = tk.Canvas(list_container, highlightthickness=0)
    scrollbar = tk.Scrollbar(list_container, orient="vertical", command=canvas.yview)
    items_frame = tk.Frame(canvas)

    items_frame.bind(
        "<Configure>",
        lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
    )
    canvas.create_window((0, 0), window=items_frame, anchor="nw")
    canvas.configure(yscrollcommand=scrollbar.set)

    canvas.pack(side="left", fill="both", expand=True)
    scrollbar.pack(side="right", fill="y")

    controls = tk.Frame(inventory_win)
    controls.pack(fill="x", padx=10, pady=(0, 10))

    def clear_all():
        if not inventory_items:
            return
        if messagebox.askyesno("Clear Inventory", "Remove all items?"):
            inventory_items.clear()
            refresh_items()

    tk.Button(controls, text="Clear All", command=clear_all).pack(side="right")

    def delete_item(idx):
        if 0 <= idx < len(inventory_items):
            del inventory_items[idx]
            refresh_items()

    def change_qty(idx, delta):
        if 0 <= idx < len(inventory_items):
            inventory_items[idx]["qty"] += delta
            if inventory_items[idx]["qty"] <= 0:
                del inventory_items[idx]
            refresh_items()

    def refresh_items():
        for w in items_frame.winfo_children():
            w.destroy()
        for i, item in enumerate(inventory_items):
            row = tk.Frame(items_frame, pady=4)
            row.pack(fill="x")

            name = tk.Label(row, text=f"{item['name']} (x{item['qty']})", anchor="w")
            name.pack(side="left", fill="x", expand=True)

            tk.Button(row, text="-", width=2, command=lambda ix=i: change_qty(ix, -1)).pack(side="right")
            tk.Button(row, text="+", width=2, command=lambda ix=i: change_qty(ix, +1)).pack(side="right")
            tk.Button(row, text="❌", width=2, command=lambda ix=i: delete_item(ix)).pack(side="right")

    inventory_win.refresh_items = refresh_items
    inventory_win.add_item = add_item

    refresh_items()
def refresh_items():
    if inventory_win is not None and tk.Toplevel.winfo_exists(inventory_win):
        inventory_win.refresh_items()

# ---- Level helpers (display + buttons) ----
level_value = None  # StringVar created when UI builds

def _refresh_level_label():
    if level_value is not None:
        level_value.set(f"Level: {int(character_stats.get('Level', 1))}")

def _change_level(delta: int):
    character_stats["Level"] = max(1, int(character_stats.get("Level", 1)) + delta)
    _refresh_level_label()

# ---------------------- Character Stats ----------------------
character_stats = {
    "HP": 10,
    "Mana": 10,
    "Strength": 10,
    "Dexterity": 10,
    "Constitution": 10,
    "Intelligence": 10,
    "Wisdom": 10,
    "Charisma": 10,
    " ":0,
    "Armor": 10,
    "Attack": 10,
    "Weight (14<)": 10
}

stats_win = None

def open_stats():
    global stats_win
    if stats_win is not None and tk.Toplevel.winfo_exists(stats_win):
        stats_win.deiconify()
        stats_win.lift()
        return

    stats_win = tk.Toplevel(root)
    stats_win.title("Character Stats")
    stats_win.geometry("300x400")

    def update_stat(stat, delta):
        character_stats[stat] += delta
        refresh_stats()

    def refresh_stats():
        for widget in stats_win.winfo_children():
            widget.destroy()
        for stat, value in character_stats.items():
            row = tk.Frame(stats_win, pady=4)
            row.pack(fill="x")
            tk.Label(row, text=f"{stat}: {value}").pack(side="left")
            tk.Button(row, text="+", command=lambda s=stat: update_stat(s, 1), width=2).pack(side="right")
            tk.Button(row, text="-", command=lambda s=stat: update_stat(s, -1), width=2).pack(side="right")

    refresh_stats()

# ---------------------- Time & Survival ----------------------
# Total days since campaign start (sleep increments this)
total_days = 0

# Simple survival counters: eat every 7 days, drink every 3 days
FOOD_RESET = 7
WATER_RESET = 3
food_days_left = FOOD_RESET
water_days_left = WATER_RESET

time_frame = None  # will hold the UI frame with labels/buttons

def _split_ymd(days: int):
    # 30-day months for simplicity
    years = days // 360
    rem = days % 360
    months = rem // 30
    d = rem % 30
    return years, months, d

def _update_time_labels():
    if time_frame is None:
        return
    y, m, d = _split_ymd(total_days)
    campaign_lbl.config(text=f"Campaign Time: {y}y {m}m {d}d  (Total: {total_days} days)")
    food_lbl.config(text=f"Food: {food_days_left} day(s) remaining")
    water_lbl.config(text=f"Water: {water_days_left} day(s) remaining")

def _check_starvation_dehydration():
    warnings = []
    if food_days_left <= 0:
        warnings.append("⚠️ You are STARVING (food counter reached 0).")
    if water_days_left <= 0:
        warnings.append("⚠️ You are DEHYDRATED (water counter reached 0).")
    if warnings:
        messagebox.showwarning("Survival Warning", "\n".join(warnings))

def sleep_next_day():
    global total_days, food_days_left, water_days_left
    total_days += 1
    food_days_left -= 1
    water_days_left -= 1
    _update_time_labels()
    _check_starvation_dehydration()

def eat_food():
    global food_days_left
    food_days_left = FOOD_RESET
    _update_time_labels()
    messagebox.showinfo("Eat", f"You eat a meal. Food counter reset to {FOOD_RESET} days.")

def drink_water():
    global water_days_left
    water_days_left = WATER_RESET
    _update_time_labels()
    messagebox.showinfo("Drink", f"You drink water. Water counter reset to {WATER_RESET} days.")

# ---------------------- Currency Tracker ----------------------
currency = {"Gold": 0, "Silver": 0, "Copper": 0}
currency_win = None

def open_currency():
    global currency_win
    if currency_win is not None and tk.Toplevel.winfo_exists(currency_win):
        currency_win.deiconify()
        currency_win.lift()
        return

    currency_win = tk.Toplevel(root)
    currency_win.title("Currency")
    currency_win.geometry("250x200")

    def update_currency(kind, delta):
        currency[kind] += delta
        refresh_currency()

    def refresh_currency():
        for widget in currency_win.winfo_children():
            widget.destroy()
        for kind, value in currency.items():
            row = tk.Frame(currency_win, pady=4)
            row.pack(fill="x")
            tk.Label(row, text=f"{kind}: {value}").pack(side="left")
            tk.Button(row, text="+", command=lambda k=kind: update_currency(k, 1), width=2).pack(side="right")
            tk.Button(row, text="-", command=lambda k=kind: update_currency(k, -1), width=2).pack(side="right")

    refresh_currency()

# ---------------------- Quest List ----------------------
quests = []
quests_win = None

def open_quests():
    global quests_win
    if quests_win is not None and tk.Toplevel.winfo_exists(quests_win):
        quests_win.deiconify()
        quests_win.lift()
        return

    quests_win = tk.Toplevel(root)
    quests_win.title("Quests")
    quests_win.geometry("360x420")

    add_frame = tk.Frame(quests_win)
    add_frame.pack(fill="x", padx=10, pady=(10, 6))

    tk.Label(add_frame, text="Add Quest:").pack(side="left")
    add_entry = tk.Entry(add_frame)
    add_entry.pack(side="left", fill="x", expand=True, padx=6)

    def add_quest(event=None):
        text = add_entry.get().strip()
        if not text:
            return
        quests.append(text)
        add_entry.delete(0, "end")
        refresh_quests()

    add_btn = tk.Button(add_frame, text="Add", command=add_quest)
    add_btn.pack(side="left")
    add_entry.bind("<Return>", add_quest)

    list_container = tk.Frame(quests_win)
    list_container.pack(fill="both", expand=True, padx=10, pady=6)

    canvas = tk.Canvas(list_container, highlightthickness=0)
    scrollbar = tk.Scrollbar(list_container, orient="vertical", command=canvas.yview)
    items_frame = tk.Frame(canvas)

    items_frame.bind(
        "<Configure>",
        lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
    )
    canvas.create_window((0, 0), window=items_frame, anchor="nw")
    canvas.configure(yscrollcommand=scrollbar.set)

    canvas.pack(side="left", fill="both", expand=True)
    scrollbar.pack(side="right", fill="y")

    def delete_quest(idx):
        if 0 <= idx < len(quests):
            del quests[idx]
            refresh_quests()

    def refresh_quests():
        for w in items_frame.winfo_children():
            w.destroy()
        for i, quest in enumerate(quests):
            row = tk.Frame(items_frame, pady=4)
            row.pack(fill="x")
            name = tk.Label(row, text=quest, anchor="w")
            name.pack(side="left", fill="x", expand=True)
            del_btn = tk.Button(row, text="❌", width=3, command=lambda ix=i: delete_quest(ix))
            del_btn.pack(side="right")

    quests_win.refresh_quests = refresh_quests
    quests_win.add_quest = add_quest
    refresh_quests()

# ---------------------- Gallery (with previews + click-to-open + delete) ----------------------
gallery_images = []  # list of file paths
_gallery_thumbs = {}  # path -> PhotoImage, to keep references alive
_gallery_win = None


def _open_in_os(path: str):
    try:
        if sys.platform.startswith("win"):
            os.startfile(path)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
    except Exception as e:
        messagebox.showerror("Open Image", f"Couldn't open image: {e}")


def _view_image_popup(path: str):
    if not HAS_PIL:
        _open_in_os(path)
        return

    if not os.path.exists(path):
        messagebox.showwarning("Missing File", f"Image not found:\n{path}")
        return

    win = tk.Toplevel(root)
    win.title(os.path.basename(path))
    win.geometry("640x480")

    canvas = tk.Canvas(win)
    hbar = tk.Scrollbar(win, orient="horizontal", command=canvas.xview)
    vbar = tk.Scrollbar(win, orient="vertical", command=canvas.yview)
    canvas.configure(xscrollcommand=hbar.set, yscrollcommand=vbar.set)

    hbar.pack(side="bottom", fill="x")
    vbar.pack(side="right", fill="y")
    canvas.pack(side="left", fill="both", expand=True)

    try:
        img = Image.open(path)
    except Exception as e:
        messagebox.showerror("Image", f"Failed to load image: {e}")
        return

    photo = ImageTk.PhotoImage(img)
    inner = tk.Frame(canvas)
    img_label = tk.Label(inner, image=photo)
    img_label.image = photo
    img_label.pack()
    canvas.create_window((0, 0), window=inner, anchor="nw")

    def _on_configure(event=None):
        canvas.configure(scrollregion=canvas.bbox("all"))

    inner.bind("<Configure>", _on_configure)
    _on_configure()


def open_gallery():
    global _gallery_win
    if _gallery_win is not None and tk.Toplevel.winfo_exists(_gallery_win):
        _gallery_win.deiconify()
        _gallery_win.lift()
        return

    _gallery_win = tk.Toplevel(root)
    _gallery_win.title("Gallery")
    _gallery_win.geometry("500x550")

    header = tk.Frame(_gallery_win)
    header.pack(fill="x", padx=10, pady=6)

    def add_image():
        paths = filedialog.askopenfilenames(filetypes=[("Image Files", "*.png;*.jpg;*.jpeg;*.gif;*.bmp;*.tiff")])
        added = 0
        for path in paths:
            if path and path not in gallery_images:
                gallery_images.append(path)
                added += 1
        if added:
            refresh_gallery()

    tk.Button(header, text="Add Image(s)", command=add_image).pack(side="left")

    container = tk.Frame(_gallery_win)
    container.pack(fill="both", expand=True, padx=10, pady=6)

    canvas = tk.Canvas(container, highlightthickness=0)
    vscroll = tk.Scrollbar(container, orient="vertical", command=canvas.yview)
    canvas.configure(yscrollcommand=vscroll.set)

    grid_frame = tk.Frame(canvas)
    canvas.create_window((0, 0), window=grid_frame, anchor="nw")

    canvas.pack(side="left", fill="both", expand=True)
    vscroll.pack(side="right", fill="y")

    def _thumb_for(path: str):
        if not HAS_PIL or not os.path.exists(path):
            return None
        try:
            img = Image.open(path)
            img.thumbnail((120, 120))
            thumb = ImageTk.PhotoImage(img)
            _gallery_thumbs[path] = thumb
            return thumb
        except Exception:
            return None

    def delete_image(path: str):
        if path in gallery_images:
            gallery_images.remove(path)
            refresh_gallery()

    def refresh_gallery():
        for w in grid_frame.winfo_children():
            w.destroy()
        cols = 3
        for idx, path in enumerate(gallery_images):
            frame = tk.Frame(grid_frame, bd=1, relief="groove", padx=4, pady=4)
            r = idx // cols
            c = idx % cols
            frame.grid(row=r, column=c, padx=6, pady=6, sticky="nsew")

            thumb = _thumb_for(path)
            if thumb is not None:
                img_btn = tk.Button(frame, image=thumb, command=lambda p=path: _view_image_popup(p))
                img_btn.image = thumb
                img_btn.pack()
            else:
                btn = tk.Button(frame, text=os.path.basename(path) if os.path.exists(path) else f"(missing) {os.path.basename(path)}",
                                wraplength=120, command=lambda p=path: _open_in_os(p))
                btn.pack()

            lbl_text = os.path.basename(path) if os.path.exists(path) else f"(missing) {os.path.basename(path)}"
            tk.Label(frame, text=lbl_text, wraplength=120).pack(pady=2)

            del_btn = tk.Button(frame, text="❌ Delete", command=lambda p=path: delete_image(p))
            del_btn.pack(pady=2)

        grid_frame.update_idletasks()
        canvas.configure(scrollregion=canvas.bbox("all"))

    _gallery_win.refresh_gallery = refresh_gallery
    refresh_gallery()

# ---------------------- Save/Load ----------------------
def save_game():
    data = {
        "inventory": inventory_items,  # now a list of {"name","qty"} dicts
        "stats": character_stats,
        "currency": currency,
        "quests": quests,
        "gallery": gallery_images,
        "time": {
            "total_days": total_days,
            "food_days_left": food_days_left,
            "water_days_left": water_days_left
        },
        "save_version": 2  # optional marker for the new format
    }
    with open(SAVE_FILE, "w") as f:
        json.dump(data, f, indent=2)
    messagebox.showinfo("Save", "Game saved successfully!")

def load_game():
    global inventory_items, character_stats, currency, quests, gallery_images
    global total_days, food_days_left, water_days_left

    if not os.path.exists(SAVE_FILE):
        messagebox.showwarning("Load", "No save file found.")
        return

    try:
        with open(SAVE_FILE, "r") as f:
            data = json.load(f)
    except Exception as e:
        messagebox.showerror("Load", f"Failed to read save:\n{e}")
        return

    # ---- Inventory (handles old saves that stored plain strings) ----
    raw_inv = data.get("inventory", [])
    migrated = []
    for entry in raw_inv:
        if isinstance(entry, dict):
            name = (entry.get("name") or "").strip()
            try:
                qty = int(entry.get("qty", 1))
            except Exception:
                qty = 1
            if name:
                migrated.append({"name": name, "qty": max(1, qty)})
        elif isinstance(entry, str):
            name = entry.strip()
            if name:
                migrated.append({"name": name, "qty": 1})
    inventory_items = migrated

    # ---- Other data ----
    character_stats.update(data.get("stats", {}))
    currency.update(data.get("currency", {}))
    quests = data.get("quests", [])
    gallery_images = data.get("gallery", [])

    # Time & survival
    t = data.get("time", {})
    total_days = int(t.get("total_days", 0))
    food_days_left = int(t.get("food_days_left", FOOD_RESET))
    water_days_left = int(t.get("water_days_left", WATER_RESET))

    # Refresh UI if open
    try:
        _update_time_labels()
    except Exception:
        pass
    try:
        _refresh_level_label()
    except Exception:
        pass
    try:
        refresh_items()
    except Exception:
        pass

    messagebox.showinfo("Load", "Game loaded successfully!")

# ---------------------- Main Window ----------------------
# Create output label for dice results
output_label = tk.Label(root, text="", font=("Helvetica", 12), fg="blue")
output_label.pack(pady=10)

# --- finish building the UI and start the app ---

# Load and resize Avatars's profile image (robust path + Pillow fallback)
try:
    from PIL import Image, ImageTk
    from pathlib import Path

    APP_DIR = Path(__file__).resolve().parent
    img_path = APP_DIR / "Avatar.png"          # always finds the file next to Helper.py

    # Pick a resample filter that exists in your Pillow version
    Resampling = getattr(Image, "Resampling", Image)
    RESAMPLE_FILTER = getattr(Resampling, "LANCZOS",
                       getattr(Image, "ANTIALIAS", Image.BICUBIC))

    img = Image.open(img_path)
    img = img.resize((150, 150), RESAMPLE_FILTER)
    avatar_img = ImageTk.PhotoImage(img)

    # A vertical column: level row on top, image under it
    profile_col = tk.Frame(root)
    profile_col.pack(pady=10)

    # --- Level row: "Level: X   -  +" ---
    level_row = tk.Frame(profile_col)
    level_row.pack()

    level_value = tk.StringVar(value=f"Level: {int(character_stats.get('Level', 1))}")
    tk.Label(level_row, textvariable=level_value, font=("Helvetica", 12, "bold")).pack(side="left")
    tk.Button(level_row, text="-", width=2, command=lambda: _change_level(-1)).pack(side="left", padx=(8, 2))
    tk.Button(level_row, text="+", width=2, command=lambda: _change_level(+1)).pack(side="left")

    # --- Profile image under the level row ---
    profile_label = tk.Label(profile_col, image=avatar_img)
    profile_label.image = avatar_img  # keep a reference
    profile_label.pack(pady=(6, 0))

except Exception as e:
    # show the real reason so you can diagnose if needed
    messagebox.showerror("Avatar Image", f"Couldn't load avatar.png:\n{e}")
    profile_label = tk.Label(root, text="(Avatar image missing)", font=("Helvetica", 12), fg="red")
    profile_label.pack(pady=10)

# Dice controls
dice_frame = tk.Frame(root)
dice_frame.pack(pady=6)

# Top row
tk.Button(dice_frame, text="D4",  width=6, command=lambda: roll_dice(4)).grid(row=0, column=0, padx=4, pady=4)
tk.Button(dice_frame, text="D6",  width=6, command=lambda: roll_dice(6)).grid(row=0, column=1, padx=4, pady=4)
tk.Button(dice_frame, text="D8",  width=6, command=lambda: roll_dice(8)).grid(row=0, column=2, padx=4, pady=4)

# Bottom row
tk.Button(dice_frame, text="D10", width=6, command=lambda: roll_dice(10)).grid(row=1, column=0, padx=4, pady=4)
tk.Button(dice_frame, text="D12", width=6, command=lambda: roll_dice(12)).grid(row=1, column=1, padx=4, pady=4)
tk.Button(dice_frame, text="D20", width=6, command=lambda: roll_dice(20)).grid(row=1, column=2, padx=4, pady=4)

# Label to show dice results (fixes the 'output_label' not defined errors)
output_label = tk.Label(root, text="Roll something!", font=("Helvetica", 12), fg="blue")
output_label.pack(pady=8)

# Feature launchers
tk.Button(root, text="Inventory", command=open_inventory).pack(fill="x", padx=10, pady=2)
tk.Button(root, text="Character Stats", command=open_stats).pack(fill="x", padx=10, pady=2)
tk.Button(root, text="Currency", command=open_currency).pack(fill="x", padx=10, pady=2)
tk.Button(root, text="Quests", command=open_quests).pack(fill="x", padx=10, pady=2)
tk.Button(root, text="Gallery", command=open_gallery).pack(fill="x", padx=10, pady=2)

# ----- Time & Survival UI -----
time_frame = tk.LabelFrame(root, text="Time & Survival", padx=10, pady=8)
time_frame.pack(fill="x", padx=10, pady=8)

campaign_lbl = tk.Label(time_frame, text="Campaign Time: 0y 0m 0d (Total: 0 days)")
campaign_lbl.pack(anchor="w")

food_lbl = tk.Label(time_frame, text=f"Food: {FOOD_RESET} day(s) remaining")
food_lbl.pack(anchor="w")

water_lbl = tk.Label(time_frame, text=f"Water: {WATER_RESET} day(s) remaining")
water_lbl.pack(anchor="w")

btn_row = tk.Frame(time_frame)
btn_row.pack(fill="x", pady=6)

tk.Button(btn_row, text="Sleep (Next Day)", command=sleep_next_day).pack(side="left", padx=4)
tk.Button(btn_row, text="Eat Food",        command=eat_food).pack(side="left", padx=4)
tk.Button(btn_row, text="Drink Water",     command=drink_water).pack(side="left", padx=4)

_update_time_labels()

# Save / Load
sep = tk.Frame(root, height=1, bg="#ccc")
sep.pack(fill="x", padx=10, pady=8)

btns = tk.Frame(root)
btns.pack(pady=4)
tk.Button(btns, text="Save", width=10, command=save_game).grid(row=0, column=0, padx=6)
tk.Button(btns, text="Load", width=10, command=load_game).grid(row=0, column=1, padx=6)

# Start the Tk event loop
root.mainloop()
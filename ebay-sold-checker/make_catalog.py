#!/usr/bin/env python3
"""Generate the character-goods query catalog for the sold-items checker.

Combines a curated roster of Japanese-pop-culture characters with the goods
types a collector actually searches for, and emits:
  - queries.csv   : id, franchise, character, goods_type, query
  - queries.yaml  : same content, structured

Queries are built as "<character> <goods_type>" for the FR marketplace
(peluche, porte-clés, figurine, ...), which is where the verified search
flow operates today. Goods types are translated per marketplace in the
checker when new markets are added.
"""

import csv
import os
import sys

CHARACTERS = [
    # (franchise, character)
    # Jujutsu Kaisen
    ("Jujutsu Kaisen", "Gojo Satoru"), ("Jujutsu Kaisen", "Yuji Itadori"),
    ("Jujutsu Kaisen", "Megumi Fushiguro"), ("Jujutsu Kaisen", "Nobara Kugisaki"),
    ("Jujutsu Kaisen", "Sukuna"), ("Jujutsu Kaisen", "Toji Fushiguro"),
    ("Jujutsu Kaisen", "Maki Zenin"), ("Jujutsu Kaisen", "Nanami Kento"),
    ("Jujutsu Kaisen", "Choso"), ("Jujutsu Kaisen", "Yuta Okkotsu"),
    # Demon Slayer
    ("Demon Slayer", "Tanjiro"), ("Demon Slayer", "Nezuko"),
    ("Demon Slayer", "Zenitsu"), ("Demon Slayer", "Inosuke"),
    ("Demon Slayer", "Rengoku"), ("Demon Slayer", "Tengen Uzui"),
    ("Demon Slayer", "Giyu Tomioka"), ("Demon Slayer", "Shinobu Kocho"),
    ("Demon Slayer", "Mitsuri Kanroji"), ("Demon Slayer", "Akaza"),
    # One Piece
    ("One Piece", "Luffy"), ("One Piece", "Zoro"), ("One Piece", "Nami"),
    ("One Piece", "Sanji"), ("One Piece", "Chopper"), ("One Piece", "Ace"),
    ("One Piece", "Law"), ("One Piece", "Shanks"), ("One Piece", "Boa Hancock"),
    ("One Piece", "Robin"), ("One Piece", "Yamato"),
    # Naruto
    ("Naruto", "Naruto Uzumaki"), ("Naruto", "Sasuke Uchiha"),
    ("Naruto", "Sakura Haruno"), ("Naruto", "Kakashi Hatake"),
    ("Naruto", "Itachi Uchiha"), ("Naruto", "Hinata Hyuga"),
    ("Naruto", "Jiraiya"), ("Naruto", "Gaara"), ("Naruto", "Minato"),
    ("Naruto", "Kurama Kyubi"),
    # Dragon Ball
    ("Dragon Ball", "Goku"), ("Dragon Ball", "Vegeta"),
    ("Dragon Ball", "Broly"), ("Dragon Ball", "Gohan"),
    ("Dragon Ball", "Frieza"), ("Dragon Ball", "Piccolo"),
    ("Dragon Ball", "Trunks"), ("Dragon Ball", "Bulma"),
    # Genshin Impact
    ("Genshin Impact", "Hutao"), ("Genshin Impact", "Ganyu"),
    ("Genshin Impact", "Raiden Shogun"), ("Genshin Impact", "Xiao"),
    ("Genshin Impact", "Zhongli"), ("Genshin Impact", "Klee"),
    ("Genshin Impact", "Venti"), ("Genshin Impact", "Hu Tao"),
    ("Genshin Impact", "Kazuha"), ("Genshin Impact", "Nahida"),
    ("Genshin Impact", "Furina"), ("Genshin Impact", "Neuvillette"),
    # Pokémon / Sanrio / retro icons
    ("Pokemon", "Pikachu"), ("Pokemon", "Eevee"),
    ("Sanrio", "Hello Kitty"), ("Sanrio", "Kuromi"), ("Sanrio", "Cinnamoroll"),
    ("Sanrio", "My Melody"),
    # Sailor Moon / classics
    ("Sailor Moon", "Sailor Moon"), ("Sailor Moon", "Sailor Mercury"),
    ("Evangelion", "Asuka"), ("Evangelion", "Rei Ayanami"),
    ("Yu-Gi-Oh", "Dark Magician"), ("Detective Conan", "Conan"),
    ("Studio Ghibli", "Totoro"), ("Studio Ghibli", "No Face Kaonashi"),
    ("Studio Ghibli", "Jiji"), ("Studio Ghibli", "Ponyo"),
    ("Digimon", "Agumon"), ("Cardcaptor Sakura", "Sakura Kinomoto"),
    # Modern hits
    ("Chainsaw Man", "Makima"), ("Chainsaw Man", "Power"),
    ("Chainsaw Man", "Denji"),
    ("Attack on Titan", "Eren"), ("Attack on Titan", "Levi"),
    ("Attack on Titan", "Mikasa"),
    ("My Hero Academia", "Deku"), ("My Hero Academia", "Bakugo"),
    ("My Hero Academia", "Todoroki"),
    ("Spy x Family", "Anya"), ("Frieren", "Frieren"),
    ("Bocchi the Rock", "Hitori Gotoh"), ("Dandadan", "Momo Ayase"),
    ("Solo Leveling", "Sung Jinwoo"), ("Haikyuu", "Hinata"),
    ("Blue Lock", "Isagi"), ("Tokyo Ghoul", "Kaneki"),
    ("Vocaloid", "Hatsune Miku"), ("Nier", "2B"),
    ("Final Fantasy", "Cloud Strife"), ("Zelda", "Link"),
]

# FR marketplace goods types (the verified market today)
GOODS_FR = [
    "peluche",              # plush
    "peluche géante",       # giant plush
    "figurine",             # figure
    "figurine chibi",       # chibi figure
    "figurine pop",         # funkopop-style
    "gashapon",             # gacha figure
    "porte-clés",           # keychain
    "badge",                # pin/button
    "pin's",                # collector pin
    "stand acrylique",      # acrylic stand
    "poupée",               # doll
    "magnet",               # fridge magnet
    "strap",                # phone strap
    "carte à collectionner",# collectible card
    "tapis de souris",      # mousepad
]

DUPES = {}  # (character, goods) -> id


def main():
    out_dir = os.path.dirname(os.path.abspath(__file__))
    rows = []
    qid = 0
    for franchise, character in CHARACTERS:
        for goods in GOODS_FR:
            query = f"{character} {goods}"
            key = (character.lower(), goods)
            if key in DUPES:
                print(f"SKIP duplicate: {query}")
                continue
            DUPES[key] = qid
            qid += 1
            rows.append({"id": qid, "franchise": franchise,
                         "character": character, "goods_type": goods,
                         "query": query})

    csv_path = os.path.join(out_dir, "queries.csv")
    with open(csv_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "franchise", "character", "goods", "query"])
        w.writeheader()
        for r in rows:
            w.writerow({"id": r["id"], "franchise": r["franchise"],
                        "character": r["character"], "goods": r["goods_type"],
                        "query": r["query"]})

    yaml_path = os.path.join(out_dir, "queries.yaml")
    with open(yaml_path, "w") as f:
        f.write("# Auto-generated by make_catalog.py - edit characters there.\n")
        for r in rows:
            f.write(f"- id: {r['id']}\n"
                    f"  franchise: {r['franchise']}\n"
                    f"  character: {r['character']}\n"
                    f"  goods: {r['goods_type']}\n"
                    f"  query: \"{r['query']}\"\n")

    print(f"catalog written: {len(rows)} queries -> queries.csv / queries.yaml")
    return rows


if __name__ == "__main__":
    rows = main()
    if len(rows) < 500:
        print("TOO FEW QUERIES", file=sys.stderr)
        sys.exit(1)

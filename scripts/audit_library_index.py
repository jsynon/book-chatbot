"""Inspect the public v47 compressed search index without modifying it.

Usage:
  python scripts/audit_library_index.py path/to/data-v47
  python scripts/audit_library_index.py --remote

Remote mode downloads only the compressed manifest and a few relevant term
partitions; it does not fetch the book collection. Useful when establishing
compatibility with an existing library snapshot.
"""
import argparse
import gzip
import json
from pathlib import Path
import urllib.request

BASE = ("https://raw.githubusercontent.com/jsynon/"
        "antilogicalism-library-data/main/data-v47/")


def read(root, filename, remote=False):
    if remote:
        with urllib.request.urlopen(BASE + filename, timeout=35) as response:
            raw = response.read()
        return json.loads(gzip.decompress(raw).decode("utf-8"))
    with gzip.open(Path(root) / filename, "rt", encoding="utf-8") as stream:
        return json.load(stream)


def describe(obj):
    if isinstance(obj, dict):
        return {"type": "object", "count": len(obj),
                "keys": list(obj)[:8]}
    if isinstance(obj, list):
        return {"type": "array", "count": len(obj),
                "sample": obj[:3]}
    return {"type": type(obj).__name__, "sample": obj}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", nargs="?", default=".")
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    manifest = read(args.directory, "manifest.json.gz", args.remote)
    print("MANIFEST ROOT:", describe(manifest))
    for key, value in manifest.items():
        info = describe(value)
        if key == "books" and isinstance(value, dict):
            info["sample_book_7"] = value.get("7")
            info["sample_book_88"] = value.get("88")
        print("MANIFEST", key, ":", json.dumps(info, ensure_ascii=False)[:1200])
    for term in ("happiness", "virtue", "meaning", "life", "aristotle"):
        prefix = term[:2]
        data = read(args.directory, "terms-" + prefix + ".json.gz", args.remote)
        postings = data.get(term, [])
        print("TERM", term, "PARTITION", prefix,
              "ROOT", describe(data), "DELTAS", describe(postings))
        if isinstance(postings, list):
            current = 0
            samples = []
            for d in postings[:12]:
                current += d
                samples.append(current)
            print("DECODED", term, samples)
    for book_id in (7, 88):
        item = read(args.directory, f"book-{book_id}.json.gz", args.remote)
        print("BOOK", book_id, "ROOT", describe(item))
        print("BOOK", book_id, "FIRST_PAGE",
              json.dumps(item.get("pages", [])[:1], ensure_ascii=False)[:1000])


if __name__ == "__main__":
    main()

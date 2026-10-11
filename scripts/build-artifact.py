#!/usr/bin/env python3
"""Turn index.html + style.css into a Claude Artifact page (no html/head/body
skeleton, CSS inlined). Usage: build-artifact.py OUT_DIR [SHARE_URL]"""
import re, shutil, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
share = sys.argv[2] if len(sys.argv) > 2 else ''
html = (root / 'index.html').read_text()
css = (root / 'style.css').read_text()
title = re.search(r'<title>.*?</title>', html).group(0)
fonts = re.search(r'<link rel="stylesheet" href="https://fonts[^>]*>', html).group(0)
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
if share:
    body = f'<div hidden id="share-url" data-url="{share}"></div>' + body
page = f'{title}\n<style>\n{css}\n</style>\n{fonts}\n{body}'
(out / 'index.html').write_text(page)
shutil.copytree(root / 'js', out / 'js', dirs_exist_ok=True)
print('built', out)

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""压缩站点图片资源（幂等：已处理过的图片会被跳过）

背景：轮播 8 张图原始尺寸 2240~2560px 宽、合计 3.1MB，且没有懒加载，
把首屏渲染时间拖过了百度爬虫 5 秒的渲染超时，直接导致首页内容抓不到。

处理规则：
  - assets/images/hero/*.webp       宽度 > 960 时缩到 960，WebP q78
  - assets/images/**/*.jpg          宽度 > 960 时缩到 960，JPEG q80（渐进式）
  - assets/images/logo_xiaomeng.png 宽度 > 160 时缩到 160，PNG 优化

因为每条规则都以「宽度超过阈值」为前提，重复执行不会有任何变化，
所以可以安全地挂在每次构建流程里。
"""
import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print('缺少 Pillow，请先执行：pip install pillow')
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / 'assets' / 'images'

HERO_MAX_W = 960
COVER_MAX_W = 960
LOGO_MAX_W = 160
WEBP_Q = 78
JPG_Q = 80


def kb(p):
    return p.stat().st_size / 1024


def process(path, max_w, fmt, quality=None):
    before = kb(path)
    try:
        img = Image.open(path)
    except Exception as e:
        print('  ! 跳过（无法打开）%s: %s' % (path.name, e))
        return None, None
    w, h = img.size
    if w <= max_w:
        return None, None
    new_w = max_w
    new_h = max(1, round(h * max_w / w))
    if fmt == 'PNG':
        out = img.convert('RGBA').resize((new_w, new_h), Image.LANCZOS)
        out.save(path, 'PNG', optimize=True)
    elif fmt == 'WEBP':
        out = img.convert('RGB').resize((new_w, new_h), Image.LANCZOS)
        out.save(path, 'WEBP', quality=quality, method=6)
    else:
        out = img.convert('RGB').resize((new_w, new_h), Image.LANCZOS)
        out.save(path, 'JPEG', quality=quality, optimize=True, progressive=True)
    after = kb(path)
    print('  %-32s %7.1f KB -> %6.1f KB  (%dx%d -> %dx%d)'
          % (path.name, before, after, w, h, new_w, new_h))
    return before, after


def main():
    targets = []
    hero = IMG / 'hero'
    if hero.is_dir():
        targets += [(p, HERO_MAX_W, 'WEBP', WEBP_Q) for p in sorted(hero.glob('*.webp'))]
    targets += [(p, COVER_MAX_W, 'JPEG', JPG_Q) for p in sorted(IMG.glob('*.jpg'))]
    targets += [(p, COVER_MAX_W, 'JPEG', JPG_Q) for p in sorted(IMG.glob('*.jpeg'))]
    logo = IMG / 'logo_xiaomeng.png'
    if logo.is_file():
        targets.append((logo, LOGO_MAX_W, 'PNG', None))

    print('检查 %d 个图片文件（只有宽度超阈值才会被处理）' % len(targets))
    total_before = total_after = 0.0
    changed = 0
    for path, max_w, fmt, q in targets:
        b, a = process(path, max_w, fmt, q)
        if b is not None:
            changed += 1
            total_before += b
            total_after += a

    if changed:
        print('\n处理了 %d 个文件：%.1f KB -> %.1f KB（省下 %.1f KB）'
              % (changed, total_before, total_after, total_before - total_after))
    else:
        print('\n所有图片都已在目标尺寸内，无需处理。')

    # 轮播首屏相关图片的合计体积（用于人工核对）
    carousel = ['jizhan_cover.jpg', 'rxjianghu2_cover.jpg',
                'hero/hero_longzhigu_hd.webp', 'hero/hero_wulin.webp',
                'hero/hero_moxiangqing.webp', 'hero/hero_rongyao.webp',
                'hero/hero_xingchenbian.webp', 'hero/hero_qiannian.webp']
    total = sum(kb(IMG / c) for c in carousel if (IMG / c).is_file())
    print('轮播 8 张图当前合计：%.1f KB' % total)


if __name__ == '__main__':
    main()

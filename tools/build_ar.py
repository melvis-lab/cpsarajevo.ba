#!/usr/bin/env python3
"""Build the Arabic pages from the Bosnian source pages.

  python3 tools/build_ar.py

Reads   index.html, prica/index.html, tools/ar-home.json, tools/ar-prica.json
Writes  ar/index.html, ar/prica/index.html, js/i18n-ar.js

Every element with data-en="..." gets its Arabic text written straight into the
HTML (so Google and AI assistants can read it), looked up by the English text.
The script stops with a list if any English string has no Arabic translation.
Run it again after every change to index.html or prica/index.html.
"""
import html, json, re, sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}
SITE = 'https://cpsarajevo.ba'


class Ranges(HTMLParser):
    """Finds the inner HTML range of every element that carries data-en."""
    def __init__(self, text):
        super().__init__(convert_charrefs=False)
        self.text = text
        self.lines = [0]
        for m in re.finditer('\n', text):
            self.lines.append(m.end())
        self.stack, self.found = [], []

    def off(self):
        ln, col = self.getpos()
        return self.lines[ln - 1] + col

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        start = self.off()
        end_of_tag = start + len(self.get_starttag_text())
        self.stack.append((tag, end_of_tag, dict(attrs).get('data-en')))

    def handle_startendtag(self, tag, attrs):
        pass

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                t, inner_start, en = self.stack[i]
                del self.stack[i:]
                if en is not None:
                    self.found.append((inner_start, self.off(), en))
                return


def translate_inner(text, ar, missing):
    p = Ranges(text)
    p.feed(text)
    p.close()
    found = sorted(p.found)
    outer, last_end = [], -1
    for s, e, en in found:            # keep outermost only
        if s >= last_end:
            outer.append((s, e, en))
            last_end = e
    out, pos = [], 0
    for s, e, en in outer:
        key = html.unescape(en)
        if key == '':
            val = ''
        elif key in ar:
            val = ar[key]
        else:
            missing.add(key)
            val = text[s:e]
        out.append(text[pos:s])
        out.append(val)
        pos = e
    out.append(text[pos:])
    return ''.join(out)


def translate_attrs(text, ar, missing):
    def look(en):
        key = html.unescape(en)
        if key not in ar:
            missing.add(key)
            return None
        return html.escape(ar[key], quote=True)

    def tag_fix(m):
        tag = m.group(0)
        for src, dst in (('data-ph-en', 'placeholder'), ('data-al-en', 'aria-label'), ('data-pre-en', 'data-pre')):
            mm = re.search(src + r'="([^"]*)"', tag)
            if not mm:
                continue
            val = look(mm.group(1))
            if val is None:
                continue
            if re.search(r'\s' + dst + r'="[^"]*"', tag):
                tag = re.sub(r'(\s' + dst + r')="[^"]*"', lambda x: x.group(1) + '="' + val + '"', tag, count=1)
            else:
                tag = tag[:-1] + ' ' + dst + '="' + val + '">' if not tag.endswith('/>') else tag
        mm = re.search(r'data-suf-ar="([^"]*)"', tag)
        if mm:
            tag = re.sub(r'(\sdata-suf)="[^"]*"', lambda x: x.group(1) + '="' + mm.group(1) + '"', tag, count=1)
        return tag
    # only real tags outside <script>/<style>
    parts = re.split(r'(<script\b[\s\S]*?</script>|<style\b[\s\S]*?</style>)', text)
    for i in range(0, len(parts), 2):
        parts[i] = re.sub(r'<[a-zA-Z][^<>]*?(?:"[^"]*"[^<>]*?)*>', tag_fix, parts[i])
    return ''.join(parts)


def must(text, old, new, count=1):
    n = text.count(old)
    if n != count:
        sys.exit(f'build_ar: expected {count}× but found {n}× of: {old[:90]}')
    return text.replace(old, new)


def head_common(text, path, title, desc, og_title, og_desc):
    text = must(text, '<html lang="bs">', '<html lang="ar" dir="rtl">')
    text = re.sub(r'<title>[\s\S]*?</title>', '<title>' + title + '</title>', text, count=1)
    text = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{desc}">', text, count=1)
    text = re.sub(r'<link rel="canonical" href="[^"]*">', f'<link rel="canonical" href="{SITE}/ar/{path}">', text, count=1)
    text = re.sub(r'\s*<link rel="alternate" hreflang="[^"]*" href="[^"]*">', '', text)
    alt = (f'\n<link rel="alternate" hreflang="bs" href="{SITE}/{path}">'
           f'\n<link rel="alternate" hreflang="ar" href="{SITE}/ar/{path}">'
           f'\n<link rel="alternate" hreflang="x-default" href="{SITE}/{path}">')
    text = re.sub(r'(<link rel="canonical" href="[^"]*">)', lambda m: m.group(1) + alt, text, count=1)
    text = re.sub(r'<meta property="og:title" content="[^"]*">', f'<meta property="og:title" content="{og_title}">', text, count=1)
    text = re.sub(r'<meta property="og:description" content="[^"]*">', f'<meta property="og:description" content="{og_desc}">', text, count=1)
    if '<meta property="og:locale"' in text:
        text = re.sub(r'<meta property="og:locale" content="[^"]*">', '<meta property="og:locale" content="ar_AR">\n<meta property="og:locale:alternate" content="bs_BA">', text, count=1)
    if '<meta property="og:url"' in text:
        text = re.sub(r'<meta property="og:url" content="[^"]*">', f'<meta property="og:url" content="{SITE}/ar/{path}">', text, count=1)
    fonts = ('<link href="https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400'
             '&family=IBM+Plex+Sans+Arabic:wght@300;400;500&display=swap" rel="stylesheet">\n'
             '<link rel="stylesheet" href="/css/ar.css">\n</head>')
    text = must(text, '</head>', fonts)
    return text


def jsonld_home(ar, src):
    """Arabic structured data built from the same product data as the page."""
    def grab(name):
        i = src.index('const ' + name)
        k = src.index('=', i) + 1
        d, st = 0, -1
        while True:
            c = src[k]
            if c in '{[':
                st = k if st < 0 else st
                d += 1
            elif c in '}]':
                d -= 1
                if d == 0:
                    break
            k += 1
        return src[st:k + 1]
    ids = re.findall(r"\{id:'([^']+)',name:'([^']+)',g:'(\w)'", grab('P'))
    descs = dict(re.findall(r"'([a-z-]+)':\{h:\[[^\]]*\],\s*d:\['[^']*','((?:[^'\\]|\\.)*)'\]", grab('D')))
    gender = {'z': 'female', 'm': 'male', 'u': 'unisex'}
    items = []
    for n, (pid, name, g) in enumerate(ids, 1):
        en = descs[pid].replace("\\'", "'")
        items.append({'@type': 'ListItem', 'position': n, 'item': {
            '@type': 'Product', 'name': name, 'url': f'{SITE}/ar/#{pid}', 'image': f'{SITE}/img/{pid}.webp',
            'brand': {'@type': 'Brand', 'name': 'Collection Premium Paris'}, 'category': 'خلاصة عطر (Extrait de Parfum)، 50 مل',
            'audience': {'@type': 'PeopleAudience', 'suggestedGender': gender[g]}, 'description': ar[en]}})
    faq_en = [
        ('Where can I buy Collection Premium Paris perfumes in Sarajevo?', 'Collection Premium Sarajevo is the brand’s official partner for Sarajevo. Sales start on 1 January 2027, and you can reserve your scent on this site now, without paying.'),
        ('What is extrait de parfum?', 'Extrait de parfum is the strongest perfume concentration. Collection Premium Paris scents contain up to 30% perfume oils, so they last 12 hours or more on the skin.'),
        ('How much does it cost?', 'We announce the price on 1 January 2027. Everyone who reserves hears it first.'),
        ('Do you deliver across Bosnia and Herzegovina?', 'Yes, we deliver across Bosnia and Herzegovina.'),
        ('How do I reserve a scent?', 'Click Reserve, choose a scent and leave your name and phone number. You pay nothing in advance, and on opening day we contact you first.'),
    ]
    graph = {'@context': 'https://schema.org', '@graph': [
        {'@type': 'Organization', '@id': f'{SITE}/#org', 'name': 'Collection Premium Sarajevo', 'url': f'{SITE}/',
         'logo': f'{SITE}/img/brand/logo-full.webp',
         'description': 'الشريك الرسمي لعلامة Collection Premium Paris في سراييفو. خلاصة عطر، 12 عطرًا، توصيل إلى جميع أنحاء البوسنة والهرسك.',
         'areaServed': {'@type': 'Country', 'name': 'البوسنة والهرسك'},
         'address': {'@type': 'PostalAddress', 'addressLocality': 'Sarajevo', 'addressCountry': 'BA'},
         'sameAs': ['https://www.instagram.com/collectionpremiumsarajevo/'],
         'brand': {'@type': 'Brand', 'name': 'Collection Premium Paris'}},
        {'@type': 'WebPage', '@id': f'{SITE}/ar/#page', 'url': f'{SITE}/ar/', 'inLanguage': 'ar',
         'name': 'عطور سراييفو · Collection Premium Paris', 'isPartOf': {'@id': f'{SITE}/#site'}},
        {'@type': 'ItemList', 'name': 'مجموعة Collection Premium Paris في سراييفو', 'numberOfItems': len(items), 'itemListElement': items},
        {'@type': 'FAQPage', 'inLanguage': 'ar', 'mainEntity': [
            {'@type': 'Question', 'name': ar[q], 'acceptedAnswer': {'@type': 'Answer', 'text': ar[a]}} for q, a in faq_en]},
    ]}
    return '<script type="application/ld+json">\n' + json.dumps(graph, ensure_ascii=False, indent=1) + '\n</script>'


def build_home(ar):
    src = (ROOT / 'index.html').read_text(encoding='utf-8')
    missing = set()
    t = src
    t = head_common(t, '',
        'عطور سراييفو · Collection Premium Paris، خلاصة عطر',
        'Collection Premium Paris في سراييفو: 12 عطرًا من فئة خلاصة العطر بتركيز زيوت يصل إلى 30%، سعة 50 مل. الافتتاح في 1 يناير. احجز عطرك دون دفع، مع توصيل إلى جميع أنحاء البوسنة والهرسك.',
        'عطور سراييفو · Collection Premium Paris',
        '12 عطرًا و12 حكاية. خلاصة عطر من باريس. الافتتاح في 1 يناير في سراييفو.')
    t = re.sub(r'<script type="application/ld\+json">[\s\S]*?</script>', lambda m: jsonld_home(ar, src), t, count=1)
    # static bits without data-en
    for old, new in [
        ('<button class="skip" type="button">Preskoči</button>', '<button class="skip" type="button">تخطٍّ</button>'),
        ('01 · 01 · 2027<small>Sarajevo</small>', '01 · 01 · 2027<small>سراييفو</small>'),
        ('<span>Sarajevo · 1. januar</span>', '<span>سراييفو · 1 يناير</span>'),
        ("href='/prica'", "href='/ar/prica/'"),
        ('href="/privatnost/"', 'href="/ar/privatnost/"'),
        ('<input type="hidden" name="jezik" value="bs">', '<input type="hidden" name="jezik" value="ar">'),
        ('aria-label="Collection Premium Paris by MESO, Sarajevo"', 'aria-label="Collection Premium Paris by MESO، سراييفو"'),
        ('<a href="#top" class="logo"', '<a href="/ar/#top" class="logo"'),
    ]:
        t = must(t, old, new)
    t = t.replace('placeholder="+387 …"', 'placeholder="+387 / +966 …" dir="ltr"')
    for old, new in ALT_HOME.items():
        t = must(t, f'alt="{old}"', f'alt="{new}"')
    t = translate_attrs(t, ar, missing)
    t = translate_inner(t, ar, missing)
    t = must(t, '<script src="/vendor/gsap.min.js"></script>', '<script src="/js/i18n-ar.js"></script>\n<script src="/vendor/gsap.min.js"></script>')
    if missing:
        sys.exit('build_ar: no Arabic for:\n  ' + '\n  '.join(sorted(missing)))
    out = ROOT / 'ar' / 'index.html'
    out.parent.mkdir(exist_ok=True)
    out.write_text('<!-- Generated by tools/build_ar.py from /index.html. Do not edit by hand. -->\n' + t, encoding='utf-8')
    (ROOT / 'js' / 'i18n-ar.js').write_text(
        '/* Arabic strings for cpsarajevo.ba/ar/, keyed by the English text. Generated from tools/ar-home.json by tools/build_ar.py. */\n'
        'window.AR=' + json.dumps(ar, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    return out


def build_story(ar):
    src = (ROOT / 'prica' / 'index.html').read_text(encoding='utf-8')
    missing = set()
    t = head_common(src, 'prica/',
        'حكاية MESO · Collection Premium Sarajevo',
        'من أين بدأ كل شيء: رحلة عبر الزمن والعطر، من بلاد الرافدين إلى سراييفو.',
        'حكاية MESO · من أين بدأ كل شيء',
        'رحلة عبر الزمن والعطر، من بلاد الرافدين إلى سراييفو.')
    for old, new in [
        ("href='/#prica'", "href='/ar/#prica'"),
        ("aria-label='Collection Premium' href='/'", "aria-label='Collection Premium' href='/ar/'"),
        ("href='/#kolekcija'", "href='/ar/#kolekcija'"),
        ("href='/#film'", "href='/ar/#film'"),
        ('<footer>Collection Premium Paris · by MESO · Sarajevo</footer>', '<footer>Collection Premium Paris · by MESO · سراييفو</footer>'),
    ]:
        t = must(t, old, new)
    for old, new in ALT_STORY.items():
        t = must(t, f'alt="{old}"', f'alt="{new}"')
    t = translate_inner(t, ar, missing)
    if missing:
        sys.exit('build_ar (prica): no Arabic for:\n  ' + '\n  '.join(sorted(missing)))
    out = ROOT / 'ar' / 'prica' / 'index.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text('<!-- Generated by tools/build_ar.py from /prica/index.html. Do not edit by hand. -->\n' + t, encoding='utf-8')
    return out


ALT_HOME = {
    'Ruke drže bijelu poklon kutiju DUBAI pored bočice, bosanske kahve i rahat lokuma':
        'يدان تحملان علبة هدية DUBAI البيضاء بجانب الزجاجة والقهوة البوسنية وراحة الحلقوم',
    'Bijele poklon kutije sa zlatnom trakom i tri bočice Collection Premium: Dubai, Oud Secret i Safyr':
        'علب هدايا بيضاء بشريط ذهبي وثلاث زجاجات Collection Premium: Dubai وOud Secret وSafyr',
}
ALT_STORY = {
    'Trgovac s bočicom parfema ispred karavane kamila u pustinji, u zlatno predvečerje':
        'تاجر يحمل قارورة عطر أمام قافلة جمال في الصحراء، في ضوء الغروب الذهبي',
    'Stare ruke umotavaju malu staklenu bočicu u platno i spremaju je u kožnu torbu':
        'يدان مسنّتان تلفّان قارورة زجاجية صغيرة بقطعة قماش وتضعانها في حقيبة جلدية',
}

if __name__ == '__main__':
    home = json.loads((ROOT / 'tools' / 'ar-home.json').read_text(encoding='utf-8'))
    story = json.loads((ROOT / 'tools' / 'ar-prica.json').read_text(encoding='utf-8'))
    print('wrote', build_home(home).relative_to(ROOT))
    print('wrote', build_story(story).relative_to(ROOT))

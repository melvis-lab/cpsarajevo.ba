#!/usr/bin/env python3
"""Build the English and Arabic pages from the Bosnian source pages.

  python3 tools/build_pages.py

Reads   index.html, prica/index.html, tools/ar-home.json, tools/ar-prica.json
Writes  en/index.html, en/prica/index.html, ar/index.html, ar/prica/index.html, js/i18n-ar.js

Every element with data-en="..." gets its English or Arabic text written straight
into the HTML (so Google and AI assistants can read it). Arabic is looked up by the
English text; the script stops with a list if any English string has no Arabic.
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
        sys.exit(f'build_pages: expected {count}× but found {n}× of: {old[:90]}')
    return text.replace(old, new)


def head_common(text, path, title, desc, og_title, og_desc, lang='ar'):
    text = must(text, '<html lang="bs">', '<html lang="ar" dir="rtl">' if lang == 'ar' else '<html lang="en">')
    text = re.sub(r'<title>[\s\S]*?</title>', '<title>' + title + '</title>', text, count=1)
    text = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{desc}">', text, count=1)
    text = re.sub(r'<link rel="canonical" href="[^"]*">', f'<link rel="canonical" href="{SITE}/{lang}/{path}">', text, count=1)
    text = re.sub(r'\s*<link rel="alternate" hreflang="[^"]*" href="[^"]*">', '', text)
    alt = (f'\n<link rel="alternate" hreflang="bs" href="{SITE}/{path}">'
           f'\n<link rel="alternate" hreflang="en" href="{SITE}/en/{path}">'
           f'\n<link rel="alternate" hreflang="ar" href="{SITE}/ar/{path}">'
           f'\n<link rel="alternate" hreflang="x-default" href="{SITE}/{path}">')
    text = re.sub(r'(<link rel="canonical" href="[^"]*">)', lambda m: m.group(1) + alt, text, count=1)
    text = re.sub(r'<meta property="og:title" content="[^"]*">', f'<meta property="og:title" content="{og_title}">', text, count=1)
    text = re.sub(r'<meta property="og:description" content="[^"]*">', f'<meta property="og:description" content="{og_desc}">', text, count=1)
    if '<meta property="og:locale"' in text:
        text = re.sub(r'<meta property="og:locale" content="[^"]*">', ('<meta property="og:locale" content="ar_AR">' if lang == 'ar' else '<meta property="og:locale" content="en_GB">') + '\n<meta property="og:locale:alternate" content="bs_BA">', text, count=1)
    if '<meta property="og:url"' in text:
        text = re.sub(r'<meta property="og:url" content="[^"]*">', f'<meta property="og:url" content="{SITE}/{lang}/{path}">', text, count=1)
    if lang != 'ar':
        return text
    fonts = ('<link href="https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400'
             '&family=IBM+Plex+Sans+Arabic:wght@300;400;500&display=swap" rel="stylesheet">\n'
             '<link rel="stylesheet" href="/css/ar.css">\n</head>')
    text = must(text, '</head>', fonts)
    return text


class Same(dict):
    """English 'dictionary': every English key maps to itself."""
    def __contains__(self, k):
        return True

    def __getitem__(self, k):
        return k


FAQ_EN = [
    ('Where can I buy Collection Premium Paris perfumes in Sarajevo?', 'Collection Premium Sarajevo is the brand’s official partner for Sarajevo. Sales start on 1 January 2027, and you can reserve your scent on this site now, without paying.'),
    ('What is extrait de parfum?', 'Extrait de parfum is the strongest perfume concentration. Collection Premium Paris scents contain up to 30% perfume oils, so they last 12 hours or more on the skin.'),
    ('How much does it cost?', 'We announce the price on 1 January 2027. Everyone who reserves hears it first.'),
    ('Do you deliver across Bosnia and Herzegovina?', 'Yes, we deliver across Bosnia and Herzegovina.'),
    ('How do I reserve a scent?', 'Click Reserve, choose a scent and leave your name and phone number. You pay nothing in advance, and on opening day we contact you first.'),
]

# Per-language text that is not in data-en attributes
L10N = {
    'ar': {
        'home': ('عطور سراييفو · Collection Premium Paris، خلاصة عطر',
                 'Collection Premium Paris في سراييفو: 12 عطرًا من فئة خلاصة العطر بتركيز زيوت يصل إلى 30%، سعة 50 مل. الافتتاح في 1 يناير. احجز عطرك دون دفع، مع توصيل إلى جميع أنحاء البوسنة والهرسك.',
                 'عطور سراييفو · Collection Premium Paris',
                 '12 عطرًا و12 حكاية. خلاصة عطر من باريس. الافتتاح في 1 يناير في سراييفو.'),
        'story': ('حكاية MESO · Collection Premium Sarajevo',
                  'من أين بدأ كل شيء: رحلة عبر الزمن والعطر، من بلاد الرافدين إلى سراييفو.',
                  'حكاية MESO · من أين بدأ كل شيء',
                  'رحلة عبر الزمن والعطر، من بلاد الرافدين إلى سراييفو.'),
        'skip': 'تخطٍّ', 'sarajevo': 'سراييفو', 'jan1': '1 يناير',
        'org': 'الشريك الرسمي لعلامة Collection Premium Paris في سراييفو. خلاصة عطر، 12 عطرًا، توصيل إلى جميع أنحاء البوسنة والهرسك.',
        'country': 'البوسنة والهرسك', 'category': 'خلاصة عطر (Extrait de Parfum)، 50 مل',
        'page': 'عطور سراييفو · Collection Premium Paris', 'list': 'مجموعة Collection Premium Paris في سراييفو',
        'tel': '+387 / +966 …', 'logo': 'Collection Premium Paris by MESO، سراييفو',
        'alt_home': {
            'Ruke drže bijelu poklon kutiju DUBAI pored bočice, bosanske kahve i rahat lokuma':
                'يدان تحملان علبة هدية DUBAI البيضاء بجانب الزجاجة والقهوة البوسنية وراحة الحلقوم',
            'Bijele poklon kutije sa zlatnom trakom i tri bočice Collection Premium: Dubai, Oud Secret i Safyr':
                'علب هدايا بيضاء بشريط ذهبي وثلاث زجاجات Collection Premium: Dubai وOud Secret وSafyr'},
        'alt_story': {
            'Trgovac s bočicom parfema ispred karavane kamila u pustinji, u zlatno predvečerje':
                'تاجر يحمل قارورة عطر أمام قافلة جمال في الصحراء، في ضوء الغروب الذهبي',
            'Stare ruke umotavaju malu staklenu bočicu u platno i spremaju je u kožnu torbu':
                'يدان مسنّتان تلفّان قارورة زجاجية صغيرة بقطعة قماش وتضعانها في حقيبة جلدية'},
    },
    'en': {
        'home': ('Perfume in Sarajevo · Collection Premium Paris, extrait de parfum',
                 'Collection Premium Paris in Sarajevo: 12 extrait de parfum scents with up to 30% perfume oils, 50 ml. Opening 1 January. Reserve your scent without paying, delivery across Bosnia and Herzegovina.',
                 'Perfume in Sarajevo · Collection Premium Paris',
                 '12 scents, 12 stories. Extrait de parfum from Paris. Opening 1 January in Sarajevo.'),
        'story': ('The story of MESO · Collection Premium Sarajevo',
                  'Where it all began: a journey through time and scent, from Mesopotamia to Sarajevo.',
                  'The story of MESO · Where it all began',
                  'A journey through time and scent, from Mesopotamia to Sarajevo.'),
        'skip': 'Skip', 'sarajevo': 'Sarajevo', 'jan1': '1 January',
        'org': 'Official partner of Collection Premium Paris for Sarajevo. Extrait de parfum, 12 scents, delivery across Bosnia and Herzegovina.',
        'country': 'Bosnia and Herzegovina', 'category': 'Extrait de parfum, 50 ml',
        'page': 'Perfume in Sarajevo · Collection Premium Paris', 'list': 'Collection Premium Paris, the collection in Sarajevo',
        'tel': '+387 …', 'logo': 'Collection Premium Paris by MESO, Sarajevo',
        'alt_home': {
            'Ruke drže bijelu poklon kutiju DUBAI pored bočice, bosanske kahve i rahat lokuma':
                'Hands holding the white DUBAI gift box next to the bottle, Bosnian coffee and Turkish delight',
            'Bijele poklon kutije sa zlatnom trakom i tri bočice Collection Premium: Dubai, Oud Secret i Safyr':
                'White gift boxes with gold ribbon and three Collection Premium bottles: Dubai, Oud Secret and Safyr'},
        'alt_story': {
            'Trgovac s bočicom parfema ispred karavane kamila u pustinji, u zlatno predvečerje':
                'A trader holding a perfume vial in front of a camel caravan in the desert, at golden dusk',
            'Stare ruke umotavaju malu staklenu bočicu u platno i spremaju je u kožnu torbu':
                'Old hands wrap a small glass vial in cloth and put it in a leather bag'},
    },
}


def grab_js(src, name):
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


def jsonld_home(lang, tr, src):
    """Structured data for the translated home page, built from the page's own product data."""
    T = L10N[lang]
    ids = re.findall(r"\{id:'([^']+)',name:'([^']+)',g:'(\w)'", grab_js(src, 'P'))
    descs = dict(re.findall(r"'([a-z-]+)':\{h:\[[^\]]*\],\s*d:\['[^']*','((?:[^'\\]|\\.)*)'\]", grab_js(src, 'D')))
    gender = {'z': 'female', 'm': 'male', 'u': 'unisex'}
    items = []
    for n, (pid, name, g) in enumerate(ids, 1):
        en = descs[pid].replace("\\'", "'")
        items.append({'@type': 'ListItem', 'position': n, 'item': {
            '@type': 'Product', 'name': name, 'url': f'{SITE}/{lang}/#{pid}', 'image': f'{SITE}/img/{pid}.webp',
            'brand': {'@type': 'Brand', 'name': 'Collection Premium Paris'}, 'category': T['category'],
            'audience': {'@type': 'PeopleAudience', 'suggestedGender': gender[g]}, 'description': tr[en]}})
    graph = {'@context': 'https://schema.org', '@graph': [
        {'@type': 'Organization', '@id': f'{SITE}/#org', 'name': 'Collection Premium Sarajevo', 'url': f'{SITE}/',
         'logo': f'{SITE}/img/brand/logo-full.webp', 'description': T['org'],
         'areaServed': {'@type': 'Country', 'name': T['country']},
         'address': {'@type': 'PostalAddress', 'addressLocality': 'Sarajevo', 'addressCountry': 'BA'},
         'sameAs': ['https://www.instagram.com/collectionpremiumsarajevo/'],
         'brand': {'@type': 'Brand', 'name': 'Collection Premium Paris'}},
        {'@type': 'WebPage', '@id': f'{SITE}/{lang}/#page', 'url': f'{SITE}/{lang}/', 'inLanguage': lang,
         'name': T['page'], 'isPartOf': {'@id': f'{SITE}/#site'}},
        {'@type': 'ItemList', 'name': T['list'], 'numberOfItems': len(items), 'itemListElement': items},
        {'@type': 'FAQPage', 'inLanguage': lang, 'mainEntity': [
            {'@type': 'Question', 'name': tr[q], 'acceptedAnswer': {'@type': 'Answer', 'text': tr[a]}} for q, a in FAQ_EN]},
    ]}
    return '<script type="application/ld+json">\n' + json.dumps(graph, ensure_ascii=False, indent=1) + '\n</script>'


def stop_if_missing(missing, what):
    if missing:
        sys.exit(f'build_pages ({what}): no translation for:\n  ' + '\n  '.join(sorted(missing)))


def build_home(lang, tr):
    T = L10N[lang]
    src = (ROOT / 'index.html').read_text(encoding='utf-8')
    missing = set()
    t = head_common(src, '', *T['home'], lang=lang)
    t = re.sub(r'<script type="application/ld\+json">[\s\S]*?</script>', lambda m: jsonld_home(lang, tr, src), t, count=1)
    for old, new in [
        ('<button class="skip" type="button">Preskoči</button>', f'<button class="skip" type="button">{T["skip"]}</button>'),
        ('01 · 01 · 2027<small>Sarajevo</small>', f'01 · 01 · 2027<small>{T["sarajevo"]}</small>'),
        ('<span>Sarajevo · 1. januar</span>', f'<span>{T["sarajevo"]} · {T["jan1"]}</span>'),
        ("href='/prica'", f"href='/{lang}/prica/'"),
        ('<input type="hidden" name="jezik" value="bs">', f'<input type="hidden" name="jezik" value="{lang}">'),
        ('aria-label="Collection Premium Paris by MESO, Sarajevo"', f'aria-label="{T["logo"]}"'),
        ('<a href="#top" class="logo"', f'<a href="/{lang}/#top" class="logo"'),
    ]:
        t = must(t, old, new)
    t = t.replace('href="/privatnost/"', f'href="/{lang}/privatnost/"')
    t = t.replace('placeholder="+387 …"', f'placeholder="{T["tel"]}" dir="ltr"' if lang == 'ar' else f'placeholder="{T["tel"]}"')
    for old, new in T['alt_home'].items():
        t = must(t, f'alt="{old}"', f'alt="{new}"')
    t = translate_attrs(t, tr, missing)
    t = translate_inner(t, tr, missing)
    if lang == 'ar':
        t = must(t, '<script src="/vendor/gsap.min.js"></script>', '<script src="/js/i18n-ar.js"></script>\n<script src="/vendor/gsap.min.js"></script>')
    t = t.replace('<a href="/privatnost/">', f'<a href="/{lang}/privatnost/">')
    stop_if_missing(missing, f'{lang} home')
    out = ROOT / lang / 'index.html'
    out.parent.mkdir(exist_ok=True)
    out.write_text('<!-- Generated by tools/build_pages.py from /index.html. Do not edit by hand. -->\n' + t, encoding='utf-8')
    return out


def build_story(lang, tr):
    T = L10N[lang]
    src = (ROOT / 'prica' / 'index.html').read_text(encoding='utf-8')
    missing = set()
    t = head_common(src, 'prica/', *T['story'], lang=lang)
    for old, new in [
        ("href='/#prica'", f"href='/{lang}/#prica'"),
        ("aria-label='Collection Premium' href='/'", f"aria-label='Collection Premium' href='/{lang}/'"),
        ("href='/#kolekcija'", f"href='/{lang}/#kolekcija'"),
        ("href='/#film'", f"href='/{lang}/#film'"),
        ('<footer>Collection Premium Paris · by MESO · Sarajevo</footer>', f'<footer>Collection Premium Paris · by MESO · {T["sarajevo"]}</footer>'),
    ]:
        t = must(t, old, new)
    for old, new in T['alt_story'].items():
        t = must(t, f'alt="{old}"', f'alt="{new}"')
    t = translate_inner(t, tr, missing)
    stop_if_missing(missing, f'{lang} story')
    out = ROOT / lang / 'prica' / 'index.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text('<!-- Generated by tools/build_pages.py from /prica/index.html. Do not edit by hand. -->\n' + t, encoding='utf-8')
    return out


if __name__ == '__main__':
    ar_home = json.loads((ROOT / 'tools' / 'ar-home.json').read_text(encoding='utf-8'))
    ar_story = json.loads((ROOT / 'tools' / 'ar-prica.json').read_text(encoding='utf-8'))
    for lang, home, story in (('en', Same(), Same()), ('ar', ar_home, ar_story)):
        print('wrote', build_home(lang, home).relative_to(ROOT))
        print('wrote', build_story(lang, story).relative_to(ROOT))
    (ROOT / 'js' / 'i18n-ar.js').write_text(
        '/* Arabic strings for cpsarajevo.ba/ar/, keyed by the English text. Generated from tools/ar-home.json by tools/build_pages.py. */\n'
        'window.AR=' + json.dumps(ar_home, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    print('wrote js/i18n-ar.js')

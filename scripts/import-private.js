#!/usr/bin/env python3
"""Importa TODOS los lugares del mapa privado (todas las regiones) a data/places.json,
con horarios estructurados, reels y fotos. Sin telefonos (privacidad)."""
import json, re, os, shutil, sys

PRIV = os.path.expanduser('~/workspace/ts-spaces/mapa-argentina')
GV = os.path.expanduser('~/workspace/group-vote')
PLACEHOLDER_IMG = ''

def extract_braced(s, start):
    """Extrae el objeto {...} balanceado desde start (indice del '{')."""
    assert s[start] == '{'
    depth, i, instr, esc = 0, start, False, False
    while i < len(s):
        c = s[i]
        if instr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': instr = False
        else:
            if c == '"': instr = True
            elif c == '{': depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    return s[start:i + 1]
        i += 1
    raise ValueError('llaves sin balancear')

def norm_name(n):
    import unicodedata
    n = re.sub(r'\s*\(@[^)]*\)\s*$', '', n or '')
    n = unicodedata.normalize('NFD', n)
    n = ''.join(c for c in n if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', n).strip().lower()

def load_places():
    s = open(os.path.join(PRIV, 'index.html'), encoding='utf-8').read()
    cands = []  # (region, place)
    # 1) objeto maestro MAPS
    i = s.find('var MAPS=')
    if i > 0:
        j = s.find('{', i)
        maps = json.loads(extract_braced(s, j))
        for region, m in maps.items():
            for p in m.get('places', []):
                if p.get('id'):
                    cands.append((region, p))
    # 2) todos los PLACES= literales (builds regionales)
    for m in re.finditer(r'PLACES\s*=\s*', s):
        j = m.end()
        while j < len(s) and s[j] in ' \t':
            j += 1
        if j >= len(s) or s[j] not in '{[':
            continue
        try:
            raw = extract_braced(s, j) if s[j] == '{' else extract_array(s, j)
            data = json.loads(raw)
        except Exception:
            continue
        if isinstance(data, dict):
            for region, plist in data.items():
                for p in plist:
                    if p.get('id'):
                        cands.append((region, p))
        elif isinstance(data, list):
            for p in data:
                pid = p.get('id') or ''
                mm = re.match(r'^([a-z]+)-\d{4}', pid)
                region = mm.group(1) if mm else (p.get('city') or 'otros')
                cands.append((region, p))
    # 3) dedup por (nombre, region): gana el mas completo
    def score(p):
        sc = 0
        link = p.get('link') or ''
        if link and 'instagram.com' in link:
            sc += 4
        if (p.get('notas') or '').strip():
            sc += 1
        return sc
    best = {}
    for region, p in cands:
        key = (norm_name(p.get('label')), region)
        if not key[0]:
            continue
        cur = best.get(key)
        if cur is None or score(p) > score(cur[1]):
            best[key] = (region, p)
    print(f'candidatos: {len(cands)}, unicos: {len(best)}')
    return list(best.values())

def extract_array(s, start):
    assert s[start] == '['
    depth, i, instr, esc = 0, start, False, False
    while i < len(s):
        c = s[i]
        if instr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': instr = False
        else:
            if c == '"': instr = True
            elif c == '[': depth += 1
            elif c == ']':
                depth -= 1
                if depth == 0:
                    return s[start:i + 1]
        i += 1
    raise ValueError('corchetes sin balancear')

def load_meta():
    s = open(os.path.join(PRIV, 'assets', 'place-meta.js'), encoding='utf-8').read()
    i = s.find('PLACE_META=')
    assert i > 0
    j = s.find('{', i)
    meta = json.loads(extract_braced(s, j))
    # asignaciones posteriores: PLACE_META["id"]=[...];
    for m in re.finditer(r'PLACE_META\["((?:[^"\\]|\\.)+)"\]\s*=\s*(\[.*?\]);', s, re.S):
        pid = json.loads('"' + m.group(1) + '"')
        try:
            meta[pid] = json.loads(m.group(2))
        except Exception:
            pass
    return meta

DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

def fmt_min(m):
    """minutos -> '8:00 AM' (12h). Acepta >1440 (trasnoche)."""
    m = int(m) % 1440
    h, mm = divmod(m, 60)
    ap = 'AM' if h < 12 else 'PM'
    h12 = h % 12 or 12
    return f'{h12}:{mm:02d} {ap}'

def hours_text(periods):
    """{'1': [[480,1200]], ...} -> 'lun–vie 8:00 AM–8:00 PM; ...'"""
    if not periods:
        return ''
    sigs = []
    for d in range(7):
        ivs = sorted(periods.get(str(d), []))
        sigs.append('|'.join(f'{a}-{b if b is not None else "x"}' for a, b in ivs))
    # agrupar dias consecutivos con misma firma
    groups, start, cur = [], 0, sigs[0]
    for d in range(1, 8):
        s = sigs[d] if d < 7 else None
        if s != cur:
            groups.append((start, d - 1, cur))
            start, cur = d, s
    out = []
    for a, b, sig in groups:
        if not sig:
            continue
        ivs = []
        for part in sig.split('|'):
            o, c = part.split('-')
            ivs.append(fmt_min(int(o)) + '–' + (fmt_min(int(c)) if c != 'x' else '?'))
        rng = DIAS[a] if a == b else f'{DIAS[a]}–{DIAS[b]}'
        out.append(f'{rng} {", ".join(ivs)}')
    if not out:
        return ''
    # 'todos los dias' si cubre 0-6 con la misma firma no vacia
    if len(groups) == 1 and groups[0][0] == 0 and groups[0][1] == 6:
        return 'todos los días ' + out[0].split(' ', 1)[1]
    return '; '.join(out)

def clean_name(label):
    return re.sub(r'\s*\(@[^)]*\)\s*$', '', label or '').strip()

def main():
    places = load_places()
    meta = load_meta()
    print(f'places unicos: {len(places)}, metas: {len(meta)}')
    img_src_dir = os.path.join(PRIV, 'assets')
    img_dst_dir = os.path.join(GV, 'public', 'images')
    os.makedirs(img_dst_dir, exist_ok=True)

    out, con_reel, con_horas, con_foto = [], 0, 0, 0
    for region, p in places:
        pid = p.get('id') or ''
        if not pid:
            continue
        lat, lng = p.get('lat'), p.get('lng')
        m = meta.get(pid) or [None, None, None]
        tz = m[1] if len(m) > 1 else None
        periods = m[2] if len(m) > 2 else None
        reel = ''
        for cand in [p.get('link')] + (p.get('links') or []):
            if cand and 'instagram.com' in cand:
                mm = re.search(r'(https?://www\.instagram\.com/(?:reel|p)/[A-Za-z0-9_-]+)', cand)
                if mm:
                    reel = mm.group(1) + '/'
                    break
        img = ''
        for ext in ('webp', 'jpg', 'png'):
            src = os.path.join(img_src_dir, f'{pid}.{ext}')
            if os.path.isfile(src):
                dst = os.path.join(img_dst_dir, f'{pid}.{ext}')
                if not os.path.isfile(dst):
                    shutil.copy2(src, dst)
                img = f'/images/{pid}.{ext}'
                con_foto += 1
                break
        ht = hours_text(periods) if periods else ''
        if ht: con_horas += 1
        if reel: con_reel += 1
        rec = {
            'id': pid,
            'name': clean_name(p.get('label')),
            'type': (p.get('tipo') or '').strip(),
            'address': (p.get('direccion') or '').strip(),
            'lat': lat, 'lng': lng,
            'hours': ht,
            'hours_json': json.dumps({'tz': tz, 'periods': periods}, ensure_ascii=False) if periods else '',
            'notes': (p.get('notas') or '').strip(),
            'image': img,
            'neighborhood': (p.get('barrio') or '').strip(),
            'region': region,
            'city': (p.get('city') or '').strip(),
            'reel_url': reel,
        }
        out.append(rec)
    out.sort(key=lambda r: (r['region'], r['name'].lower()))
    # search_text para la busqueda sin tildes (lo genera el servidor, pero lo dejamos listo)
    with open(os.path.join(GV, 'data', 'places.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    print(f'lugares: {len(out)} | con reel: {con_reel} | con horarios: {con_horas} | con foto: {con_foto}')

if __name__ == '__main__':
    main()

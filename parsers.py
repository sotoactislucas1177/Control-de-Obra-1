import re

NUM_RE = re.compile(r'[\d\.]+,\d{0,2}')


def _to_float(s):
    s = s.strip().rstrip(',')
    if not s:
        return 0.0
    s = s.replace('.', '').replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return 0.0


def _decode(raw_bytes):
    try:
        return raw_bytes.decode('utf-8')
    except UnicodeDecodeError:
        return raw_bytes.decode('cp1252')


def _nearest_anchor(end_pos, anchors, tolerance=4):
    best = None
    best_dist = tolerance + 1
    for name, pos in anchors.items():
        d = abs(end_pos - pos)
        if d <= tolerance and d < best_dist:
            best = name
            best_dist = d
    return best


RUBRO_LINE_RE = re.compile(r'^\s*(\d{3})\.00\s+(.+?)\s{2,}(?:Global)?\s*(?=\s|$)')
PRESUPUESTO_ANCHORS = {'monto': 82, 'materiales': 96, 'mano_obra': 110, 'subcontratos': 124}


def parse_presupuesto(raw_bytes):
    text = _decode(raw_bytes)
    rubros = []
    errores = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        m = re.match(r'^\s*(\d{3})\.00\s+(.+)$', line)
        if not m:
            continue
        codigo = int(m.group(1))
        resto = m.group(2)
        desc_match = re.match(r'^(.+?)\s{2,}', resto)
        descripcion = desc_match.group(1).strip() if desc_match else resto.strip()
        descripcion = re.sub(r'\s+Global\s*$', '', descripcion).strip()

        valores = {'monto': 0.0, 'materiales': 0.0, 'mano_obra': 0.0, 'subcontratos': 0.0}
        for num_match in NUM_RE.finditer(line):
            if ',' not in num_match.group():
                continue
            anchor = _nearest_anchor(num_match.end(), PRESUPUESTO_ANCHORS)
            if anchor:
                valores[anchor] = _to_float(num_match.group())

        suma_desglose = valores['materiales'] + valores['mano_obra'] + valores['subcontratos']
        if suma_desglose == 0.0:
            if valores['monto'] == 0.0:
                errores.append(f"Rubro {codigo} ({descripcion}): no se detectó ningún monto en el archivo — revisalo manualmente.")
            else:
                errores.append(f"Rubro {codigo} ({descripcion}): el archivo trae Monto=${valores['monto']:,.2f} pero sin desglose en Materiales/Mano de obra/Subcontratos — dato probablemente incompleto en el archivo fuente, revisalo manualmente.")

        rubros.append((codigo, descripcion, valores['monto'], valores['materiales'],
                        valores['mano_obra'], valores['subcontratos']))

    return rubros, errores


MATERIALES_ANCHORS = {'precio_unitario': 70, 'cantidad': 81, 'parcial': 95}
CAT_HEADER_RE = re.compile(r'^\s*(\d{2})\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ \-]+?)\s{2,}([\d\.]*,\d{0,2})')
ITEM_CODE_RE = re.compile(r'^\s*(\d{6,8})\s')
CONT_LINE_RE = re.compile(r'^\s*([A-Z]{1,4})\s+[\d\.]+,\d{2}\s+[\d\.]+,\d{2}\s+[\d\.]+,\d{2}')


def parse_materiales(raw_bytes):
    text = _decode(raw_bytes)
    lines = text.splitlines()
    materiales = []
    errores = []
    categoria_actual = None

    CATEGORIAS = {
        'MATERIALES': 'Materiales',
        'MANO DE OBRA DIRECTA': 'Mano De Obra Directa',
        'SUBCONTRATOS': 'Subcontratos',
    }

    idx = 0
    while idx < len(lines):
        line = lines[idx]
        lineno = idx + 1
        idx += 1

        cat_match = CAT_HEADER_RE.match(line)
        if cat_match and not ITEM_CODE_RE.match(line):
            nombre_cat = cat_match.group(2).strip()
            categoria_actual = CATEGORIAS.get(nombre_cat, nombre_cat.title())
            continue

        item_match = ITEM_CODE_RE.match(line)
        if not item_match:
            continue

        codigo = item_match.group(1)
        resto = line[item_match.end():]

        if not NUM_RE.search(line) and idx < len(lines) and CONT_LINE_RE.match(lines[idx]):
            cont = lines[idx]
            idx += 1
            cont_match = CONT_LINE_RE.match(cont)
            unidad = cont_match.group(1)
            nums = [n.group() for n in NUM_RE.finditer(cont) if ',' in n.group()]
            descripcion = re.sub(r'\s+', ' ', resto).strip()
            precio_unitario = _to_float(nums[0]) if len(nums) > 0 else 0.0
            cantidad = _to_float(nums[1]) if len(nums) > 1 else 0.0
            parcial = _to_float(nums[2]) if len(nums) > 2 else 0.0
            if not descripcion:
                errores.append(f"Línea {lineno}: no se pudo leer la descripción del código {codigo}")
                continue
            materiales.append((codigo, descripcion, unidad, precio_unitario, cantidad, parcial,
                                categoria_actual or 'Materiales'))
            continue

        valores = {}
        for num_match in NUM_RE.finditer(line):
            if ',' not in num_match.group():
                continue
            anchor = _nearest_anchor(num_match.end(), MATERIALES_ANCHORS)
            if anchor:
                valores[anchor] = (num_match.group(), num_match.start(), num_match.end())

        precio_unitario = _to_float(valores['precio_unitario'][0]) if 'precio_unitario' in valores else 0.0
        cantidad = _to_float(valores['cantidad'][0]) if 'cantidad' in valores else 0.0
        parcial = _to_float(valores['parcial'][0]) if 'parcial' in valores else 0.0

        primer_valor_inicio_abs = min((v[1] for v in valores.values()), default=len(line))
        primer_valor_inicio = max(0, primer_valor_inicio_abs - item_match.end())
        texto_previo = re.sub(r'\s+', ' ', resto[:primer_valor_inicio]).strip()
        partes = texto_previo.rsplit(' ', 1)
        if len(partes) == 2 and re.match(r'^[A-Z0-9]{1,4}$', partes[1]):
            descripcion, unidad = partes[0].strip(), partes[1].strip()
        else:
            descripcion, unidad = texto_previo, ''

        if not descripcion:
            errores.append(f"Línea {lineno}: no se pudo leer la descripción del código {codigo}")
            continue

        materiales.append((codigo, descripcion, unidad, precio_unitario, cantidad, parcial,
                            categoria_actual or 'Materiales'))

    return materiales, errores


# ---------------- materiales por rubro.TXT -> cómputo por ítem ----------------
# Este archivo trae, para cada ítem de obra (tarea/rubro unitario), el desglose
# completo de materiales/mano de obra/subcontratos necesarios para producir
# UNA unidad de ese ítem (ej: 1 M2 de "CAPA AISLADORA..." cuesta $X en arena,
# cemento, cal, hidrófugo, oficial albañil, ayudante...).
ITEM_RE = re.compile(r'^\s*([A-Z]{2}\d{3})\s+(\d{3})\s+(\d{1,2}/\d{1,2}/\d{4})\s*(.*)$')
COMPUTO_MATERIAL_RE = re.compile(r'^\s*(\d{5})\s+(\d{3})\s+(\d{1,2}/\d{1,2}/\d{4})\s*(.*)$')
CAT_COMPUTO_RE = re.compile(r'^\s*(\d{2})\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9 ,.\-]*?)\s*$')
UNIDAD_COMPUTO_RE = re.compile(r'^\s{15,}([A-Z0-9]{1,3})\s*$')
COSTO_COSTO_RE = re.compile(r'Costo-Costo\s+([\d\.]+,\d{2})')
COMPUTO_ANCHORS = {'cantidad': 95, 'precio_unitario': 110, 'parcial': 124}


def parse_computo(raw_bytes):
    text = _decode(raw_bytes)
    lines = text.splitlines()

    items = []
    current_item = None
    current_cat = None
    seen_codigos = set()
    errores = []
    idx = 0
    n = len(lines)

    while idx < n:
        line = lines[idx]
        idx += 1

        m_item = ITEM_RE.match(line)
        if m_item:
            codigo = m_item.group(1) + m_item.group(2)
            descripcion = m_item.group(4).strip()
            current_item = {"codigo": codigo, "descripcion": descripcion, "unidad": None,
                             "categorias": [], "costo_costo": 0.0}
            current_cat = None
            continue

        if current_item is None:
            continue

        if current_item.get("unidad") is None:
            m_un = UNIDAD_COMPUTO_RE.match(line)
            if m_un:
                current_item["unidad"] = m_un.group(1)
                continue

        m_mat = COMPUTO_MATERIAL_RE.match(line)
        if m_mat:
            mat_codigo = m_mat.group(1) + m_mat.group(2)
            resto = m_mat.group(4)
            resto_abs_start = m_mat.start(4)
            nums_line = [x for x in NUM_RE.finditer(line) if ',' in x.group()]
            if len(nums_line) == 0 and idx < n and CONT_LINE_RE.match(lines[idx]):
                cont = lines[idx]
                idx += 1
                cont_m = CONT_LINE_RE.match(cont)
                unidad_mat = cont_m.group(1)
                nums = [x.group() for x in NUM_RE.finditer(cont) if ',' in x.group()]
                descripcion_mat = re.sub(r'\s+', ' ', resto).strip()
                cantidad = _to_float(nums[0]) if len(nums) > 0 else 0.0
                precio_unitario = _to_float(nums[1]) if len(nums) > 1 else 0.0
                parcial = _to_float(nums[2]) if len(nums) > 2 else 0.0
            else:
                valores = {}
                for nm in nums_line:
                    anchor = _nearest_anchor(nm.end(), COMPUTO_ANCHORS)
                    if anchor:
                        valores[anchor] = (nm.group(), nm.start())
                cantidad = _to_float(valores['cantidad'][0]) if 'cantidad' in valores else 0.0
                precio_unitario = _to_float(valores['precio_unitario'][0]) if 'precio_unitario' in valores else 0.0
                parcial = _to_float(valores['parcial'][0]) if 'parcial' in valores else 0.0
                primer_valor_abs = min((v[1] for v in valores.values()), default=len(line))
                primer_valor_rel = max(0, primer_valor_abs - resto_abs_start)
                texto_previo = re.sub(r'\s+', ' ', resto[:primer_valor_rel]).strip()
                partes = texto_previo.rsplit(' ', 1)
                if len(partes) == 2 and re.match(r'^[A-Z0-9]{1,4}$', partes[1]):
                    descripcion_mat, unidad_mat = partes[0].strip(), partes[1].strip()
                else:
                    descripcion_mat, unidad_mat = texto_previo, ''

            if current_cat is not None:
                current_cat["materiales"].append({
                    "codigo": mat_codigo, "descripcion": descripcion_mat, "unidad": unidad_mat,
                    "cantidad": cantidad, "precio_unitario": precio_unitario, "parcial": parcial,
                })
            continue

        m_costo = COSTO_COSTO_RE.search(line)
        if m_costo:
            declarado = _to_float(m_costo.group(1))
            current_item["costo_costo"] = declarado
            calculado = sum(m["parcial"] for c in current_item["categorias"] for m in c["materiales"])
            if abs(calculado - declarado) > 1:
                errores.append(
                    f"Ítem {current_item['codigo']} ({current_item['descripcion']}): la suma de materiales "
                    f"da ${calculado:,.2f} pero el archivo declara ${declarado:,.2f} — revisalo manualmente."
                )
            if current_item["codigo"] not in seen_codigos:
                seen_codigos.add(current_item["codigo"])
                items.append(current_item)
            current_item = None
            current_cat = None
            continue

        m_cat = CAT_COMPUTO_RE.match(line)
        if m_cat:
            current_cat = {"codigo": m_cat.group(1), "nombre": m_cat.group(2).strip(), "materiales": []}
            current_item["categorias"].append(current_cat)
            continue

    return items, errores

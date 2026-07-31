"""
Parsers de los archivos .TXT de origen (Presupuesto.TXT, Materiales.txt).
Basado en el formato de ancho fijo que exporta el software de cómputos que
usa Lucas. Si un archivo nuevo tiene exactamente esa misma estructura de
columnas, este parser debería funcionar igual; si el formato cambia mucho,
puede necesitar ajustes.
"""
import re

NUM_RE = re.compile(r'[\d\.]+,\d{0,2}')


def _to_float(s):
    """Convierte '1.234.567,89' (formato argentino) a float. Tolera comas sin decimales."""
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


# ---------------- Presupuesto.TXT -> rubros ----------------
RUBRO_LINE_RE = re.compile(r'^\s*(\d{3})\.00\s+(.+?)\s{2,}(?:Global)?\s*(?=\s|$)')
# anclas (posiciones de fin de columna) calibradas contra el archivo real:
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
        # la descripcion es todo el texto hasta el primer bloque de 2+ espacios
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


# ---------------- Materiales.txt -> materiales ----------------
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

        # caso de linea partida en dos: "CODIGO DESCRIPCION" sin ningun numero,
        # seguido de una linea de continuacion con "UNIDAD PRECIO CANTIDAD PARCIAL"
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

        # unidad: palabra corta en mayusculas (2-3 letras) antes del primer numero de precio
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

        # descripcion + unidad: todo el texto antes del primer valor numerico reconocido
        # (los offsets de "valores" son absolutos sobre "line", no sobre "resto")
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

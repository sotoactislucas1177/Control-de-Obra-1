"""
Capa de datos: SQLite puro (sin dependencias externas), para que corra igual
en el sandbox de desarrollo y en el hosting (Railway) sin instalar nada.
"""
import sqlite3
import os
import json

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "obra.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS proyecto (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    nombre TEXT, ubicacion TEXT, propietario TEXT, contratista TEXT,
    fecha_inicio TEXT, moneda TEXT, responsable TEXT, version TEXT, estado TEXT
);

CREATE TABLE IF NOT EXISTS rubros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo INTEGER UNIQUE,
    descripcion TEXT,
    monto_presupuestado REAL DEFAULT 0,
    materiales REAL DEFAULT 0,
    mano_obra REAL DEFAULT 0,
    subcontratos REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS materiales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT UNIQUE,
    descripcion TEXT,
    unidad TEXT,
    categoria TEXT,
    precio_unitario REAL DEFAULT 0,
    cantidad_proyectada REAL DEFAULT 0,
    monto_proyectado REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS compras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT,
    material_codigo TEXT,
    cantidad REAL DEFAULT 0,
    costo_total REAL DEFAULT 0,
    lugar_compra TEXT,
    factura_numero TEXT
);

CREATE TABLE IF NOT EXISTS tareas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo INTEGER UNIQUE,
    nombre TEXT,
    duracion_semanas REAL DEFAULT 1,
    predecesora1 INTEGER,
    predecesora2 INTEGER
);
"""


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def seed_if_empty():
    conn = get_conn()
    cur = conn.execute("SELECT COUNT(*) AS c FROM rubros")
    if cur.fetchone()["c"] > 0:
        conn.close()
        return False

    seed_path = os.path.join(os.path.dirname(__file__), "seed_extracted.json")
    with open(seed_path, encoding="utf-8") as f:
        seed = json.load(f)

    conn.execute(
        "INSERT INTO proyecto (id, nombre, ubicacion, propietario, contratista, fecha_inicio, moneda, responsable, version, estado) "
        "VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "P67 — Planta Captura de Biogás",
            "Fachinal, Misiones",
            "Lucas Soto Actis",
            "ISC COSNTRUCCIONES",
            "2026-03-01",
            "ARS",
            "Lucas Soto Actis",
            "V1.0",
            "En ejecución",
        ),
    )

    for cod, desc, monto, mat, mo, subc in seed["rubros_reales"]:
        conn.execute(
            "INSERT INTO rubros (codigo, descripcion, monto_presupuestado, materiales, mano_obra, subcontratos) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (cod, desc, monto, mat, mo, subc),
        )

    for cod, desc, unidad, punit, cant, parcial, cat in seed["materiales_reales"]:
        conn.execute(
            "INSERT INTO materiales (codigo, descripcion, unidad, categoria, precio_unitario, cantidad_proyectada, monto_proyectado) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (cod, desc, unidad, cat.title(), punit, cant, parcial),
        )

    for cod, tarea, dur, p1, p2 in seed["cronograma_ejemplo"]:
        conn.execute(
            "INSERT INTO tareas (codigo, nombre, duracion_semanas, predecesora1, predecesora2) VALUES (?, ?, ?, ?, ?)",
            (cod, tarea, dur, p1, p2),
        )

    conn.commit()
    conn.close()
    return True


def rows_to_dicts(rows):
    return [dict(r) for r in rows]

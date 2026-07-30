"""
Servidor de la app de seguimiento de obra. Sin frameworks externos (solo
librería estándar de Python) para que corra igual en el sandbox de
desarrollo y en el hosting, sin depender de instalar nada.
"""
import json
import os
import re
import datetime
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import db
import cpm

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


def json_default(o):
    if isinstance(o, (datetime.date, datetime.datetime)):
        return o.isoformat()
    raise TypeError


class Handler(BaseHTTPRequestHandler):
    server_version = "ObraApp/1.0"

    def log_message(self, fmt, *args):
        pass  # silencioso; usamos prints propios si hace falta debug

    # ---------- helpers ----------
    def _send_json(self, payload, status=200):
        body = json.dumps(payload, default=json_default, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, message, status=400):
        self._send_json({"error": message}, status=status)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"
        if path.startswith("/static/"):
            path = path[len("/static/"):]
        else:
            path = path.lstrip("/")
        safe_path = os.path.normpath(path)
        full_path = os.path.join(STATIC_DIR, safe_path)
        if not full_path.startswith(STATIC_DIR) or not os.path.isfile(full_path):
            self._send_error_json("No encontrado", 404)
            return
        ctype, _ = mimetypes.guess_type(full_path)
        with open(full_path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---------- ruteo ----------
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/api/proyecto":
            return self.get_proyecto()
        if path == "/api/rubros":
            return self.get_rubros()
        if path == "/api/materiales":
            return self.get_materiales()
        if path == "/api/compras":
            return self.get_compras()
        if path == "/api/resumen":
            return self.get_resumen()
        if path == "/api/cronograma":
            return self.get_cronograma()
        if path.startswith("/api/"):
            return self._send_error_json("Ruta no encontrada", 404)
        return self._serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/proyecto":
            return self.post_proyecto()
        if path == "/api/compras":
            return self.post_compra()
        if path == "/api/cronograma":
            return self.post_tarea()
        return self._send_error_json("Ruta no encontrada", 404)

    def do_PUT(self):
        path = urlparse(self.path).path
        m = re.match(r"^/api/cronograma/(\d+)$", path)
        if m:
            return self.put_tarea(int(m.group(1)))
        return self._send_error_json("Ruta no encontrada", 404)

    def do_DELETE(self):
        path = urlparse(self.path).path
        m = re.match(r"^/api/compras/(\d+)$", path)
        if m:
            return self.delete_compra(int(m.group(1)))
        m = re.match(r"^/api/cronograma/(\d+)$", path)
        if m:
            return self.delete_tarea(int(m.group(1)))
        return self._send_error_json("Ruta no encontrada", 404)

    # ---------- endpoints: proyecto ----------
    def get_proyecto(self):
        conn = db.get_conn()
        row = conn.execute("SELECT * FROM proyecto WHERE id = 1").fetchone()
        conn.close()
        self._send_json(dict(row) if row else {})

    def post_proyecto(self):
        data = self._read_json_body()
        campos = ["nombre", "ubicacion", "propietario", "contratista", "fecha_inicio",
                  "moneda", "responsable", "version", "estado"]
        # actualizacion parcial: solo se tocan los campos que vinieron en el body,
        # para no borrar datos (ej. version) que el formulario no incluye
        campos_presentes = [c for c in campos if c in data]
        if not campos_presentes:
            return self.get_proyecto()
        sets = ", ".join(f"{c} = ?" for c in campos_presentes)
        valores = [data.get(c) for c in campos_presentes]
        conn = db.get_conn()
        conn.execute(f"UPDATE proyecto SET {sets} WHERE id = 1", valores)
        conn.commit()
        conn.close()
        self.get_proyecto()

    # ---------- endpoints: rubros ----------
    def get_rubros(self):
        conn = db.get_conn()
        rows = db.rows_to_dicts(conn.execute("SELECT * FROM rubros ORDER BY codigo").fetchall())
        conn.close()
        total = sum(r["monto_presupuestado"] for r in rows)
        for r in rows:
            r["pct_incidencia"] = (r["monto_presupuestado"] / total) if total else 0
        self._send_json({"rubros": rows, "total_presupuestado": total})

    # ---------- endpoints: materiales ----------
    def get_materiales(self):
        conn = db.get_conn()
        rows = db.rows_to_dicts(conn.execute("SELECT * FROM materiales ORDER BY descripcion").fetchall())
        conn.close()
        self._send_json({"materiales": rows})

    # ---------- endpoints: compras ----------
    def get_compras(self):
        conn = db.get_conn()
        rows = db.rows_to_dicts(conn.execute(
            "SELECT compras.*, materiales.descripcion AS material_descripcion, materiales.unidad AS material_unidad "
            "FROM compras LEFT JOIN materiales ON materiales.codigo = compras.material_codigo "
            "ORDER BY compras.fecha DESC, compras.id DESC"
        ).fetchall())
        conn.close()
        self._send_json({"compras": rows})

    def post_compra(self):
        data = self._read_json_body()
        material_codigo = (data.get("material_codigo") or "").strip()
        if not material_codigo:
            return self._send_error_json("Falta el código de material")
        conn = db.get_conn()
        existe = conn.execute("SELECT 1 FROM materiales WHERE codigo = ?", (material_codigo,)).fetchone()
        if not existe:
            conn.close()
            return self._send_error_json(f"El código de material '{material_codigo}' no existe en el catálogo")
        cantidad = float(data.get("cantidad") or 0)
        costo_total = float(data.get("costo_total") or 0)
        conn.execute(
            "INSERT INTO compras (fecha, material_codigo, cantidad, costo_total, lugar_compra, factura_numero) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (data.get("fecha"), material_codigo, cantidad, costo_total,
             data.get("lugar_compra", ""), data.get("factura_numero", "")),
        )
        conn.commit()
        conn.close()
        self.get_compras()

    def delete_compra(self, compra_id):
        conn = db.get_conn()
        conn.execute("DELETE FROM compras WHERE id = ?", (compra_id,))
        conn.commit()
        conn.close()
        self.get_compras()

    # ---------- endpoints: resumen / estadísticas ----------
    def get_resumen(self):
        conn = db.get_conn()
        rubros = db.rows_to_dicts(conn.execute("SELECT * FROM rubros").fetchall())
        materiales = db.rows_to_dicts(conn.execute("SELECT * FROM materiales").fetchall())
        compras = db.rows_to_dicts(conn.execute("SELECT * FROM compras").fetchall())
        conn.close()

        total_proyectado_rubros = sum(r["monto_presupuestado"] for r in rubros)
        total_proyectado_materiales = sum(m["monto_proyectado"] for m in materiales)
        total_gastado = sum(c["costo_total"] for c in compras)

        gastado_por_material = {}
        cantidad_por_material = {}
        for c in compras:
            gastado_por_material[c["material_codigo"]] = gastado_por_material.get(c["material_codigo"], 0) + c["costo_total"]
            cantidad_por_material[c["material_codigo"]] = cantidad_por_material.get(c["material_codigo"], 0) + c["cantidad"]

        detalle_materiales = []
        gastado_por_categoria = {}
        proyectado_por_categoria = {}
        for m in materiales:
            gastado = gastado_por_material.get(m["codigo"], 0)
            comprado = cantidad_por_material.get(m["codigo"], 0)
            proyectado_por_categoria[m["categoria"]] = proyectado_por_categoria.get(m["categoria"], 0) + m["monto_proyectado"]
            gastado_por_categoria[m["categoria"]] = gastado_por_categoria.get(m["categoria"], 0) + gastado
            detalle_materiales.append({
                "codigo": m["codigo"],
                "descripcion": m["descripcion"],
                "unidad": m["unidad"],
                "categoria": m["categoria"],
                "cantidad_proyectada": m["cantidad_proyectada"],
                "cantidad_comprada": comprado,
                "diferencia_cantidad": comprado - m["cantidad_proyectada"],
                "monto_proyectado": m["monto_proyectado"],
                "monto_gastado": gastado,
                "diferencia_monto": gastado - m["monto_proyectado"],
            })

        self._send_json({
            "total_proyectado_rubros": total_proyectado_rubros,
            "total_proyectado_materiales": total_proyectado_materiales,
            "total_gastado": total_gastado,
            "diferencia": total_gastado - total_proyectado_materiales,
            "cantidad_compras": len(compras),
            "por_categoria": [
                {"categoria": cat, "proyectado": proyectado_por_categoria.get(cat, 0), "gastado": gastado_por_categoria.get(cat, 0)}
                for cat in proyectado_por_categoria
            ],
            "detalle_materiales": detalle_materiales,
        })

    # ---------- endpoints: cronograma ----------
    def get_cronograma(self):
        conn = db.get_conn()
        tareas = db.rows_to_dicts(conn.execute("SELECT * FROM tareas ORDER BY codigo").fetchall())
        proyecto = conn.execute("SELECT fecha_inicio FROM proyecto WHERE id = 1").fetchone()
        conn.close()
        fecha_inicio = datetime.date.fromisoformat(proyecto["fecha_inicio"]) if proyecto and proyecto["fecha_inicio"] else datetime.date.today()
        resultado, error = cpm.compute_cpm(tareas, fecha_inicio)
        if error:
            return self._send_error_json(error, 422)
        self._send_json(resultado)

    def post_tarea(self):
        data = self._read_json_body()
        conn = db.get_conn()
        conn.execute(
            "INSERT INTO tareas (codigo, nombre, duracion_semanas, predecesora1, predecesora2) VALUES (?, ?, ?, ?, ?)",
            (data.get("codigo"), data.get("nombre"), float(data.get("duracion_semanas") or 1),
             data.get("predecesora1"), data.get("predecesora2")),
        )
        conn.commit()
        conn.close()
        self.get_cronograma()

    def put_tarea(self, tarea_id):
        data = self._read_json_body()
        conn = db.get_conn()
        conn.execute(
            "UPDATE tareas SET nombre = ?, duracion_semanas = ?, predecesora1 = ?, predecesora2 = ? WHERE id = ?",
            (data.get("nombre"), float(data.get("duracion_semanas") or 1),
             data.get("predecesora1"), data.get("predecesora2"), tarea_id),
        )
        conn.commit()
        conn.close()
        self.get_cronograma()

    def delete_tarea(self, tarea_id):
        conn = db.get_conn()
        conn.execute("DELETE FROM tareas WHERE id = ?", (tarea_id,))
        conn.commit()
        conn.close()
        self.get_cronograma()


def main():
    db.init_db()
    db.seed_if_empty()
    port = int(os.environ.get("PORT", 8000))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Servidor corriendo en el puerto {port}")
    server.serve_forever()


if __name__ == "__main__":
    main()

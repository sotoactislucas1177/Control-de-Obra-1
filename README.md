# Control de Obra — P67

App de seguimiento de obra (compras de materiales, estadísticas, cronograma
con camino crítico). Backend en Python puro (sin dependencias externas),
frontend en HTML/CSS/JS.

## Correr en tu computadora (opcional, para probar)
```
python server.py
```
Abrí http://localhost:8000 en el navegador.

## Publicar en Railway (para usarla desde cualquier dispositivo)
Ver las instrucciones que te dio Claude en el chat.

## Importante sobre los datos
La base de datos (`obra.db`) se crea sola la primera vez que arranca el
servidor, con los datos reales del proyecto ya cargados (rubros, materiales).
Si el hosting no tiene un "Volume" persistente configurado, los datos podrían
perderse en un redeploy — pedile a Claude que te ayude a configurar el Volume
si vas a usar esto en serio.

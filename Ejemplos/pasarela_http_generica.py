"""Ejemplo OPCIONAL de pasarela local para estaciones con API JSON local.

Requiere Python 3, sin paquetes externos. NO sirve para estaciones sin API local.
Configurar variables de entorno antes de ejecutar:
  ESTACION_LOCAL_URL=http://192.168.1.50/api/current
  AGROALERTA_POST_URL=https://tu-dominio.com/api/estaciones/1/lecturas
  AGROALERTA_STATION_KEY=<clave entregada al registrar>

La estación debe devolver un JSON con nombres como temperatureC, humidityPct,
rainMm, windKmh, pressureHpa; adaptá el mapeo según el modelo real.
"""
import json
import os
import time
import urllib.request
from datetime import datetime, timezone

LOCAL_URL = os.environ.get('ESTACION_LOCAL_URL', '')
POST_URL = os.environ.get('AGROALERTA_POST_URL', '')
KEY = os.environ.get('AGROALERTA_STATION_KEY', '')


def main():
    if not (LOCAL_URL and POST_URL.startswith('https://') and KEY):
        raise SystemExit('Configurá ESTACION_LOCAL_URL, AGROALERTA_POST_URL HTTPS y AGROALERTA_STATION_KEY.')
    while True:
        try:
            with urllib.request.urlopen(LOCAL_URL, timeout=12) as response:
                local = json.load(response)
            # IMPORTANTE: estos nombres dependen del protocolo del fabricante.
            reading = {key: local[key] for key in
                       ('temperatureC', 'humidityPct', 'rainMm', 'windKmh', 'pressureHpa')
                       if key in local and local[key] is not None}
            if not reading:
                raise ValueError('La estación no devolvió variables reconocidas; revisá el mapeo de su modelo.')
            reading['timestamp'] = datetime.now(timezone.utc).isoformat()
            body = json.dumps(reading).encode('utf-8')
            request = urllib.request.Request(POST_URL, data=body, method='POST', headers={
                'Content-Type': 'application/json', 'X-Station-Key': KEY
            })
            with urllib.request.urlopen(request, timeout=20) as response:
                print(datetime.now().isoformat(timespec='seconds'), 'Enviado:', response.status)
        except Exception as exc:
            print(datetime.now().isoformat(timespec='seconds'), 'Error:', str(exc))
        time.sleep(300)


if __name__ == '__main__':
    main()

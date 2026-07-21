# Consumo de API Banxico - Tipo de Cambio FIX USD/MXN

Proyecto web en HTML, CSS y JavaScript que consume la API REST del Sistema de Informacion Economica de Banco de Mexico para visualizar la serie `SF43718` (tipo de cambio FIX).

## 1. Como ejecutar el proyecto

### Opcion A: abrir directamente
1. Abre `index.html` en tu navegador.
2. Esta opcion no levanta endpoints `/api/*`, por lo que no es la recomendada para el flujo actual.

### Opcion B: servidor local (recomendado)
Puedes usar cualquier servidor estatico. Ejemplo con Python:

```bash
python -m http.server 5500
```

Luego entra a:

```text
http://localhost:5500
```

### Opcion C: servidor local con proxy Banxico (recomendado si aparece error por CORS)

Si el navegador bloquea la consulta directa a Banxico, usa el servidor con proxy:

```bash
python dev_server.py
```

Luego entra a:

```text
http://127.0.0.1:5500
```

La aplicacion intentara primero consumo directo y, en localhost, hara fallback al proxy `/api/banxico` si la consulta del navegador falla.

## Despliegue en Netlify

Este proyecto ya incluye funciones serverless y redirects para Netlify:
- `netlify/functions/config.js`
- `netlify/functions/banxico.js`
- `netlify.toml`

Pasos:
1. Sube el proyecto a Netlify.
2. En **Site settings > Environment variables**, crea `BANXICO_TOKEN` con tu token real.
3. Haz **Redeploy** del sitio.
4. Verifica que `/api/config` responda `{ "hasToken": true }`.

## 2. Configuracion del token

- El token **no esta hardcodeado** en el codigo frontend.
- El token se toma desde variables de entorno del backend local (`dev_server.py`).
- Puedes configurarlo como:
  - variable de entorno `BANXICO_TOKEN`
  - o en archivo `.env` con `token=...` o `BANXICO_TOKEN=...`
- No subas el token real al repositorio ni a capturas publicas.

## 3. Endpoint utilizado

Se usa la serie:
- `SF43718` (FIX, MXN por USD)

Endpoints consumidos:
- Ultimo dato disponible:
  - `https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/oportuno?token=...`
- Rango de fechas para historico:
  - `https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/{fechaInicial}/{fechaFinal}?token=...`

Forma de autenticacion utilizada en frontend:
- El frontend nunca pide el token al usuario.
- El frontend llama al proxy local `/api/banxico`.
- El backend agrega el token como query param `token` al endpoint de Banxico (alineado al curl solicitado).

En la implementacion, el rango se calcula dinamicamente para buscar datos suficientes y mostrar los ultimos 30 registros disponibles.

## 4. Como se procesa la respuesta

1. Se consumen en paralelo el endpoint `oportuno` y el endpoint de rango.
2. Se valida que existan nodos esperados (`bmx.series[0].datos`).
3. Cada registro se transforma a un objeto de dominio:
   - `fecha` -> `Date`
   - `dato` -> `number` (conversion explicita)
4. Se ordenan los datos por fecha.
5. Se toman los ultimos 30 registros para grafica y metricas.
6. Se calculan:
   - Ultimo valor
   - Variacion porcentual vs anterior
   - Maximo
   - Minimo
   - Promedio

## 5. Biblioteca de graficas

- **Chart.js** (CDN) para construir la grafica de linea.

Incluye:
- Eje X: fecha
- Eje Y: tipo de cambio
- Tooltip con fecha y valor
- Titulo y unidad

## 6. Errores controlados

La interfaz contempla estos estados:
- Cargando informacion
- Informacion obtenida correctamente
- No se encontraron datos
- Error al consumir la API
- Token invalido o vencido

No se deja pantalla vacia ante errores.

## 7. Decisiones tecnicas

- Separacion por responsabilidades dentro de `app.js`:
  - Cliente de API
  - Mapeo y transformacion
  - Calculos
  - Renderizado UI
  - Orquestacion/controlador
- Se evita duplicar logica.
- Se valida existencia de datos antes de calcular.
- Se usa `async/await` y `fetch`.
- Se implementa boton **Actualizar datos** para refresco manual.

## 8. Mejoras con mas tiempo

1. Pruebas unitarias para mapper y calculos.
2. Internacionalizacion adicional de formatos.
3. Exportacion de datos a CSV.
4. Filtro de rango por seleccion de fechas en UI.
5. Proxy serverless (Netlify Function) para ocultar token en trafico cliente.

## 9. Uso de inteligencia artificial

Se utilizo IA como apoyo para:
- Estructurar el proyecto base.
- Revisar consistencia de validaciones y manejo de errores.
- Redactar documentacion tecnica.

El codigo fue revisado y ajustado manualmente para garantizar comprension y defensa tecnica durante la prueba.

## 10. Liga de despliegue

Pendiente de publicacion en Netlify.

Una vez desplegado, agrega aqui tu URL, por ejemplo:

```text
https://tu-proyecto.netlify.app/
```

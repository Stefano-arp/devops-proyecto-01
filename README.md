# DevOps Práctica — API REST de inventario

Proyecto académico de una API HTTP con **Node.js 22, Express y SQLite**. El alcance requerido es de **60 endpoints CRUD (12 recursos × 5 operaciones)** más `GET /api/health`; se complementa con pruebas Jest/Supertest, imagen Docker, CI/CD en GitHub Actions y despliegue blue/green en una instancia EC2 con Nginx.

> **Estado verificado localmente:** la versión actual registra 60 rutas CRUD y `GET /api/health`; `npm run test:coverage` pasó con 25 pruebas y 85,71 % de líneas (83,61 % sentencias; 82,35 % ramas; 83,33 % funciones). La imagen Docker se construyó localmente y se verificó HTTP 200 en `/api/health` y persistencia entre reinicios del contenedor. Docker Hub, GitHub Actions y EC2 todavía requieren configuración y verificación con cuentas reales; no se presentan como ejecutados.

## Arquitectura y contrato

```text
Cliente HTTP ──:80──> Nginx (EC2 Ubuntu) ──> 127.0.0.1:3001 o :3002
                                             └── Docker: Node.js 22 / Express :3000
                                                 └── /app/data/database.sqlite
                                                      ↕ bind mount
                                                     /opt/devops-practica/data
GitHub PR/push main ──> Actions: npm ci → tests + cobertura ≥70 %
GitHub push main ──> Docker Hub: :latest y :<github.sha> ──> SSH EC2 → deploy.sh
```

- Solo Nginx debe exponer el puerto 80; los dos puertos candidatos del host, 3001 y 3002, se publican **exclusivamente en `127.0.0.1`**. La aplicación escucha el puerto 3000 dentro del contenedor. No abrir 3000, 3001, 3002 ni el antiguo 6061 en el security group.
- La base se conserva fuera de las imágenes en `/opt/devops-practica/data/database.sqlite` (contenedor: `/app/data/database.sqlite`); el directorio debe ser escribible por el UID efectivo del proceso en Docker. No incluir archivos `.sqlite`, claves, `.env` ni reportes de cobertura en la imagen o el repositorio.
- `GET /api/health` debe devolver un HTTP exitoso **solo cuando el proceso está listo** para atender las peticiones requeridas. La comprobación del despliegue usa este endpoint tanto en el puerto candidato como a través de Nginx; que responda no demuestra por sí solo el correcto funcionamiento de todos los CRUD.
- `reporte.tex` documenta la metodología y tiene espacios marcados para resultados y capturas auténticos; no tomar sus figuras de ejemplo como pruebas.

### Matriz de rutas (objetivo: 12 × 5 = 60)

Para **cada** fila `R` se exponen estas cinco rutas bajo `/api`:

| Operación | Ruta | Propósito |
| --- | --- | --- |
| GET | `/api/R` | Listar |
| GET | `/api/R/:id` | Consultar por identificador |
| POST | `/api/R` | Crear con cuerpo JSON |
| PUT | `/api/R/:id` | Actualizar con cuerpo JSON |
| DELETE | `/api/R/:id` | Eliminar |

| R | R | R |
| --- | --- | --- |
| `items` | `users` | `categories` |
| `locations` | `departments` | `suppliers` |
| `brands` | `units` | `projects` |
| `loans` | `reservations` | `maintenance-records` |

Ejemplo: `GET /api/maintenance-records/1` consulta un registro y `DELETE /api/loans/1` elimina un préstamo. `GET /api/health` es **adicional**, no uno de los 60.

| Recurso | Campos JSON obligatorios | Opcionales |
| --- | --- | --- |
| `items` | `name` | — |
| `users` | `username` | — |
| `categories`, `departments`, `projects` | `name` | `description` |
| `locations` | `name` | `address` |
| `suppliers` | `name` | `email` |
| `brands` | `name` | — |
| `units` | `name` | `symbol` |
| `loans` | `item_id`, `user_id`, `due_date` | — |
| `reservations` | `item_id`, `user_id`, `reserved_for` | — |
| `maintenance-records` | `item_id`, `description`, `performed_at` | — |

Los textos no pueden estar vacíos y tienen un máximo de 200 caracteres; las fechas usan `YYYY-MM-DD`, y las referencias numéricas deben existir en `items` y `users`. Los campos no reconocidos se rechazan. `PUT` exige todos los campos obligatorios y actualiza únicamente los campos enviados (los opcionales omitidos conservan su valor). Respuestas: `200` lectura/actualización/eliminación, `201` creación, `400` petición inválida, `404` recurso ausente y `409` conflicto de integridad/referencia. El cuerpo habitual es `{ "statusCode": 200, "data": [...] }`. No hay autenticación de usuarios: este proyecto es una demostración académica y no se recomienda publicar datos personales o sensibles.

## Uso local y criterios de aceptación

Requisitos: Node.js **22**, npm y, para contenedores, Docker Engine. Desde la raíz del proyecto:

```bash
npm ci
npm test
npm run test:coverage
npm start
```

En otra terminal, después del arranque de la versión actualizada:

```bash
curl -i http://127.0.0.1:3000/api/health
curl -i http://127.0.0.1:3000/api/items
curl -i -X POST http://127.0.0.1:3000/api/items \
  -H 'Content-Type: application/json' -d '{"name":"Ejemplo"}'
```

Para crear un préstamo, primero crea un usuario con `POST /api/users` y toma los IDs reales de las respuestas; después envía `POST /api/loans` con, por ejemplo, `{ "item_id": 1, "user_id": 1, "due_date": "2026-11-10" }` (sustituye ambos IDs por los obtenidos). Un `409` indica que alguna referencia no existe.

Jest exige **70 % como mínimo en líneas, ramas, funciones y sentencias**; el resumen aparece en los logs y el proceso termina con error si falla un umbral. Las pruebas con Supertest usan SQLite aislada en memoria y una prueba de persistencia en un archivo temporal; nunca abren la BD de producción. `npm ci` requiere `package-lock.json` sincronizado. Por defecto `npm start` guarda datos en `data/database.sqlite`; en producción `DB_PATH=/app/data/database.sqlite`, `PORT=3000` y `APP_VERSION=<SHA>`. El socket TCP heredado está desactivado por defecto (`ENABLE_TCP=true` lo activa solo en loopback); no es parte de los 60 endpoints REST.

Ejemplo de construcción y ejecución local de la versión con ruta de base y puerto actualizados (usar un directorio de datos local creado expresamente, no la BD heredada de la raíz):

```bash
mkdir -p data
docker build -t devops-practica:local .
docker run --rm --name devops-practica-local \
  -p 127.0.0.1:3000:3000 \
  -v "$(pwd)/data:/app/data" \
  devops-practica:local
# En otra terminal: curl -i http://127.0.0.1:3000/api/health
```

Si no arranca, revisar `docker logs devops-practica-local`, permisos del directorio montado y correspondencia entre puerto/configuración del código y Dockerfile. No ejecutar simultáneamente otra aplicación que ya utilice el puerto 3000 del host.

## Preparación de servicios externos (no automatizable desde este documento)

### 1. GitHub y Docker Hub

1. Crear un repositorio **vacío** de GitHub propio y configurar sus Secrets y la EC2 antes del primer `push` a `main` (ese primer push ya intenta desplegar). Este directorio ya tiene un repositorio Git local iniciado en `main`: después de configurar los servicios, ejecutar `git remote add origin git@github.com:TU_USUARIO/TU_REPO.git`, `git add .`, `git status --short`, `git commit -m "Implementar API y CI/CD"` y `git push -u origin main`, sustituyendo usuario y repositorio. Revisar el estado antes del commit: nunca deben aparecer `rutas`, bases SQLite, respaldos, claves o el instalador Docker Desktop. Proteger `main` con la comprobación de CI como requisito para fusionar. `pull_request` y `push` a `main` ejecutan instalación reproducible, pruebas y cobertura. La publicación y el despliegue **solo** se disparan en `push` a `main` tras pasar CI; no se entregan secretos de producción a PR de colaboradores externos.
2. En Docker Hub, crear la cuenta y un repositorio de imágenes (por ejemplo, `DOCKERHUB_USERNAME/devops-practica`) con la visibilidad apropiada; generar un **access token** con los permisos necesarios para publicar, no usar la contraseña de la cuenta. Revisar que el nombre del repositorio en workflow, comando `docker pull` y script sea exactamente el mismo.
3. En GitHub, entrar a **Settings → Secrets and variables → Actions → New repository secret** (o crear secretos en un Environment protegido si el workflow lo utiliza). Registrar los seis valores siguientes sin introducirlos en archivos ni logs:

| Secret | Valor que debe aportar el operador |
| --- | --- |
| `DOCKERHUB_USERNAME` | Usuario/namespace real de Docker Hub |
| `DOCKERHUB_TOKEN` | Access token del usuario con permiso de push |
| `EC2_HOST` | DNS público o IP de la instancia, sin protocolo ni puerto |
| `EC2_USER` | Usuario SSH configurado en Ubuntu, usualmente `ubuntu` |
| `EC2_SSH_KEY` | **Clave privada completa** que corresponde a la clave pública autorizada en `~/.ssh/authorized_keys` del usuario de despliegue; conservar saltos de línea |
| `EC2_KNOWN_HOSTS` | Línea(s) `known_hosts` con clave pública SSH del servidor, **huella verificada** por canal confiable antes de guardarla; no desactivar `StrictHostKeyChecking` |

La variable `${{ github.sha }}` de GitHub Actions identifica el commit: se publica la **misma imagen** con etiquetas `:latest` y `:<github.sha>`; desplegar preferentemente por SHA (o digest) para evitar ambigüedad de `latest`. Confirmar en Docker Hub que ambas etiquetas apuntan a la compilación esperada. Rotar el token/clave si se exponen.

### 2. EC2 Ubuntu, red y acceso SSH

1. En AWS EC2, crear una instancia **Ubuntu Server** compatible con Docker (arquitectura de imagen y CPU coherentes), almacenamiento suficiente para imágenes, logs y backups; conservar el par de claves SSH de forma segura. Si se desea una dirección estable, asignar Elastic IP o DNS; los valores reales se aportan en secretos, **no** en este documento. Tener presente los costos de EC2/Elastic IP.
2. Crear el security group: permitir **TCP 80** al público que consultará la demo; permitir **TCP 22** únicamente a orígenes autorizados. Si el runner hospedado por GitHub no dispone de IP fija, planificar un acceso SSH seguro (runner propio o túnel/red controlada, o regla temporal acotada y retirada tras el despliegue); un `push` no podrá desplegar si el runner no alcanza el puerto 22. No abrir públicamente 3000/3001/3002 ni SQLite; para 443 se necesita TLS configurado aparte.
3. Desde un equipo autorizado, comprobar en la consola de AWS el DNS y la huella SSH del host **por canal confiable**. `ssh-keyscan` solo obtiene una clave, no certifica su identidad: comparar su huella `ssh-keygen -lf` con la verificada antes de usarla como `EC2_KNOWN_HOSTS`. Probar `ssh -i /ruta/a/clave ubuntu@<DNS_O_IP_EC2>` con permisos `chmod 600 /ruta/a/clave`. No copiar la clave privada a la instancia ni imprimirla en un workflow.
4. En una VM **Ubuntu nueva y dedicada**, instalar el paquete Docker Engine de los repositorios de Ubuntu junto con Nginx y curl (o seguir la [guía oficial de Docker](https://docs.docker.com/engine/install/ubuntu/) para usar sus paquetes, sin mezclar ambos orígenes). Habilitar servicios, preparar el volumen y conceder acceso a Docker al usuario SSH autorizado:

```bash
sudo apt update
sudo apt install -y docker.io nginx curl
sudo systemctl enable --now docker nginx
sudo install -d -o 1000 -g 1000 -m 750 /opt/devops-practica/data
sudo usermod -aG docker "$USER"
# Sal de SSH y vuelve a entrar para aplicar la nueva membresía al grupo.
docker info
sudo -n nginx -t
```

El UID 1000 corresponde al usuario `node` de la imagen prevista; comprobarlo con `docker image inspect`/`docker run id` si se cambia la imagen. En una VM ya utilizada, inspeccionar el propietario de `/opt/devops-practica/data` antes de modificar permisos; nunca aplicar `chmod 777` ni sobrescribir una base existente.

El usuario SSH que ejecuta `scripts/deploy.sh` debe tener acceso a Docker y `sudo -n` (sin contraseña) para las operaciones concretas del script: `install`, `ln`, `mv`, `rm`, `nginx -t` y `systemctl` sobre Nginx. Revisar detenidamente la política `sudoers` antes de habilitarla; conceder acceso al grupo `docker` equivale prácticamente a otorgar root. El workflow transmite el token Docker Hub al script por entrada estándar, que usa `docker login --password-stdin` con un directorio temporal de configuración; no mostrar secretos ni pasar el token como argumento de procesos.

### 3. Nginx y conmutación blue/green

El proyecto incluye `nginx/devops-practica.conf`, `nginx/blue.conf` y `nginx/green.conf`. En una VM **dedicada y nueva**, si Nginx conserva el sitio de ejemplo, ejecutar `sudo rm /etc/nginx/sites-enabled/default` y luego `sudo nginx -t && sudo systemctl reload nginx` **solo si no sirve otro sitio**. El primer despliegue instala el sitio administrado en `/etc/nginx/conf.d/devops-practica.conf` y los upstreams en `/opt/devops-practica/nginx/`. No instalar otra copia manualmente en `sites-available`: el script rechaza configuraciones parciales o diferentes. La configuración usa este patrón (consultar los archivos reales para todos los encabezados HTTP):

```nginx
server {
    listen 80 default_server;
    server_name _;
    include /opt/devops-practica/nginx/active.conf;
    location / {
        proxy_pass $devops_backend;
        proxy_set_header Host $host;
    }
}
```

`active.conf` es un enlace simbólico a `blue.conf` (`set $devops_backend http://127.0.0.1:3001;`) o `green.conf` (`:3002`). En la primera entrega **dejar que el script cree el enlace** tras validar al candidato; no se necesita arrancar Nginx con un upstream inexistente. Antes de cargar un cambio, comprobar `sudo nginx -t` y recargar con `sudo systemctl reload nginx`. Si Nginx ya tenía otro `default_server` en 80, resolver el conflicto sin alterar sitios ajenos. El script solo maneja su propio sitio y se niega a sobrescribir una configuración Nginx distinta; revisar `nginx/` y `scripts/deploy.sh` juntos antes de personalizar rutas.

Secuencia de `scripts/deploy.sh` invocado por `.github/workflows/main.yml`: detectar el enlace activo; descargar `DOCKERHUB_USERNAME/devops-practica:<github.sha>`; iniciar el color inactivo en `127.0.0.1:3001:3000` o `127.0.0.1:3002:3000`, siempre con `/opt/devops-practica/data:/app/data`; comprobar `http://127.0.0.1:<puerto-candidato>/api/health` con reintentos. Si falla, retirar el candidato sin cambiar el upstream. Si pasa, cambiar atómicamente `active.conf`, validar `nginx -t`, recargar y volver a comprobar `http://127.0.0.1:80/api/health`. Si falla después del cambio, volver al enlace anterior y retirar el candidato (si el rollback de Nginx falla, requiere intervención manual). Tras verificar el cambio, el script **detiene ordenadamente el contenedor anterior** (sin eliminarlo), conservando su imagen y su contenedor para un posible arranque manual si hace falta revertir después. Durante un fallo anterior a esa confirmación, el contenedor viejo permanece activo y el script revierte Nginx automáticamente. El próximo despliegue elimina el contenedor inactivo detenido para ocupar ese color. Los despliegues se serializan mediante un grupo de concurrencia del workflow. En el primer despliegue no hay color anterior al que volver.

**Límites y riesgos:** blue/green en **una sola máquina** no da alta disponibilidad ante caída de EC2/Nginx; la recarga puede afectar conexiones en curso. Durante la transición ambos procesos pueden abrir la misma SQLite: coordinar migraciones antes de cambiar tráfico; no ejecutar dos migradores concurrentes ni cambiar esquema de forma incompatible con la versión anterior. SQLite serializa escritores y puede devolver `SQLITE_BUSY`; la conexión configura `PRAGMA journal_mode=WAL` y `busy_timeout=5000`, pero deben medirse la carga y los errores reales antes de usarlo en producción. Hacer respaldos consistentes antes de migrar (API de backup de SQLite o parada/checkpoint apropiado; no copiar a ciegas solo el `.sqlite` si hay WAL), probar restauración y proteger backups. Revertir la imagen **no revierte el esquema ni los datos**. No montar el fichero de SQLite mediante NFS entre hosts para este diseño.

## Verificación y evidencia para la entrega

**Solo después de ejecutar realmente el pipeline/despliegue**, registrar fecha, commit SHA, ambiente y resultados en `reporte.tex`; reemplazar sus recuadros de figura por capturas originales, sin credenciales, tokens, claves ni datos sensibles. En tu terminal local (sin guardar el valor en archivos del repositorio): `export API_HOST='TU_DNS_O_IP_EC2'`, `curl -i "http://$API_HOST/api/health"`. Sustituir los marcadores en los demás ejemplos antes de ejecutarlos. Guion sugerido para una demo en vivo:

1. Mostrar PR y ejecución de Actions: pruebas y `npm run test:coverage` con umbral ≥70 % aprobado; indicar si hay etapas pendientes o fallidas. Comprobar que PR no publica imágenes ni accede a secretos de EC2.
2. Mostrar el `push` a `main` con el SHA específico y en Docker Hub las etiquetas `latest` y ese SHA.
3. En EC2, mostrar `docker ps` (puerto publicado a `127.0.0.1`), `sudo nginx -t` y el directorio de datos **sin revelar su contenido**. Desde el host consultar `curl -i http://127.0.0.1:3001/api/health` o `:3002/api/health` según activo.
4. Desde el cliente consultar `curl -i http://<DNS_O_IP_EC2>/api/health` y `curl -i http://<DNS_O_IP_EC2>/api/items`; demostrar un CRUD permitido en entorno de prueba y, si se realiza un segundo despliegue, verificar continuidad de un dato persistido y explicar el rollback. No publicar una IP real en el repositorio.

### Guion de demostración en vivo

1. **Antes del push:** abrir GitHub → **Actions**, Docker Hub → repositorio → **Tags**, una terminal con `curl http://<DNS_O_IP_EC2>/api/health` y otra con `docker ps -a` en EC2. Crear un item de prueba con `POST /api/items` y conservar su ID para verificar que los datos sobreviven.
2. Agregar **en la misma línea de la respuesta de `/api/health` en `index.js`** un campo `demo: 'Cambio en vivo'` sin quitar `message` ni `version`; la prueba actual verifica esos dos campos y seguirá funcionando. Ejecutar `npm run test:coverage`, `git add index.js`, `git commit -m "Demostracion de despliegue"` y `git push origin main`. El nuevo dato `demo` debe aparecer en la respuesta remota después del CD.
3. **Mientras se ejecuta:** capturar GitHub Actions → ejecución del SHA → job **test** con el resumen de cobertura; job **publish**; job **deploy** con el color final. Capturar Docker Hub → **Tags** mostrando `latest` y el SHA de ese mismo commit. No mostrar Secrets, archivos `.pem` ni el PAT.
4. **Al terminar:** capturar `curl -i http://<DNS_O_IP_EC2>/api/health` (`version` igual al SHA y `demo` presente), `docker ps -a` (nuevo color activo y anterior detenido) y `GET /api/items/<ID>` para constatar persistencia. En AWS Console capturar instancia y security group sin claves. En una terminal adicional repetir consultas a `/api/health` durante el push y anotar cualquier respuesta diferente de `200`: el objetivo es documentar la continuidad, no afirmar que se probó sin medirla. El primer despliegue no dispone de versión anterior.
5. Incorporar las capturas auténticas en `figuras/`, explicar el proceso y el resultado de cada figura, completar portada y tabla de resultados en `reporte.tex` y compilar el PDF. Entregar al docente el enlace GitHub, la URL pública de EC2 y el PDF por el canal indicado, no como valores fijos del código público.

Antes de entregar, completar las macros de portada en `reporte.tex` y colocar el logotipo autorizado en `figuras/logo-institucional.png`. Guardar capturas reales en `figuras/`, sustituir los recuadros `\capturaPendiente{...}` por `\includegraphics[width=.9\linewidth]{figuras/archivo.png}` y actualizar la tabla de resultados con enlaces/fechas/SHA. No hay capturas ni URL pública de un despliegue verificadas todavía; las cifras locales de cobertura sí están medidas. Para generar el PDF, con una distribución LaTeX que incluya `babel`, `hyperref` y `graphicx`, usar `pdflatex reporte.tex` dos veces (segunda pasada para referencias), `latexmk -pdf reporte.tex` o compilar `reporte.tex` en Overleaf. En esta máquina no hay compilador LaTeX; el PDF y la inserción de evidencias son pasos externos. Los archivos auxiliares del compilador no deben añadirse a Git.

## Lecturas oficiales

- GitHub Actions: https://docs.github.com/en/actions
- Docker Build y GitHub Actions: https://docs.docker.com/build/ci/github-actions/
- Nginx, `proxy_pass`: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- SQLite, concurrencia/WAL: https://www.sqlite.org/wal.html
- AWS EC2, reglas de acceso: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/authorizing-access-to-an-instance.html

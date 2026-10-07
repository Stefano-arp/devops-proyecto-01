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

## Configuración pendiente: servicios externos

> **Estado de Git:** `main` ya está conectado a `origin/main` y el código está comprometido en el primer commit. **No ejecutes `git init` ni `git remote add origin` de nuevo.** Si el primer workflow aparece rojo por falta de Secrets o EC2, configura primero los servicios descritos aquí; después crea y envía un **nuevo commit** para volver a disparar CI/CD. Nunca publiques las credenciales para intentar corregirlo.

### 1. GitHub y Docker Hub

1. Revisar GitHub → pestaña **Actions** → primer workflow: debe ejecutar el job `test`; los jobs `publish` y `deploy` necesitan Secrets y EC2. Proteger `main` con el job `test` como comprobación obligatoria para fusionar PR, si el plan de GitHub lo permite. `pull_request` y `push` a `main` ejecutan CI; **solo el push** publica y despliega después de aprobar las pruebas. No proporcionar Secrets a PR de colaboradores externos.
2. En Docker Hub: **Repositories → Create repository**, nombre exacto `devops-practica` dentro de tu usuario/namespace; para simplificar la demo elegir visibilidad **Public**. Después ir a **Account settings → Personal access tokens → Generate new token** y generar uno con permiso de lectura/escritura. Copiarlo una sola vez a un gestor de contraseñas; **no** compartirlo aquí ni usar la contraseña de la cuenta. El nombre del repositorio debe coincidir con `.github/workflows/main.yml` y `scripts/deploy.sh`.
3. **Después de preparar la EC2 y verificar su huella SSH en la sección 2**, volver a GitHub → repositorio → **Settings → Secrets and variables → Actions → New repository secret**. Registrar los seis valores siguientes sin introducirlos en archivos ni logs; crear **Repository secrets**, pues el workflow actual no declara un Environment:

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

1. En **AWS → EC2 → Launch instance**, elegir **Ubuntu Server 24.04 LTS x86_64** (coincide con la imagen amd64 publicada por el workflow), tipo con memoria suficiente para Docker/Nginx —por ejemplo, **t3.small, 2 GiB**, sujeto a disponibilidad y costo— y **al menos 20 GiB** de EBS para imágenes y datos de esta práctica. Seleccionar o crear un key pair RSA/ED25519 descargando el `.pem` solo en tu equipo; crear/seleccionar el security group del paso siguiente. Confirmar que la instancia tiene IP/DNS público y salida a Internet. Si quieres dirección estable, estudiar Elastic IP y sus cargos; guardar la dirección **solo** en Secrets, no en el repositorio. Si usas IP pública temporal y cambia al detener/iniciar la VM, actualizar `EC2_HOST` y volver a verificar el host de `EC2_KNOWN_HOSTS`. Detener/eliminar recursos al acabar para evitar costos.
2. En **EC2 → Security Groups → Inbound rules**, permitir **TCP 80 desde 0.0.0.0/0** para la demostración y **TCP 22** desde el origen del operador y del runner que realizará el deploy; permitir salida HTTPS (443) para obtener las imágenes. **Importante:** restringir SSH a «Mi IP» permite entrar desde tu PC, **pero bloquea a un GitHub-hosted runner**, que normalmente sale por otra IP variable. Para la demostración académica puedes habilitar **temporalmente** TCP 22 desde 0.0.0.0/0 con autenticación estricta por clave y retirarlo al finalizar; eso aumenta el riesgo y los despliegues posteriores dejarán de funcionar hasta reabrir el acceso. Para despliegue continuo con SSH más seguro, usar runner propio/bastión con IP fija y limitar 22 a esa IP. No abrir públicamente 3000, 3001, 3002 ni 6061. Esta API usa HTTP, no HTTPS; no transmitir información sensible.
3. En EC2 → **Instances → tu instancia**, copiar el DNS/IP pública; guardarla **solo** en el Secret `EC2_HOST`. En tu PC sustituir los marcadores y recoger la clave pública SSH del servidor:

```bash
export EC2_HOST='TU_DNS_O_IP_EC2'
export PEM="$HOME/Downloads/TU_CLAVE.pem"
chmod 600 "$PEM"
ssh-keyscan -T 5 -t ed25519 "$EC2_HOST" > "$HOME/ec2_known_hosts"
ssh-keygen -lf "$HOME/ec2_known_hosts"
```

**Antes de confiar en esa clave o entrar por SSH**, comparar la huella mostrada con la del servidor obtenida por un canal independiente y confiable (por ejemplo, consola/Session Manager de AWS, si está disponible, ejecutando allí `sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`). `ssh-keyscan` no verifica por sí solo la identidad; si no puedes validar la huella, consulta al administrador de AWS antes de guardar el Secret. Tras confirmarla:

```bash
ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$HOME/ec2_known_hosts" \
  -i "$PEM" "ubuntu@$EC2_HOST"
```

Copiar el **contenido completo de `ec2_known_hosts`** al Secret `EC2_KNOWN_HOSTS`. El Secret `EC2_SSH_KEY` contiene el PEM completo, incluidos encabezado, pie y saltos de línea; el workflow usa SSH no interactivo, por lo que una clave con passphrase requiere adaptar el workflow/ssh-agent. No copiar la clave privada a EC2 ni imprimirla en Actions.
4. En una VM **Ubuntu nueva y dedicada**, instalar el paquete Docker Engine de los repositorios de Ubuntu junto con Nginx y curl (o seguir la [guía oficial de Docker](https://docs.docker.com/engine/install/ubuntu/) para usar sus paquetes, sin mezclar ambos orígenes). Habilitar servicios, preparar el volumen y conceder acceso a Docker al usuario SSH autorizado:

```bash
sudo apt update
sudo apt install -y docker.io nginx curl
sudo systemctl enable --now docker nginx
sudo install -d -o 1000 -g 1000 -m 750 /opt/devops-practica/data
sudo usermod -aG docker "$USER"
# Ahora sal de SSH y vuelve a entrar para aplicar la nueva membresía al grupo.
```

En la nueva sesión SSH:

```bash
docker info
sudo -n true
sudo -n nginx -t
```

**Los tres comandos deben funcionar** sin pedir contraseña para que el deploy no interactivo pueda continuar. Si `sudo -n true` falla, ajustar explícitamente permisos de despliegue con el administrador de la instancia: el job remoto es no interactivo y no puede introducir una contraseña.

El UID 1000 corresponde al usuario `node` de la imagen prevista; comprobarlo con `docker image inspect`/`docker run id` si se cambia la imagen. En una VM ya utilizada, inspeccionar el propietario de `/opt/devops-practica/data` antes de modificar permisos; nunca aplicar `chmod 777` ni sobrescribir una base existente.

El usuario SSH que ejecuta `scripts/deploy.sh` debe tener acceso a Docker y `sudo -n` (sin contraseña) para las operaciones concretas del script: `install`, `ln`, `mv`, `rm`, `nginx -t` y `systemctl` sobre Nginx. Revisar detenidamente la política `sudoers` antes de habilitarla; conceder acceso al grupo `docker` equivale prácticamente a otorgar root. El workflow transmite el token Docker Hub al script por entrada estándar, que usa `docker login --password-stdin` con un directorio temporal de configuración; no mostrar secretos ni pasar el token como argumento de procesos.

### 3. Nginx y conmutación blue/green

El proyecto incluye `nginx/devops-practica.conf`, `nginx/blue.conf` y `nginx/green.conf`. **Solo en una VM nueva dedicada que no sirve otros sitios**, ejecutar en EC2:

```bash
if [ -L /etc/nginx/sites-enabled/default ]; then sudo rm /etc/nginx/sites-enabled/default; fi
sudo nginx -t
sudo systemctl reload nginx
```

El primer despliegue instala automáticamente el sitio administrado en `/etc/nginx/conf.d/devops-practica.conf` y los upstreams en `/opt/devops-practica/nginx/`. No instalar otra copia manualmente en `sites-available`: el script rechaza configuraciones parciales o diferentes. La configuración usa este patrón (consultar los archivos reales para todos los encabezados HTTP):

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

### 4. Activar el primer despliegue completo (Git ya conectado)

**Orden:** primero confirmar Docker Hub, EC2, security group, Nginx y los seis Secrets. El primer commit ya está en `origin/main`; si el workflow inicial falló por falta de credenciales, **no hace falta borrar ni recrear el repositorio**. Desde tu PC, en la raíz de este proyecto, enviar un nuevo commit:

```bash
npm ci
npm run test:coverage
git status --short                  # revisar qué archivos van a publicarse
git add README.md .gitignore         # guía y exclusiones; no claves ni bases SQLite
git commit -m "Documentar despliegue y entrega"
git push origin main
git rev-parse HEAD                   # anotar el SHA exacto para compararlo
```

Si cambias otros archivos legítimos, agrégalos explícitamente después de revisar `git status --short`; nunca agregues `.pem`, `.env`, archivos SQLite ni `rutas`. En **GitHub → Actions → ejecución de ese SHA** verificar los jobs en orden `test` → `publish` → `deploy`, todos verdes. En **Docker Hub → Repositories → devops-practica → Tags**, buscar `latest` y el tag con ese SHA. Desde tu PC, con `API_HOST` definido como se explica más adelante:

```bash
curl -fsS -i "http://$API_HOST/api/health"
curl -fsS -i "http://$API_HOST/api/items"
```

La respuesta de salud debe mostrar `version` igual al SHA del push. En EC2, `docker ps -a --filter label=app=devops-practica` debe mostrar el contenedor nuevo activo y, tras un **segundo** despliegue, el anterior detenido; `sudo nginx -t` debe indicar configuración válida. Si `test` falla, repetir `npm ci && npm run test:coverage` localmente; si `publish` falla, revisar nombre del repositorio y permiso del PAT sin imprimirlo; si `deploy` falla, revisar **Security Group TCP 22 desde el runner**, el usuario/clave/huella SSH, `docker info`, `sudo -n true` y `sudo nginx -t`. No ejecutar a mano `scripts/deploy.sh` sin suministrar las tres líneas esperadas por entrada estándar.

## Verificación y evidencia para la entrega

**Solo después de ejecutar realmente el pipeline/despliegue**, registrar fecha, commit SHA, ambiente y resultados en `reporte.tex`; reemplazar sus recuadros de figura por capturas originales, sin credenciales, tokens, claves ni datos sensibles. En tu terminal local (sin guardar el valor en archivos del repositorio): `export API_HOST='TU_DNS_O_IP_EC2'`, `curl -i "http://$API_HOST/api/health"`. Sustituir los marcadores en los demás ejemplos antes de ejecutarlos. Guion sugerido para una demo en vivo:

1. Mostrar PR y ejecución de Actions: pruebas y `npm run test:coverage` con umbral ≥70 % aprobado; indicar si hay etapas pendientes o fallidas. Comprobar que PR no publica imágenes ni accede a secretos de EC2.
2. Mostrar el `push` a `main` con el SHA específico y en Docker Hub las etiquetas `latest` y ese SHA.
3. En EC2, mostrar `docker ps` (puerto publicado a `127.0.0.1`), `sudo nginx -t` y el directorio de datos **sin revelar su contenido**. Desde el host consultar `curl -i http://127.0.0.1:3001/api/health` o `:3002/api/health` según activo.
4. Desde el cliente consultar `curl -i http://<DNS_O_IP_EC2>/api/health` y `curl -i http://<DNS_O_IP_EC2>/api/items`; demostrar un CRUD permitido en entorno de prueba y, si se realiza un segundo despliegue, verificar continuidad de un dato persistido y explicar el rollback. No publicar una IP real en el repositorio.

### Guion de demostración en vivo

En una terminal separada, con `API_HOST` configurado, comenzar **antes del push** esta medición y detenerla después con `Ctrl+C`; anotar cualquier código distinto de `200` (incluido `000` por falta de conexión):

```bash
while true; do
  printf '%s ' "$(date +%T)"
  curl -sS -o /dev/null -w '%{http_code}\n' --max-time 2 "http://$API_HOST/api/health" || echo FALLO
  sleep 0.5
done
```

1. **Antes del push:** abrir GitHub → **Actions**, Docker Hub → repositorio → **Tags**, una terminal con `curl http://<DNS_O_IP_EC2>/api/health` y otra con `docker ps -a` en EC2. Crear un item de prueba con `POST /api/items` y conservar su ID para verificar que los datos sobreviven.
2. Agregar **en la misma línea de la respuesta de `/api/health` en `index.js`** un campo `demo: 'Cambio en vivo'` sin quitar `message` ni `version`; la prueba actual verifica esos dos campos y seguirá funcionando. Ejecutar `npm run test:coverage`, `git add index.js`, `git commit -m "Demostracion de despliegue"` y `git push origin main`. El nuevo dato `demo` debe aparecer en la respuesta remota después del CD.
3. **Mientras se ejecuta:** capturar GitHub Actions → ejecución del SHA → job **test** con el resumen de cobertura; job **publish**; job **deploy** con el color final. Capturar Docker Hub → **Tags** mostrando `latest` y el SHA de ese mismo commit. No mostrar Secrets, archivos `.pem` ni el PAT.
4. **Al terminar:** capturar `curl -i http://<DNS_O_IP_EC2>/api/health` (`version` igual al SHA y `demo` presente), `docker ps -a` (nuevo color activo y anterior detenido) y `GET /api/items/<ID>` para constatar persistencia. En AWS Console capturar instancia y security group sin claves. En una terminal adicional repetir consultas a `/api/health` durante el push y anotar cualquier respuesta diferente de `200`: el objetivo es documentar la continuidad, no afirmar que se probó sin medirla. El primer despliegue no dispone de versión anterior.
5. Incorporar las capturas auténticas en `figuras/`, explicar el proceso y el resultado de cada figura, completar portada y tabla de resultados en `reporte.tex` y compilar el PDF. Entregar al docente el enlace GitHub, la URL pública de EC2 y el PDF por el canal indicado, no como valores fijos del código público.

### Capturas y generación del PDF

1. Completar en las líneas iniciales de `reporte.tex` las macros `\Institucion`, `\Programa`, `\Asignatura`, `\Docente`, `\Integrantes`, `\Grupo` y `\LugarFecha`. Sustituir los corchetes por datos reales. Con permiso institucional, colocar el logotipo como `figuras/logo-institucional.png`.
2. Crear `figuras/` y guardar **capturas auténticas** como `pruebas.png` (salida de Jest), `actions.png` (jobs/SHA), `dockerhub.png` (tags) y `despliegue.png` (HTTP y contenedores). En cada figura de `reporte.tex` cambiar `\capturaPendiente{...}` por `\includegraphics[width=.9\linewidth]{figuras/archivo.png}` con el nombre correspondiente. Mantener `\caption{...}` y explicar en el párrafo próximo **cómo** se obtuvo la imagen y **qué resultado** demuestra. No incluir Secrets ni claves; registrar SHA, fecha y enlace de ejecución cuando existan.
3. Compilar desde tu PC **Linux** (no es necesario instalar LaTeX en EC2). En Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y texlive-latex-base texlive-latex-recommended texlive-lang-spanish texlive-fonts-recommended
pdflatex -interaction=nonstopmode -halt-on-error reporte.tex
pdflatex -interaction=nonstopmode -halt-on-error reporte.tex
```

Como alternativa, subir `reporte.tex` y la carpeta `figuras/` a **Overleaf**, pulsar **Recompile** y descargar el PDF. En esta máquina aún no está instalado LaTeX y la portada/capturas externas dependen de tus datos; `reporte.pdf` se entrega aparte y está ignorado por Git. No presentar el PDF mientras conserve el texto «CAPTURA PENDIENTE». Verificar que la introducción ocupa al menos una página completa, el texto está justificado, las figuras están enumeradas, la conclusión tiene al menos dos párrafos y se citan al menos tres fuentes.

## Lecturas oficiales

- GitHub Actions: https://docs.github.com/en/actions
- Docker Build y GitHub Actions: https://docs.docker.com/build/ci/github-actions/
- Nginx, `proxy_pass`: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- SQLite, concurrencia/WAL: https://www.sqlite.org/wal.html
- AWS EC2, reglas de acceso: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/authorizing-access-to-an-instance.html

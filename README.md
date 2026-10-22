# Ferrodistribuciones · Pedidos

Aplicación web para ventas, bodega, verificación, despacho, contabilidad y gerencia. Se instala en el celular y en el computador como una aplicación, y funciona sobre el plan gratuito de Cloudflare.

## Qué incluye

- Usuario y clave por persona. Gerencia crea los usuarios, asigna los roles, restablece claves y bloquea accesos.
- La primera vez que alguien entra, y cada vez que gerencia restablece su clave, la persona debe crear una clave propia.
- Tras 5 intentos fallidos, el usuario queda bloqueado 15 minutos.
- El servidor valida cada permiso.
- La auditoría no se puede modificar ni borrar desde la aplicación.
- Ciclo completo del pedido:
  - precios de lista o precio nuevo con aprobación de gerencia;
  - bodega con incidencias y traslados;
  - verificación;
  - despacho con descuento de existencias;
  - remisión en PDF.
- Avisos para cada área, entre ellos cuando un producto queda con 2 o menos. Llegan al celular o al computador como notificaciones, aunque la aplicación esté cerrada, sin costo y sin servicios externos.
- Carga y actualización de la lista de precios desde el Excel, con historial de cada cambio de precio.
- Exportación de pedidos a Excel (CSV) y respaldo completo en un archivo.

## Publicarla por primera vez

### 1. Crear las cuentas (gratis)

1. **GitHub:** crea una cuenta en https://github.com. Luego crea un repositorio **privado** llamado `ferrodistribuciones`.
2. **Cloudflare:** crea una cuenta en https://dash.cloudflare.com/sign-up.

### 2. Subir el código a GitHub

Sube todo el contenido de esta carpeta al repositorio. No subas `node_modules` ni `.wrangler`.

### 3. Conectar GitHub con Cloudflare

1. En Cloudflare, entra a **Workers y Pages** y elige **Crear**.
2. Elige **Importar un repositorio**, conecta tu cuenta de GitHub y selecciona `ferrodistribuciones`.
3. El nombre del proyecto debe ser exactamente `ferrodistribuciones`, igual al de `wrangler.jsonc`.
4. Deja el comando de despliegue como `npx wrangler deploy` y pulsa **Desplegar**.

La base de datos se crea sola en el primer despliegue. Desde ese momento, cada cambio que se suba a GitHub se publica automáticamente.

### 4. Crear el código de instalación

Sirve una sola vez, para crear el primer usuario de gerencia.

1. En Cloudflare abre el Worker `ferrodistribuciones` y entra a **Configuración → Variables y secretos**.
2. Agrega una variable de tipo **Secreto** llamada `SETUP_CODE`.
3. Como valor, pon una frase que solo tú conozcas.

### 5. Instalar

1. Abre la dirección que te da Cloudflare, terminada en `.workers.dev`.
2. Escribe el código de instalación, tu nombre, tu usuario y tu clave. Así se crea el usuario de gerencia.
3. En **Precios**, sube el Excel de la lista de precios.
4. En **Equipo**, crea a cada persona con su rol y una clave temporal, y entrégasela en privado.
5. Después de instalar, puedes borrar el secreto `SETUP_CODE`. La instalación ya no se puede repetir porque ya hay usuarios.

## Instalarla como aplicación

- **Android (Chrome):** menú ⋮ → **Instalar aplicación** o **Agregar a la pantalla principal**.
- **iPhone (Safari):** botón Compartir → **Agregar a inicio**.
- **Computador (Chrome o Edge):** ícono de instalar en la barra de direcciones.

## Avisos en el celular

Cada persona activa los avisos en su propio dispositivo con el botón **Activar avisos**. El botón aparece al entrar y también en la pestaña **Avisos**.

- **Android y computador:** funciona en Chrome y Edge.
- **iPhone:** primero hay que agregar la aplicación a la pantalla de inicio y abrirla desde ese ícono. Después se activan los avisos.

Los avisos llegan según el rol. Bodega recibe los pedidos nuevos, el vendedor recibe las respuestas a sus precios, y gerencia y bodega reciben las existencias bajas. Quien hace la acción no recibe su propio aviso. Al tocar el aviso se abre el pedido.

Al salir de la aplicación con **Salir**, ese dispositivo deja de recibir avisos. Así un celular compartido no recibe los avisos de otra persona.

## Copias de seguridad

- **Respaldo completo:** en **Auditoría**, gerencia tiene el botón **Descargar respaldo completo**. Descarga un archivo con todos los datos, excepto las claves. Guárdalo cada semana en un lugar seguro.
- **Recuperación en Cloudflare:** Cloudflare guarda 7 días de recuperación de la base de datos (Time Travel).

## Si algo falla

- **La base de datos no se creó sola:**
  1. En Cloudflare, ve a **Almacenamiento y bases de datos → D1**.
  2. Crea una base de datos llamada `ferrodistribuciones-db`.
  3. En el Worker, ve a **Configuración → Vínculos** y agrega D1 con el nombre de variable `DB`.
  4. Vuelve a desplegar.
- **Error de "límite de CPU" al entrar:** el plan gratuito da muy poco tiempo por solicitud. Agrega la variable `PBKDF2_ITER` con el valor `10000`. La otra opción es pasar al plan Workers Paid.
- **Más seguridad en las claves:** si pasan al plan pago, sube `PBKDF2_ITER` a `100000`. Las claves se refuerzan solas cuando cada persona vuelve a entrar.

## Límites del plan gratuito de Cloudflare

| Recurso | Límite |
| --- | --- |
| Solicitudes al día | 100.000 |
| Tamaño de la base de datos | 500 MB |
| Lecturas de filas al día | 5 millones |
| Escrituras de filas al día | 100.000 |

Para un equipo pequeño sobra. Si se queda corto, el plan Workers Paid cuesta desde US$5 al mes.

## Para desarrolladores

```
npm install
echo "SETUP_CODE=prueba123" > .dev.vars
npx wrangler dev
```

- `src/index.js`: servidor, reglas de negocio y permisos.
- `public/`: la aplicación (pantallas, estilos, íconos y archivos para instalarla).

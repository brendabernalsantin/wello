# Wello: reconstrucción funcional

Se sigue el prompt maestro recibido: primero Gym, luego producto integrado local y variante estática con preparación Supabase. No se publicarán ni se introducirán cargas personales en los assets públicos. No se cambiarán cuentas, permisos reales ni repositorios externos sin configuración y confirmación.

## Implementación
JavaScript ES modules y CSS sin framework, empaquetados con esbuild. `src/core.js` contiene persistencia, migración, ámbitos y utilidades. `src/modules/` contiene dominio y vistas. `src/app.js` integra navegación, Inicio, hogares y Mis datos. `scripts/` exporta un HTML con código y assets embebidos y genera `dist/` para Pages; Node sirve Preview. `tests/` contiene pruebas con node:test y pruebas de interacción automatizadas. `supabase/` contiene migraciones SQL y casos RLS; Google usa exclusivamente SDK oficial en la variante online. La compilación sin servicios se rotula vista previa local; producción exige configuración pública válida.

## Diseño derivado de tus imágenes
Estética de bienestar colorida y amigable, tarjetas amplias redondeadas y tipografía sans gruesa. Tinta oscura y fondos suaves; menta en Inicio, rosa en Hábitos, amarillo en Mascotas, aqua en Alimentos y lavanda consistente en Gym. Barra lateral limpia en escritorio y seis destinos visibles abajo en móvil. Bloques asimétricos, bienvenida menta y pequeños motivos florales; caritas exclusivamente recortadas de la referencia aportada. Iconos Icons8 locales con atribución. Interacciones cortas con mensajes de guardado real, foco visible, controles grandes y movimiento sutil desactivado con reducción de movimiento. Wello es cálida, práctica y personal: «Pequeños pasos, a tu ritmo» y «Hoy también cuenta». Marca en minúsculas con terminales redondeados y acento menta.

## Alcance verificable
Paridad local: sesiones parciales Gym, cantidades hábitos y mood, perfiles y registros mascotas, inventario y compras, estimados, calendario e ICS, hogares aislados, copias e importación y ruta NFC. Preparación online: Auth PKCE, separación de caché por cuenta, modelo hogares y RLS, operaciones idempotentes y concurrencia explícita. Lo dependiente de Google/Supabase, invitaciones reales, permisos, publicación o iPhone físico se describe como pendiente, no como verificado.

## Revisión solicitada el 3 de noviembre (v2)

Se conserva el almacenamiento v3 y se añaden campos opcionales sin borrar registros. Hábitos pasa a lista compacta con icono, nombre y check; un diálogo de detalle contiene meta, semana, cantidades y edición. El selector de iconos usa dibujos visibles, etiquetas accesibles y borde de selección, no un menú de nombres. La frecuencia muestra sólo días semanales, intervalo o calendario mensual según la opción; el día mensual se toma de una fecha real y previsualiza la siguiente ocurrencia (por ejemplo 3 de diciembre después del 3 de noviembre). Las metas cuantitativas mantienen captura explícita.

Mascotas añade sexo y foto local raster reducida proporcionalmente para guardado autocontenido; el archivo original no se publica ni se conserva completo. Se puede cambiar o quitar la foto. En hembras, el seguimiento registra inicio y final opcional del celo, notas, duración e intervalo observado, sin predicciones clínicas. Sin final registrado sólo se muestra el inicio en Calendario; no se infiere una duración. Se conserva historial si se cambia el sexo. Trucos ofrece registrar una práctica desde su catálogo enlazada a una actividad real. Agregar actividad abre una selección visual y después un formulario específico (vacuna, paseo, entrenamiento, alimentación, baño; cuidados y celo según perfil), sin campos inconexos ni títulos obligatorios redundantes.

Calendario usa los colores de cada módulo y, para hábitos, la muestra elegida para ese hábito; los iconos ayudan a distinguir. Exportar al iPhone ofrece un filtro explícito dentro del diálogo, independiente del filtro visible, además del mes y consentimiento separado para moods/notas. No se cambia la configuración ni se publica en servicios externos.

## Fase familiar online aprobada · 3 noviembre 2026

Repositorio nuevo brendabernalsantin/wello conectado y cambiado a público con autorización explícita de la propietaria para usar Pages gratuito. Supabase Wello en brendabernalsantin's Org creado tras aceptar $0/mes, activo y con esquema aplicado y fixture de permisos real con rollback. No planes de pago ni extras autorizados. Frontend estático GitHub Pages por rama, workflow como plantilla fuera de .github/workflows por permisos actuales. No se publican datos de usuarios. Google y los ajustes finales de Pages se guían desde el navegador de la propietaria, quien no desea toma de control.

Owner crea, renombra e invita por enlace ligado al correo confirmado, caducidad7d y uso único; revoca y retira miembros. Miembros editan mascotas, fotos/celo, alimentos y hábitos hogar, pueden salir; no administran permisos ni pueden dejar hogar sin owner. Gym, moods, citas y hábitos personales privados.

Cloud coordina Auth Google, descubrimiento real por membresía, mapeos persistidos por cuenta y sync automática tras edición, al volver y cada15s visible. SQL RPC bloquea carreras e idempotencia; CAS por revisión; escritura directa blobs denegada. Fusión3vías recursiva por IDs para cambios distintos, mismos valores conflictivos requieren decisión explícita y respaldo previo. Logout/cambio cuenta cancela tareas y oculta datos; revocación oculta hogar; remoto no cierra modal ni dispara edición. Importación desde local siempre explícita.

Estructura de ampliación: cloud.js controla, cloud-domain.js y cloud-sync.js reglas puras; modules/households.js UI conectada por contrato docs/cloud-contract.md a app.js. Migraciones reproducibles y fixtures RLS rollback real. Pruebas mocks se distinguen de Supabase real y Google con usuarios. Google OAuth exige ClientID/Secret de propietaria y callbacks exactos; no inventar autenticación real. Publicación solo tras comprobar seguridad y configuración.

## Acceso web obligatorio · 12 noviembre 2026

La propietaria confirmó el acceso real Google mediante captura y solicita que la web no deje ver módulos antes de iniciar sesión. En production la plantilla arranca bloqueada desde el HTML/CSS inicial, con una pantalla de acceso dedicada no descartable. Cloud habilita los módulos sólo tras cargar el namespace de la cuenta; logout/cambio/pérdida bloquean inmediatamente. Se quitan entradas de modo local y se protegen acciones/guardados; el HTML descargable independiente conserva su modo local. NFC/invitaciones siguen pendientes hasta el acceso. Es un control de interfaz sobre una web estática; el código permanece público, y los datos remotos siguen protegidos por RLS.

## Pulido de Inicio autorizado · 12 noviembre 2026, 13:49

La usuaria cambia la recopilación por implementación inmediata sólo para Inicio: retirar los cinco textos indicados, corregir el tono verdoso de la ilustración existente sin reemplazarla, mostrar hasta cuatro hábitos y un acceso inferior a todos, y priorizar pendientes sobre realizados antes de limitar la vista. Reutilizar los mismos checks/cantidades y registros. Mascotas/trucos y Calendario/cumplimiento/colores permanecen únicamente como pendientes de revisión y no se implementan en esta actualización. El bloqueo Google de la versión publicada se conserva.

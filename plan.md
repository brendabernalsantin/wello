# Wello: reconstrucción funcional

Se sigue el prompt maestro recibido: primero Gym, luego producto integrado local y variante estática con preparación Supabase. No se publicarán ni se introducirán cargas personales en los assets públicos. No se cambiarán cuentas, permisos reales ni repositorios externos sin configuración y confirmación.

## Implementación
JavaScript ES modules y CSS sin framework, empaquetados con esbuild. `src/core.js` contiene persistencia, migración, ámbitos y utilidades. `src/modules/` contiene dominio y vistas. `src/app.js` integra navegación, Inicio, hogares y Mis datos. `scripts/` exporta un HTML con código y assets embebidos y genera `dist/` para Pages; Node sirve Preview. `tests/` contiene pruebas con node:test y pruebas de interacción automatizadas. `supabase/` contiene migraciones SQL y casos RLS; Google usa exclusivamente SDK oficial en la variante online. La compilación sin servicios se rotula vista previa local; producción exige configuración pública válida.

## Diseño derivado de tus imágenes
Estética de bienestar colorida y amigable, tarjetas amplias redondeadas y tipografía sans gruesa. Tinta oscura y fondos suaves; menta en Inicio, rosa en Hábitos, amarillo en Mascotas, aqua en Alimentos y lavanda consistente en Gym. Barra lateral limpia en escritorio y seis destinos visibles abajo en móvil. Bloques asimétricos, bienvenida menta y pequeños motivos florales; caritas exclusivamente recortadas de la referencia aportada. Iconos Icons8 locales con atribución. Interacciones cortas con mensajes de guardado real, foco visible, controles grandes y movimiento sutil desactivado con reducción de movimiento. Wello es cálida, práctica y personal: «Pequeños pasos, a tu ritmo» y «Hoy también cuenta». Marca en minúsculas con terminales redondeados y acento menta.

## Alcance verificable
Paridad local: sesiones parciales Gym, cantidades hábitos y mood, perfiles y registros mascotas, inventario y compras, estimados, calendario e ICS, hogares aislados, copias e importación y ruta NFC. Preparación online: Auth PKCE, separación de caché por cuenta, modelo hogares y RLS, operaciones idempotentes y concurrencia explícita. Lo dependiente de Google/Supabase, invitaciones reales, permisos, publicación o iPhone físico se describe como pendiente, no como verificado.

# Referencias de producción

La app estática se publica desde GitHub Pages y se comunica con Supabase mediante su clave publicable. Los secretos de Google y los tokens administrativos nunca se empaquetan.

Supabase requiere configurar un proyecto Google OAuth de tipo web, su Client ID y Client Secret en Supabase, y el callback exacto de Supabase. Se documenta en https://supabase.com/docs/guides/auth/social-sign-in/auth-google . Las URLs de retorno de la app deben estar autorizadas: https://supabase.com/docs/guides/auth/redirect-urls .

La clave publicable no concede acceso por sí sola a datos familiares. Cada tabla debe tener permisos mínimos y RLS comprobada con usuarios autenticados miembro y no miembro: https://supabase.com/docs/guides/database/postgres/row-level-security . Tipos de claves: https://supabase.com/docs/guides/getting-started/api-keys .

GitHub Pages sirve HTML, CSS y JS estáticos; la base y autenticación residen en Supabase, no en el repositorio. Documentación https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages . La elegibilidad de repositorios privados depende del plan y debe comprobarse en la cuenta antes de publicar; no se cambia su visibilidad sin autorización.

// Cliente especial para uso EXCLUSIVO en el servidor (dentro de app/api/).
// Usa la clave secreta "service_role", que se salta las reglas de RLS
// a propósito — por eso este archivo NUNCA debe importarse desde un
// componente 'use client' (del navegador), solo desde archivos route.js
// que corren en el servidor de Vercel.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Faltan variables de entorno del servidor (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). ' +
    'Revisa la configuración de Environment Variables en Vercel.'
  );
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

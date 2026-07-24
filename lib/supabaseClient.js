// Este archivo crea UNA sola conexión reutilizable hacia Supabase,
// usando las claves públicas (seguras para el navegador: la seguridad
// real la dan las políticas RLS que ya configuramos en la base de datos).

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Error explícito y claro en vez de un fallo silencioso confuso más adelante.
  throw new Error(
    'Faltan las variables de entorno de Supabase (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). ' +
    'Revisa la configuración de Environment Variables en Vercel, o tu archivo .env.local si estás probando localmente.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

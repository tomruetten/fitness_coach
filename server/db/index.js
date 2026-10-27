import { createMemoryStore } from './memory.js';
import { createSupabaseStore } from './supabase.js';

let store;
export function getStore() {
  if (store) return store;
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, LOCAL_DB } = process.env;
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) store = createSupabaseStore(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  else store = createMemoryStore(LOCAL_DB || null);
  return store;
}
export function setStore(s) { store = s; }

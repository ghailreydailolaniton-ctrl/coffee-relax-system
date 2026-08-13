import { createClient } from "@supabase/supabase-js";

export type OrderStatus = "waiting" | "serving" | "done";

export type OrderRow = {
  id: string;
  order_number: number;
  customer_name: string;
  coffee_id: string | null;
  coffee_name: string | null;
  coffee_price: number | null;
  dessert_id: string | null;
  dessert_name: string | null;
  dessert_price: number | null;
  total: number;
  status: OrderStatus;
  created_at: string;
  items?: any[] | null;
  payment_method?: string | null;
  payment_status?: string | null;
};

export type OrderInsert = {
  customer_name?: string;
  coffee_id?: string | null;
  coffee_name?: string | null;
  coffee_price?: number | null;
  dessert_id?: string | null;
  dessert_name?: string | null;
  dessert_price?: number | null;
  total: number;
  status?: OrderStatus;
  items?: any[] | null;
};

export type OrderUpdate = Partial<Pick<OrderRow, "status" | "payment_status">>;

type Database = {
  public: {
    Tables: {
      orders: {
        Row: OrderRow;
        Insert: OrderInsert;
        Update: OrderUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, supabaseAnonKey)
  : null;
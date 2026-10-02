const BASE = "https://api.skalepayments.com.br";

export type SkaleTx = { id?: string; status?: string; pix?: { qrcode?: string | null; qrcodeImage?: string | null } | null; message?: string };

export async function skaleFetch(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: SkaleTx }> {
  const key = process.env["SKALE_API_KEY"];
  if (!key) throw new Error("Pagamento não configurado");
  const started = Date.now();
  const res = await fetch(BASE + path, {
    ...init,
    signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", "X-API-Key": key, ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: SkaleTx = {};
  try { body = JSON.parse(text) as SkaleTx; } catch { console.error("skale non-json", res.status, text.slice(0, 300)); }
  console.log("skale", init?.method ?? "GET", path, res.status, `${Date.now() - started}ms`);
  return { ok: res.ok, status: res.status, body };
}

export function mapStatus(s?: string): "pending" | "paid" | "failed" {
  if (s === "paid") return "paid";
  if (s === "refused" || s === "cancelled" || s === "refunded") return "failed";
  return "pending";
}

/** Re-reads the transaction from the gateway (source of truth) and updates the order. */
export async function syncOrderFromGateway(txId: string) {
  const r = await skaleFetch(`/transactions/${encodeURIComponent(txId)}`);
  if (!r.ok) return null;
  const status = mapStatus(r.body.status);
  if (status !== "pending") {
    await ordersApi("set_status_by_tx", { tx: txId, status });
  }
  return status;
}

/** Database access through a secret-guarded RPC using only the public key (works on any host). */
export async function ordersApi(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const secret = process.env["ORDERS_API_SECRET"];
  if (!url || !key || !secret) throw new Error("Banco não configurado (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / ORDERS_API_SECRET)");
  const res = await fetch(`${url}/rest/v1/rpc/orders_api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ p_secret: secret, p_action: action, p_payload: payload }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`orders_api ${action} ${res.status} ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as Record<string, unknown> | null) : null;
}

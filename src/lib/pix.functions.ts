import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { plans } from "./plans";

const SHIP_CENTS = 999;

const input = z.object({
  plano: z.number().int().min(0).max(2),
  chip: z.enum(["esim", "fisico"]),
  nome: z.string().trim().min(5).max(100),
  email: z.string().trim().email().max(255),
  telefone: z.string().trim().min(10).max(20),
  cpf: z.string().trim().regex(/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/),
  appEmail: z.string().trim().email().max(255),
  numero: z.string().trim().max(30),
  utms: z.record(z.string().max(60), z.string().max(300)).optional(),
});

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id", "src", "sck", "xcod", "fbclid", "gclid", "ttclid"];

export const createPix = createServerFn({ method: "POST" })
  .inputValidator((d) => input.parse(d))
  .handler(async ({ data }) => {
    const { skaleFetch, ordersApi } = await import("./pix.server");
    const plan = plans[data.plano]!;
    const planCents = Math.round(Number(plan.price.replace(",", ".")) * 100);
    const amount = planCents + (data.chip === "fisico" ? SHIP_CENTS : 0);
    const cpf = data.cpf.replace(/\D/g, "");
    const utms: Record<string, string> = {};
    for (const k of UTM_KEYS) { const v = data.utms?.[k]; if (v) utms[k] = v; }

    let order: { id: string };
    try {
      const res = await ordersApi("create", {
        customer_name: data.nome, customer_email: data.email, customer_cpf: cpf, customer_phone: data.telefone,
        app_email: data.appEmail, selected_number: data.numero, chip_type: data.chip, plan: plan.data, amount: amount / 100, utms,
      });
      if (!res?.["id"]) throw new Error("no id");
      order = { id: String(res["id"]) };
    } catch (e) {
      console.error("order insert", e instanceof Error ? e.message : e);
      return { error: "Não foi possível criar o pedido. Tente novamente." } as const;
    }

    let origin = "";
    try { origin = new URL(getRequest().url).origin; } catch { origin = ""; }
    if (!origin.startsWith("https://")) origin = "https://id-preview--0d354fe4-8416-4551-983f-f29dafc98c0e.lovable.app";
    let r: Awaited<ReturnType<typeof skaleFetch>>;
    try {
    r = await skaleFetch("/transactions", {
      method: "POST",
      body: JSON.stringify({
        amount,
        paymentMethod: "pix",
        pix: { expiresInDays: 1 },
        customer: { name: data.nome, email: data.email, phone: data.telefone, document: { number: cpf, type: "cpf" } },
        items: [{ title: `Chip Starlink ${plan.data} (${data.chip === "esim" ? "eSIM" : "Físico"})`, unitPrice: amount, quantity: 1, tangible: data.chip === "fisico", externalRef: order.id }],
        metadata: { orderId: order.id, ...utms },
        ...utms,
        postbackUrl: `${origin}/api/public/pix-webhook`,
      }),
    });
    } catch (e) {
      console.error("skale fetch threw", e instanceof Error ? e.message : e);
      await ordersApi("fail", { id: order.id }).catch(() => null);
      return { error: "Não foi possível gerar o PIX agora. Tente novamente em instantes." } as const;
    }

    const code = r.body.pix?.qrcode;
    if (!r.ok || !r.body.id || !code) {
      console.error("skale create", r.status, r.body);
      await ordersApi("fail", { id: order.id }).catch(() => null);
      return { error: "Não foi possível gerar o PIX agora. Tente novamente em instantes." } as const;
    }

    await ordersApi("set_pix", { id: order.id, pix_code: code, qr_code_url: r.body.pix?.qrcodeImage ?? null, gateway_transaction_id: r.body.id });
    return { orderId: order.id, pixCode: code, qrCode: r.body.pix?.qrcodeImage ?? null, amount: amount / 100 } as const;
  });

export const getOrderStatus = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { ordersApi, syncOrderFromGateway } = await import("./pix.server");
    const o = (await ordersApi("get", { id: data.orderId })) as { status: string; gateway_transaction_id: string | null } | null;
    if (!o) return { status: "failed" as const };
    if (o.status === "pending" && o.gateway_transaction_id) {
      const s = await syncOrderFromGateway(o.gateway_transaction_id).catch(() => null);
      if (s) return { status: s };
    }
    return { status: o.status as "pending" | "paid" | "failed" };
  });

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MAX_QTY_PER_LINE,
  calcTotals,
  canTransition,
  isValidVNPhone,
  paymentStatusAfter,
  type OrderStatus,
} from "@/lib/order-logic";

const SHOPIFY_URL =
  "https://n-n-h-ng-an-nhi-n-kozjl-ttvvccu0.myshopify.com/api/2026-10/graphql.json";
const SHOPIFY_TOKEN = "d2a78613e910965b703d4b989328138c";

type VariantInfo = {
  id: string;
  title: string;
  price: { amount: string };
  availableForSale: boolean;
  image: { url: string } | null;
  product: { handle: string; title: string };
};

/** Lấy giá thật từ Shopify — không tin giá client gửi lên */
async function fetchVariants(ids: string[]): Promise<Map<string, VariantInfo>> {
  const res = await fetch(SHOPIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": SHOPIFY_TOKEN },
    body: JSON.stringify({
      query: `query V($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id title availableForSale price{amount} image{url} product{handle title} } } }`,
      variables: { ids },
    }),
  });
  if (!res.ok) throw new Error("Không kết nối được kho sản phẩm");
  const json = await res.json();
  const map = new Map<string, VariantInfo>();
  for (const n of json?.data?.nodes ?? []) if (n?.id) map.set(n.id, n);
  return map;
}

async function optionalUserId(): Promise<string | null> {
  const auth = getRequest().headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.auth.getUser(auth.slice(7));
  return data.user?.id ?? null;
}

const placeOrderSchema = z.object({
  customerName: z.string().trim().min(2).max(100),
  customerPhone: z.string().trim().refine(isValidVNPhone, "Số điện thoại không hợp lệ"),
  customerEmail: z.string().trim().email().max(255).optional().or(z.literal("")),
  province: z.string().trim().min(2).max(100),
  district: z.string().trim().min(2).max(100),
  ward: z.string().trim().min(1).max(100),
  street: z.string().trim().min(3).max(255),
  note: z.string().trim().max(500).optional(),
  shippingMethodId: z.string().uuid(),
  paymentMethod: z.enum(["cod", "bank_transfer", "ewallet"]),
  promoCode: z.string().trim().max(30).optional(),
  lines: z
    .array(z.object({ variantId: z.string().min(1).max(200), quantity: z.number().int().min(1).max(MAX_QTY_PER_LINE) }))
    .min(1)
    .max(30),
});

export const placeOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => placeOrderSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = await optionalUserId();

    const { data: method } = await supabaseAdmin
      .from("shipping_methods")
      .select("*")
      .eq("id", data.shippingMethodId)
      .eq("active", true)
      .maybeSingle();
    if (!method) throw new Error("Phương thức vận chuyển không hợp lệ");

    let discountPercent: number | null = null;
    let promo: string | null = null;
    if (data.promoCode) {
      const { data: p } = await supabaseAdmin
        .from("promo_codes")
        .select("*")
        .ilike("code", data.promoCode)
        .eq("active", true)
        .maybeSingle();
      if (!p || (p.expires_at && new Date(p.expires_at) < new Date())) throw new Error("Mã giảm giá không hợp lệ hoặc đã hết hạn");
      discountPercent = p.discount_percent;
      promo = p.code;
    }

    const variants = await fetchVariants(data.lines.map((l) => l.variantId));
    const lines = data.lines.map((l) => {
      const v = variants.get(l.variantId);
      if (!v) throw new Error("Sản phẩm không tồn tại");
      if (!v.availableForSale) throw new Error(`"${v.product.title}" đã hết hàng`);
      return { ...l, v, unitPrice: Math.round(parseFloat(v.price.amount)) };
    });

    const totals = calcTotals({
      lines,
      methodFee: Number(method.fee),
      isStandardShipping: method.name === "Giao hàng tiêu chuẩn",
      discountPercent,
    });

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .insert({
        order_number: "",
        user_id: userId,
        customer_name: data.customerName,
        customer_phone: data.customerPhone,
        customer_email: data.customerEmail || null,
        province: data.province,
        district: data.district,
        ward: data.ward,
        street: data.street,
        note: data.note || null,
        shipping_method_id: method.id,
        shipping_fee: totals.shippingFee,
        subtotal: totals.subtotal,
        discount: totals.discount,
        promo_code: promo,
        total: totals.total,
        payment_method: data.paymentMethod,
      })
      .select("id, order_number")
      .single();
    if (error || !order) throw new Error("Không thể tạo đơn hàng");

    await supabaseAdmin.from("order_items").insert(
      lines.map((l) => ({
        order_id: order.id,
        product_handle: l.v.product.handle,
        product_title: l.v.product.title,
        variant_title: l.v.title,
        variant_id: l.variantId,
        image_url: l.v.image?.url ?? null,
        unit_price: l.unitPrice,
        quantity: l.quantity,
      })),
    );
    await supabaseAdmin.from("order_events").insert({ order_id: order.id, status: "pending", note: "Khách đặt hàng" });
    await supabaseAdmin
      .from("payments")
      .insert({ order_id: order.id, method: data.paymentMethod, amount: totals.total, status: "unpaid" });

    return { orderNumber: order.order_number, total: totals.total };
  });

const lookupSchema = z.object({
  orderNumber: z.string().trim().min(5).max(30),
  phone: z.string().trim().min(9).max(15),
});

async function loadOrderForGuest(orderNumber: string, phone: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("*, order_items(*), order_events(*), shipping_methods(name, eta_days)")
    .eq("order_number", orderNumber.toUpperCase())
    .maybeSingle();
  if (!order || order.customer_phone.replace(/\D/g, "") !== phone.replace(/\D/g, "")) return null;
  return order;
}

/** Tra cứu đơn công khai: cần đúng mã đơn + SĐT đặt hàng */
export const lookupOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => lookupSchema.parse(input))
  .handler(async ({ data }) => {
    const order = await loadOrderForGuest(data.orderNumber, data.phone);
    if (!order) return null;
    order.order_events.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return order;
  });

/** Thanh toán MÔ PHỎNG cho chuyển khoản / ví — dùng cho demo, không trừ tiền thật */
export const simulatePayment = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => lookupSchema.parse(input))
  .handler(async ({ data }) => {
    const order = await loadOrderForGuest(data.orderNumber, data.phone);
    if (!order) throw new Error("Không tìm thấy đơn hàng");
    if (order.payment_method === "cod") throw new Error("Đơn COD thanh toán khi nhận hàng");
    if (order.payment_status === "paid") return { ok: true };
    if (order.status === "cancelled") throw new Error("Đơn đã hủy");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ref = `SIM-${Date.now().toString(36).toUpperCase()}`;
    await supabaseAdmin.from("orders").update({ payment_status: "paid" }).eq("id", order.id);
    await supabaseAdmin.from("payments").update({ status: "paid", transaction_ref: ref }).eq("order_id", order.id);
    return { ok: true, ref };
  });

// ================= QUẢN TRỊ =================

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!isAdmin) throw new Error("Bạn không có quyền quản trị");
}

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data: orders } = await context.supabase
      .from("orders")
      .select("id, total, status, payment_status, created_at")
      .order("created_at", { ascending: false })
      .limit(1000);
    const list = orders ?? [];
    const revenue = list.filter((o) => o.status !== "cancelled" && o.payment_status === "paid").reduce((s, o) => s + Number(o.total), 0);
    const byStatus: Record<string, number> = {};
    for (const o of list) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    const days: { date: string; revenue: number; orders: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const dayOrders = list.filter((o) => o.created_at.slice(0, 10) === d && o.status !== "cancelled");
      days.push({ date: d.slice(5), orders: dayOrders.length, revenue: dayOrders.reduce((s, o) => s + Number(o.total), 0) });
    }
    const { count: customers } = await context.supabase.from("profiles").select("id", { count: "exact", head: true });
    return { totalOrders: list.length, revenue, byStatus, days, customers: customers ?? 0 };
  });

export const listAdminOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("orders")
      .select("*, order_items(*), order_events(*), shipping_methods(name)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updateOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        orderId: z.string().uuid(),
        status: z.enum(["pending", "confirmed", "packing", "shipping", "delivered", "cancelled"]),
        note: z.string().trim().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: order } = await context.supabase.from("orders").select("*").eq("id", data.orderId).single();
    if (!order) throw new Error("Không tìm thấy đơn");
    if (!canTransition(order.status as OrderStatus, data.status)) throw new Error("Không thể chuyển sang trạng thái này");
    const payment_status = paymentStatusAfter(data.status, order.payment_method, order.payment_status);
    const { error } = await context.supabase.from("orders").update({ status: data.status, payment_status }).eq("id", order.id);
    if (error) throw new Error(error.message);
    await context.supabase
      .from("order_events")
      .insert({ order_id: order.id, status: data.status, note: data.note || null, created_by: context.userId });
    if (payment_status !== order.payment_status) {
      await context.supabase.from("payments").update({ status: payment_status }).eq("order_id", order.id);
    }
    return { ok: true };
  });

export const listCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    const { data: profiles } = await supabaseAdmin.from("profiles").select("*");
    const { data: orders } = await supabaseAdmin.from("orders").select("user_id, total, status");
    return (users?.users ?? []).map((u) => {
      const p = profiles?.find((x) => x.id === u.id);
      const mine = (orders ?? []).filter((o) => o.user_id === u.id && o.status !== "cancelled");
      return {
        id: u.id,
        email: u.email ?? "",
        name: p?.display_name ?? "",
        phone: p?.phone ?? "",
        createdAt: u.created_at,
        orderCount: mine.length,
        spent: mine.reduce((s, o) => s + Number(o.total), 0),
      };
    });
  });

/** Demo: tài khoản đầu tiên bấm nút sẽ thành quản trị viên — chỉ hoạt động khi hệ thống chưa có admin */
export const claimFirstAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin.from("user_roles").select("id", { count: "exact", head: true }).eq("role", "admin");
    if ((count ?? 0) > 0) throw new Error("Hệ thống đã có quản trị viên");
    await supabaseAdmin.from("user_roles").insert({ user_id: context.userId, role: "admin" });
    return { ok: true };
  });

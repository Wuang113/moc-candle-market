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
  dbProductId?: string;
  dbStock?: number;
};

/** Lấy giá & tồn kho từ bảng products trong Supabase (hoặc fallback sang Shopify nếu là sản phẩm cũ) */
async function fetchVariants(ids: string[]) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const variantMap: Record<string, VariantInfo> = {};

  // 1. Tìm trong bảng products của Supabase trước
  const { data: dbProducts } = await (supabaseAdmin as any).from("products").select("*");
  for (const p of dbProducts ?? []) {
    const varKey = `supabase-variant-${p.id}`;
    if (ids.includes(p.id) || ids.includes(varKey)) {
      const matchedId = ids.includes(p.id) ? p.id : varKey;
      variantMap[matchedId] = {
        id: matchedId,
        title: p.variant_title || "Tiêu chuẩn",
        price: { amount: String(p.price) },
        availableForSale: Boolean(p.active && Number(p.stock) > 0),
        image: p.image_url ? { url: p.image_url } : null,
        product: { handle: p.handle, title: p.title },
        dbProductId: p.id,
        dbStock: Number(p.stock),
      };
    }
  }

  // 2. Nếu vẫn còn ID của Shopify chưa tìm thấy thì gọi Shopify
  const remainingIds = ids.filter((id) => !variantMap[id]);
  if (remainingIds.length > 0) {
    try {
      const res = await fetch(SHOPIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": SHOPIFY_TOKEN },
        body: JSON.stringify({
          query: `query V($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id title availableForSale price{amount} image{url} product{handle title} } } }`,
          variables: { ids: remainingIds },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        for (const n of json?.data?.nodes ?? []) {
          if (n?.id) variantMap[n.id] = n;
        }
      }
    } catch {
      // Bỏ qua lỗi mạng Shopify nếu chỉ dùng Supabase
    }
  }

  return variantMap;
}

async function optionalUserId() {
  const auth = getRequest().headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.auth.getUser(auth.slice(7));
  return data.user?.id ?? null;
}

const placeOrderSchema = z.object({
  userId: z.string().uuid().optional().nullable(),
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
    const userId = data.userId || (await optionalUserId());

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
      if (!p || (p.expires_at && new Date(p.expires_at) < new Date())) {
        throw new Error("Mã giảm giá không hợp lệ hoặc đã hết hạn");
      }
      discountPercent = p.discount_percent;
      promo = p.code;
    }

    const variants = await fetchVariants(data.lines.map((l) => l.variantId));
    const lines = data.lines.map((l) => {
      const v = variants[l.variantId];
      if (!v) throw new Error("Sản phẩm không tồn tại");
      if (!v.availableForSale) throw new Error(`"${v.product.title}" đã hết hàng`);
      if (v.dbStock !== undefined && l.quantity > v.dbStock) {
        throw new Error(`"${v.product.title}" chỉ còn ${v.dbStock} sản phẩm trong kho`);
      }
      return { ...l, v, unitPrice: Math.round(parseFloat(v.price.amount)) };
    });

    const totals = calcTotals({
      lines,
      methodFee: Number(method.fee),
      isStandardShipping: method.name === "Giao hàng tiêu chuẩn",
      discountPercent,
    });

    const generatedOrderNo = `AN-${Date.now().toString(36).toUpperCase()}`;

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .insert({
        order_number: generatedOrderNo,
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
    if (error || !order) throw new Error(error?.message || "Không thể tạo đơn hàng");

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

    // Tự động trừ số lượng tồn kho trong bảng products
    for (const l of lines) {
      if (l.v.dbProductId && l.v.dbStock !== undefined) {
        const nextStock = Math.max(0, l.v.dbStock - l.quantity);
        await (supabaseAdmin as any)
          .from("products")
          .update({ stock: nextStock, updated_at: new Date().toISOString() })
          .eq("id", l.v.dbProductId);
      }
    }

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
    const revenue = list
      .filter((o) => o.status !== "cancelled" && o.payment_status === "paid")
      .reduce((s, o) => s + Number(o.total), 0);
    const byStatus: Record<string, number> = {};
    for (const o of list) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    const days: { date: string; revenue: number; orders: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const dayOrders = list.filter((o) => o.created_at.slice(0, 10) === d && o.status !== "cancelled");
      days.push({
        date: d.slice(5),
        orders: dayOrders.length,
        revenue: dayOrders.reduce((s, o) => s + Number(o.total), 0),
      });
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
    const { error } = await context.supabase
      .from("orders")
      .update({ status: data.status, payment_status })
      .eq("id", order.id);
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
    const { data: allRoles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    return (users?.users ?? []).map((u) => {
      const p = profiles?.find((x) => x.id === u.id);
      const mine = (orders ?? []).filter((o) => o.user_id === u.id && o.status !== "cancelled");
      const roles = (allRoles ?? []).filter((r) => r.user_id === u.id).map((r) => String(r.role));
      return {
        id: u.id,
        email: u.email ?? "",
        name: p?.display_name ?? "",
        phone: p?.phone ?? "",
        createdAt: u.created_at,
        orderCount: mine.length,
        spent: mine.reduce((s, o) => s + Number(o.total), 0),
        roles,
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

// ================= CỔNG THANH TOÁN MOMO SANDBOX (CHẠY TRÊN SERVER) =================

const MOMO_CONFIG = {
  partnerCode: "MOMO",
  accessKey: "F8BBA842ECF85",
  secretKey: "K951B6PE1waDMi640xX08PD3vg6EkVlz",
  endpoint: "https://test-payment.momo.vn/v2/gateway/api/create",
};

async function hmacSHA256Server(key: string, message: string) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const momoSchema = z.object({
  orderNumber: z.string(),
  amount: z.number(),
  origin: z.string(),
  phone: z.string(),
});

export const createMoMoCheckout = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => momoSchema.parse(input))
  .handler(async ({ data }) => {
    const fallbackUrl = `${data.origin}/tra-cuu?ma=${encodeURIComponent(data.orderNumber)}&sdt=${encodeURIComponent(data.phone)}&momo=1`;

    try {
      const { partnerCode, accessKey, secretKey, endpoint } = MOMO_CONFIG;
      const requestId = `${data.orderNumber}_${Date.now()}`;
      const orderId = `${data.orderNumber}_${Date.now()}`;
      const orderInfo = `Thanh toan don hang ${data.orderNumber} tai Nen Huong An Nhien`;
      const redirectUrl = `${data.origin}/tra-cuu?ma=${encodeURIComponent(data.orderNumber)}&sdt=${encodeURIComponent(data.phone)}&momoPaid=1`;
      const ipnUrl = `${data.origin}/tra-cuu`;
      const requestType = "captureWallet";
      const extraData = "";

      const validAmount = Math.max(1000, Math.round(data.amount));
      const amount = validAmount.toString();

      const rawSignature =
        `accessKey=${accessKey}` +
        `&amount=${amount}` +
        `&extraData=${extraData}` +
        `&ipnUrl=${ipnUrl}` +
        `&orderId=${orderId}` +
        `&orderInfo=${orderInfo}` +
        `&partnerCode=${partnerCode}` +
        `&redirectUrl=${redirectUrl}` +
        `&requestId=${requestId}` +
        `&requestType=${requestType}`;

      const signature = await hmacSHA256Server(secretKey, rawSignature);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerCode,
          partnerName: "Nến Hương Mộc",
          storeId: "AnNhienCandle",
          requestId,
          amount: validAmount,
          orderId,
          orderInfo,
          redirectUrl,
          ipnUrl,
          lang: "vi",
          requestType,
          autoCapture: true,
          extraData,
          signature,
        }),
      });

      const text = await response.text();
      if (!text.trim().startsWith("{")) {
        return { payUrl: fallbackUrl };
      }

      const resData = JSON.parse(text);
      if (resData.resultCode === 0 && resData.payUrl) {
        return { payUrl: resData.payUrl as string };
      }
      return { payUrl: fallbackUrl };
    } catch {
      return { payUrl: fallbackUrl };
    }
  });

// ================= QUẢN LÝ SẢN PHẨM (THÊM / SỬA / XÓA / SỐ LƯỢNG) =================

const productInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2, "Tên sản phẩm quá ngắn").max(200),
  handle: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(2000).optional().default(""),
  price: z.number().min(0, "Giá không hợp lệ"),
  stock: z.number().int().min(0, "Số lượng không được âm"),
  image_url: z.string().trim().optional().default(""),
  variant_title: z.string().trim().optional().default("Tiêu chuẩn (200g)"),
  active: z.boolean().optional().default(true),
});

function toSlug(str: string) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const listAdminProducts = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as any)
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as any[];
});

export const upsertProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => productInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const handle = data.handle ? toSlug(data.handle) : `${toSlug(data.title)}-${Date.now().toString(36).slice(-4)}`;

    if (data.id) {
      const { error } = await (supabaseAdmin as any)
        .from("products")
        .update({
          title: data.title,
          handle,
          description: data.description,
          price: data.price,
          stock: data.stock,
          image_url: data.image_url,
          variant_title: data.variant_title,
          active: data.active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await (supabaseAdmin as any).from("products").insert({
        title: data.title,
        handle,
        description: data.description,
        price: data.price,
        stock: data.stock,
        image_url: data.image_url,
        variant_title: data.variant_title,
        active: data.active,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("products").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ================= PHÂN HỆ NGƯỜI GIAO HÀNG (SHIPPER) =================

export const listShipperOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (roleRows ?? []).map((r: any) => String(r.role));
    const isAdmin = roles.includes("admin");
    const isShipper = roles.includes("shipper") || isAdmin;

    if (!isShipper) {
      throw new Error("Bạn không có quyền truy cập khu vực giao hàng");
    }

    // CHỈ lấy các đơn đã được Admin xác nhận & đóng gói xong ('packing'), đang giao ('shipping') hoặc đã giao ('delivered')
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("*, order_items(*), order_events(*), shipping_methods(name, fee)")
      .in("status", ["packing", "shipping", "delivered"])
      .order("created_at", { ascending: false })
      .limit(150);

    if (error) throw new Error(error.message);
    const allOrders = (data ?? []) as any[];

    if (isAdmin) {
      return allOrders;
    }

    // Shipper chỉ thấy đơn ở bước 'packing' (chờ nhận giao) và đơn của chính mình đang giao / đã giao
    return allOrders.filter((o) => {
      if (o.status === "packing") {
        return true;
      }
      return o.shipper_id === context.userId;
    });
  });

const shipperActionSchema = z.object({
  orderId: z.string().uuid(),
  shipperName: z.string().trim().min(2, "Vui lòng nhập tên người giao hàng"),
  shipperPhone: z.string().trim().min(9, "Vui lòng nhập SĐT người giao hàng"),
  action: z.enum(["accept", "checkpoint", "complete"]),
  checkpointNote: z.string().trim().optional(),
});

export const shipperHandleOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => shipperActionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (roleRows ?? []).map((r: any) => String(r.role));
    const isAdmin = roles.includes("admin");
    const isShipper = roles.includes("shipper") || isAdmin;
    if (!isShipper) throw new Error("Bạn không có quyền thực hiện thao tác giao hàng");

    const { data: order } = await (supabaseAdmin as any)
      .from("orders")
      .select("*")
      .eq("id", data.orderId)
      .single();

    if (!order) throw new Error("Không tìm thấy đơn hàng");

    if (data.action === "accept") {
      if (order.status !== "packing") {
        throw new Error("Đơn hàng chưa được quản trị viên xác nhận đóng gói xong!");
      }
      // Chặn trường hợp đơn đã bị Shipper khác nhanh tay nhận trước
      if (order.status === "shipping" && order.shipper_id && order.shipper_id !== context.userId) {
        throw new Error(`Đơn này đã được tài xế ${order.shipper_name || "khác"} nhận giao rồi!`);
      }

      const { error } = await (supabaseAdmin as any)
        .from("orders")
        .update({
          status: "shipping",
          shipper_id: context.userId,
          shipper_name: `${data.shipperName} (${data.shipperPhone})`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      if (error) throw new Error(error.message);

      await supabaseAdmin.from("order_events").insert({
        order_id: order.id,
        status: "shipping",
        note: `Shipper ${data.shipperName} (${data.shipperPhone}) đã nhận đơn và bắt đầu giao hàng`,
      });
      return { ok: true };
    }

    // Kiểm tra quyền sở hữu đơn khi cập nhật chặng hoặc hoàn tất
    if (!isAdmin && order.shipper_id && order.shipper_id !== context.userId) {
      throw new Error("Bạn chỉ có thể thao tác trên đơn hàng do chính mình nhận!");
    }

    if (data.action === "checkpoint") {
      await supabaseAdmin.from("order_events").insert({
        order_id: order.id,
        status: "shipping",
        note: data.checkpointNote || `Shipper ${data.shipperName} đang di chuyển đến địa chỉ giao`,
      });
      return { ok: true };
    }

    if (data.action === "complete") {
      const { error } = await (supabaseAdmin as any)
        .from("orders")
        .update({
          status: "delivered",
          payment_status: "paid",
          shipper_id: order.shipper_id || context.userId,
          shipper_name: order.shipper_name || `${data.shipperName} (${data.shipperPhone})`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      if (error) throw new Error(error.message);

      await supabaseAdmin
        .from("payments")
        .update({ status: "paid" })
        .eq("order_id", order.id);

      const codNote =
        order.payment_method === "cod"
          ? `Đã thu hộ COD đủ số tiền`
          : `Đơn đã thanh toán online`;

      await supabaseAdmin.from("order_events").insert({
        order_id: order.id,
        status: "delivered",
        note: `Shipper ${data.shipperName} (${data.shipperPhone}) đã giao hàng thành công (${codNote})`,
      });
      return { ok: true };
    }

    return { ok: false };
  });

  // ================= ĐÁNH GIÁ SẢN PHẨM CỦA KHÁCH HÀNG =================

export const listProductReviews = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ handle: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: reviews, error } = await (supabaseAdmin as any)
      .from("product_reviews")
      .select("*")
      .eq("product_handle", data.handle)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (reviews ?? []) as any[];
  });

const createReviewSchema = z.object({
  handle: z.string().min(1),
  customerName: z.string().trim().min(2, "Vui lòng nhập tên của bạn").max(100),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(3, "Vui lòng nhập nội dung đánh giá (tối thiểu 3 ký tự)").max(1000),
});

export const createProductReview = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => createReviewSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = await optionalUserId();

    const { error } = await (supabaseAdmin as any).from("product_reviews").insert({
      product_handle: data.handle,
      user_id: userId,
      customer_name: data.customerName,
      rating: data.rating,
      comment: data.comment,
    });

    if (error) throw new Error(error.message);
    return { ok: true };
  });

  // ================= PHÂN QUYỀN NGƯỜI GIAO HÀNG (SHIPPER) =================

export const toggleShipperRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ targetUserId: z.string().uuid(), grant: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.grant) {
      const { data: existing } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("user_id", data.targetUserId)
        .eq("role", "shipper" as any)
        .maybeSingle();
      if (!existing) {
        const { error } = await supabaseAdmin
          .from("user_roles")
          .insert({ user_id: data.targetUserId, role: "shipper" as any });
        if (error) throw new Error(error.message);
      }
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.targetUserId)
        .eq("role", "shipper" as any);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

 // ================= HỆ THỐNG CHAT THỜI GIAN THỰC (ADMIN & SHIPPER) =================

export const listSupportMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ targetUserId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdmin = (roleRows ?? []).some((r: any) => r.role === "admin");

    // Admin xem tin nhắn của khách được chọn; Khách hàng chỉ xem tin nhắn của chính mình
    const customerId = isAdmin ? data.targetUserId : context.userId;
    if (!customerId) return [];

    const { data: msgs, error } = await (supabaseAdmin as any)
      .from("messages")
      .select("*")
      .eq("channel_type", "support")
      .eq("customer_user_id", customerId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) throw new Error(error.message);
    return (msgs ?? []) as any[];
  });

export const sendSupportMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      targetUserId: z.string().uuid().optional(),
      senderName: z.string().trim().min(1).max(100),
      content: z.string().trim().min(1).max(1000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdmin = (roleRows ?? []).some((r: any) => r.role === "admin");

    if (isAdmin && !data.targetUserId) {
      throw new Error("Vui lòng chọn một khách hàng cụ thể để trả lời");
    }

    const customerId = isAdmin ? data.targetUserId! : context.userId;
    const senderRole = isAdmin ? "admin" : "customer";

    const { error } = await (supabaseAdmin as any).from("messages").insert({
      channel_type: "support",
      customer_user_id: customerId,
      sender_id: context.userId,
      sender_name: data.senderName,
      sender_role: senderRole,
      content: data.content,
    });

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listOrderMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await (supabaseAdmin as any)
      .from("orders")
      .select("id, user_id, shipper_id")
      .eq("id", data.orderId)
      .single();

    if (!order) throw new Error("Không tìm thấy đơn hàng");

    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (roleRows ?? []).map((r: any) => String(r.role));
    const isAdmin = roles.includes("admin");
    const isAllowed =
      isAdmin || order.user_id === context.userId || order.shipper_id === context.userId;

    if (!isAllowed) {
      throw new Error("Bạn không có quyền xem cuộc trò chuyện của đơn hàng này");
    }

    const { data: msgs, error } = await (supabaseAdmin as any)
      .from("messages")
      .select("*")
      .eq("channel_type", "order")
      .eq("order_id", data.orderId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) throw new Error(error.message);
    return (msgs ?? []) as any[];
  });

export const sendOrderMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      orderId: z.string().uuid(),
      senderName: z.string().trim().min(1).max(100),
      content: z.string().trim().min(1).max(1000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await (supabaseAdmin as any)
      .from("orders")
      .select("id, user_id, shipper_id")
      .eq("id", data.orderId)
      .single();

    if (!order) throw new Error("Không tìm thấy đơn hàng");

    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (roleRows ?? []).map((r: any) => String(r.role));
    const isAdmin = roles.includes("admin");
    const isShipper = roles.includes("shipper");

    const isAllowed =
      isAdmin || order.user_id === context.userId || order.shipper_id === context.userId;
    if (!isAllowed) {
      throw new Error("Bạn không có quyền nhắn tin trong đơn hàng này");
    }

    const senderRole =
      order.shipper_id === context.userId || (isShipper && order.user_id !== context.userId)
        ? "shipper"
        : isAdmin && order.user_id !== context.userId
          ? "admin"
          : "customer";

    const { error } = await (supabaseAdmin as any).from("messages").insert({
      channel_type: "order",
      order_id: data.orderId,
      sender_id: context.userId,
      sender_name: data.senderName,
      sender_role: senderRole,
      content: data.content,
    });

    if (error) throw new Error(error.message);
    return { ok: true };
  });
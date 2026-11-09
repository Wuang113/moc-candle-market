import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { formatVND, fetchProducts } from "@/lib/shopify";
import {
  nextStatuses,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  STATUS_LABEL,
  type OrderStatus,
} from "@/lib/order-logic";
import { getAdminOverview, listAdminOrders, listCustomers, updateOrderStatus } from "@/lib/orders.functions";
import { EventList } from "@/components/OrderTimeline";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Quản trị — Nến Hương An Nhiên" },
      { name: "description", content: "Quản lý đơn hàng, khách hàng, sản phẩm và vận chuyển." },
      { property: "og:title", content: "Quản trị — Nến Hương An Nhiên" },
      { property: "og:description", content: "Trang quản trị cửa hàng." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Admin,
});

function Admin() {
  const { isAdmin, loading } = useAuth();
  if (loading) return <p className="p-10 text-center text-muted-foreground">Đang tải...</p>;
  if (!isAdmin)
    return (
      <div className="p-16 text-center">
        <p>Bạn không có quyền truy cập trang này.</p>
        <Button asChild className="mt-4"><Link to="/tai-khoan">Về tài khoản</Link></Button>
      </div>
    );
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold">Quản trị cửa hàng</h1>
      <Tabs defaultValue="overview" className="mt-6">
        <TabsList>
          <TabsTrigger value="overview">Tổng quan</TabsTrigger>
          <TabsTrigger value="orders">Đơn hàng</TabsTrigger>
          <TabsTrigger value="customers">Khách hàng</TabsTrigger>
          <TabsTrigger value="products">Sản phẩm</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><Overview /></TabsContent>
        <TabsContent value="orders"><Orders /></TabsContent>
        <TabsContent value="customers"><Customers /></TabsContent>
        <TabsContent value="products"><Products /></TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ l, v }: { l: string; v: string | number }) {
  return (
    <div className="rounded-2xl bg-card p-5 shadow-soft">
      <p className="text-sm text-muted-foreground">{l}</p>
      <p className="mt-1 text-2xl font-semibold">{v}</p>
    </div>
  );
}

function Overview() {
  const fn = useServerFn(getAdminOverview);
  const { data } = useQuery({ queryKey: ["admin-overview"], queryFn: () => fn() });
  if (!data) return <p className="py-8 text-muted-foreground">Đang tải...</p>;
  return (
    <div className="space-y-6 pt-4">
      <div className="grid gap-4 md:grid-cols-4">
        <Stat l="Tổng đơn" v={data.totalOrders} />
        <Stat l="Doanh thu đã thu" v={formatVND(data.revenue)} />
        <Stat l="Chờ xác nhận" v={data.byStatus['pending'] ?? 0} />
        <Stat l="Khách hàng" v={data.customers} />
      </div>
      <div className="rounded-2xl bg-card p-5 shadow-soft">
        <p className="mb-4 font-medium">Doanh số 7 ngày gần nhất</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.days}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" />
            <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v: number) => formatVND(v)} />
            <Bar dataKey="revenue" name="Doanh số" fill="var(--primary)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Orders() {
  const fn = useServerFn(listAdminOrders);
  const update = useServerFn(updateOrderStatus);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<OrderStatus | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const { data: orders = [] } = useQuery({ queryKey: ["admin-orders"], queryFn: () => fn() });
  const shown = filter === "all" ? orders : orders.filter((o) => o.status === filter);

  async function change(orderId: string, status: OrderStatus) {
    try {
      await update({ data: { orderId, status } });
      toast.success(`Đã chuyển: ${STATUS_LABEL[status]}`);
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["admin-overview"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lỗi");
    }
  }

  return (
    <div className="pt-4">
      <div className="flex flex-wrap gap-2">
        {(["all", "pending", "confirmed", "packing", "shipping", "delivered", "cancelled"] as const).map((s) => (
          <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)}>
            {s === "all" ? "Tất cả" : STATUS_LABEL[s]}
          </Button>
        ))}
      </div>
      <div className="mt-4 divide-y rounded-2xl bg-card shadow-soft">
        {shown.length === 0 && <p className="p-6 text-muted-foreground">Chưa có đơn hàng.</p>}
        {shown.map((o) => (
          <div key={o.id} className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <button className="text-left" onClick={() => setOpen(open === o.id ? null : o.id)}>
                <p className="font-medium">{o.order_number}</p>
                <p className="text-sm text-muted-foreground">{o.customer_name} · {o.customer_phone}</p>
              </button>
              <div className="text-sm">
                <p>{formatVND(o.total)}</p>
                <p className="text-muted-foreground">{PAYMENT_STATUS_LABEL[o.payment_status]}</p>
              </div>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs">{STATUS_LABEL[o.status]}</span>
              <div className="ml-auto flex gap-2">
                {nextStatuses(o.status).map((s) => (
                  <Button key={s} size="sm" variant={s === "cancelled" ? "outline" : "default"} onClick={() => change(o.id, s)}>
                    {STATUS_LABEL[s]}
                  </Button>
                ))}
              </div>
            </div>
            {open === o.id && (
              <div className="mt-4 grid gap-4 rounded-xl bg-muted p-4 text-sm md:grid-cols-2">
                <div className="space-y-1">
                  {o.order_items.map((it) => <p key={it.id}>{it.product_title} × {it.quantity} — {formatVND(Number(it.unit_price) * it.quantity)}</p>)}
                  <p className="pt-2">Địa chỉ: {o.street}, {o.ward}, {o.district}, {o.province}</p>
                  <p>Vận chuyển: {o.shipping_methods?.name} · Thanh toán: {PAYMENT_METHOD_LABEL[o.payment_method]}</p>
                  {o.note && <p>Ghi chú: {o.note}</p>}
                </div>
                <EventList events={[...o.order_events].sort((a, b) => a.created_at.localeCompare(b.created_at))} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Customers() {
  const fn = useServerFn(listCustomers);
  const { data = [] } = useQuery({ queryKey: ["admin-customers"], queryFn: () => fn() });
  return (
    <div className="mt-4 overflow-x-auto rounded-2xl bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="p-3">Email</th><th>Tên</th><th>Ngày tạo</th><th>Số đơn</th><th>Đã chi</th></tr>
        </thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="p-3">{c.email}</td><td>{c.name}</td>
              <td>{new Date(c.createdAt).toLocaleDateString("vi-VN")}</td>
              <td>{c.orderCount}</td><td>{formatVND(c.spent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Products() {
  const { data = [] } = useQuery({ queryKey: ["products"], queryFn: () => fetchProducts(50) });
  return (
    <div className="pt-4">
      <p className="mb-3 text-sm text-muted-foreground">Sản phẩm, giá và tồn kho được quản lý trên Shopify và đồng bộ tự động về website.</p>
      <div className="divide-y rounded-2xl bg-card shadow-soft">
        {data.map((p) => {
          const v = p.node.variants.edges[0]?.node;
          return (
            <div key={p.node.id} className="flex items-center gap-4 p-3 text-sm">
              <img src={p.node.images.edges[0]?.node.url} alt="" className="h-12 w-12 rounded-lg object-cover" />
              <span className="flex-1">{p.node.title}</span>
              <span>{formatVND(p.node.priceRange.minVariantPrice.amount)}</span>
              <span className="w-24 text-right text-muted-foreground">{v?.availableForSale ? "Còn hàng" : "Hết hàng"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

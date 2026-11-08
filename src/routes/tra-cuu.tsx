import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lookupOrder, simulatePayment } from "@/lib/orders.functions";
import { formatVND } from "@/lib/shopify";
import { PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/order-logic";
import { EventList, OrderProgress } from "@/components/OrderTimeline";

export const Route = createFileRoute("/tra-cuu")({
  validateSearch: z.object({ ma: z.string().optional(), sdt: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Tra cứu đơn hàng — Nến Hương An Nhiên" },
      { name: "description", content: "Theo dõi trạng thái đơn hàng và vận chuyển bằng mã đơn và số điện thoại." },
      { property: "og:title", content: "Tra cứu đơn hàng — Nến Hương An Nhiên" },
      { property: "og:description", content: "Theo dõi đơn hàng nến thơm của bạn." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Lookup,
});

function Lookup() {
  const { ma, sdt } = Route.useSearch();
  const navigate = useNavigate({ from: "/tra-cuu" });
  const qc = useQueryClient();
  const lookup = useServerFn(lookupOrder);
  const pay = useServerFn(simulatePayment);
  const [paying, setPaying] = useState(false);

  const { data: order, isFetching } = useQuery({
    queryKey: ["lookup", ma, sdt],
    enabled: Boolean(ma && sdt),
    queryFn: () => lookup({ data: { orderNumber: ma!, phone: sdt! } }),
  });

  async function doPay() {
    setPaying(true);
    try {
      await pay({ data: { orderNumber: ma!, phone: sdt! } });
      toast.success("Thanh toán mô phỏng thành công");
      qc.invalidateQueries({ queryKey: ["lookup"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lỗi thanh toán");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold">Tra cứu đơn hàng</h1>
      <form
        className="mt-6 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          navigate({ search: { ma: String(f.get("ma")).trim().toUpperCase(), sdt: String(f.get("sdt")).trim() } });
        }}
      >
        <Input name="ma" defaultValue={ma} placeholder="Mã đơn (VD: ANN...)" required className="max-w-56" />
        <Input name="sdt" defaultValue={sdt} placeholder="Số điện thoại đặt hàng" required className="max-w-56" />
        <Button type="submit" disabled={isFetching}>Tra cứu</Button>
      </form>

      {ma && sdt && !isFetching && order === null && <p className="mt-8 text-muted-foreground">Không tìm thấy đơn hàng phù hợp.</p>}

      {order && (
        <div className="mt-8 space-y-6 rounded-2xl bg-card p-6 shadow-warm">
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <p className="text-sm text-muted-foreground">Mã đơn</p>
              <p className="text-xl font-semibold">{order.order_number}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">{PAYMENT_METHOD_LABEL[order.payment_method]}</p>
              <p className="font-medium">{PAYMENT_STATUS_LABEL[order.payment_status]}</p>
            </div>
          </div>
          <OrderProgress status={order.status} />
          {order.payment_method !== "cod" && order.payment_status === "unpaid" && order.status !== "cancelled" && (
            <div className="rounded-xl bg-secondary p-4 text-sm">
              <p className="font-medium">Thanh toán {order.payment_method === "bank_transfer" ? "chuyển khoản" : "ví điện tử"} (mô phỏng)</p>
              <p className="mt-1 text-muted-foreground">Nội dung chuyển khoản: <b>{order.order_number}</b> — Số tiền: <b>{formatVND(order.total)}</b></p>
              <Button className="mt-3" onClick={doPay} disabled={paying}>Xác nhận đã thanh toán</Button>
            </div>
          )}
          <div className="space-y-2">
            {order.order_items.map((it) => (
              <div key={it.id} className="flex items-center gap-3 text-sm">
                {it.image_url && <img src={it.image_url} alt="" className="h-12 w-12 rounded-lg object-cover" />}
                <span className="flex-1">{it.product_title} × {it.quantity}</span>
                <span>{formatVND(Number(it.unit_price) * it.quantity)}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1 border-t pt-3 text-sm">
            <p>Giao tới: {order.customer_name} — {order.street}, {order.ward}, {order.district}, {order.province}</p>
            <p>Vận chuyển: {order.shipping_methods?.name} ({formatVND(order.shipping_fee)})</p>
            {Number(order.discount) > 0 && <p>Giảm giá ({order.promo_code}): -{formatVND(order.discount)}</p>}
            <p className="text-lg font-semibold">Tổng: {formatVND(order.total)}</p>
          </div>
          <div>
            <p className="mb-2 font-medium">Lịch sử xử lý</p>
            <EventList events={order.order_events} />
          </div>
        </div>
      )}
    </div>
  );
}

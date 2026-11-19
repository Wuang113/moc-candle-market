import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lookupOrder, simulatePayment } from "@/lib/orders.functions";
import { formatVND } from "@/lib/shopify";
import { PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/order-logic";
import { EventList, OrderProgress } from "@/components/OrderTimeline";

export const Route = createFileRoute("/tra-cuu")({
  validateSearch: z.object({
    ma: z.string().optional(),
    sdt: z.string().optional(),
    momo: z.union([z.string(), z.number()]).optional(),
    momoPaid: z.union([z.string(), z.number()]).optional(),
    resultCode: z.union([z.string(), z.number()]).optional(),
  }),
  head: () => ({
    meta: [
      { title: "Tra cứu đơn hàng — Nến Hương Mộc" },
      { name: "description", content: "Theo dõi trạng thái đơn hàng và vận chuyển bằng mã đơn và số điện thoại." },
      { property: "og:title", content: "Tra cứu đơn hàng — Nến Hương Mộc" },
      { property: "og:description", content: "Theo dõi đơn hàng nến thơm của bạn." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Lookup,
});

function Lookup() {
  const { ma, sdt, momoPaid, resultCode } = Route.useSearch();
  const navigate = useNavigate({ from: "/tra-cuu" });
  const qc = useQueryClient();
  const lookup = useServerFn(lookupOrder);
  const pay = useServerFn(simulatePayment);
  const [paying, setPaying] = useState(false);
  const [countdown, setCountdown] = useState(600); // 10 phút đếm ngược cho QR MoMo

  const { data: order, isFetching } = useQuery({
    queryKey: ["lookup", ma, sdt],
    enabled: Boolean(ma && sdt),
    queryFn: () => lookup({ data: { orderNumber: ma!, phone: sdt! } }),
  });

  // Đếm ngược thời gian quét mã MoMo
  useEffect(() => {
    if (!order || order.payment_status === "paid") return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [order]);

  // Nếu từ cổng MoMo Sandbox quay về với kết quả thành công (resultCode = 0 hoặc momoPaid = 1)
  useEffect(() => {
    if (
      order &&
      order.payment_status === "unpaid" &&
      (String(resultCode) === "0" || (momoPaid && resultCode === undefined))
    ) {
      doPay(true);
    }
  }, [order, momoPaid, resultCode]);

  async function doPay(isAuto = false) {
    if (!ma || !sdt) return;
    setPaying(true);
    try {
      await pay({ data: { orderNumber: ma, phone: sdt } });
      toast.success(isAuto ? "Thanh toán MoMo thành công!" : "Xác nhận thanh toán MoMo thành công!");
      qc.invalidateQueries({ queryKey: ["lookup"] });
    } catch (e) {
      if (!isAuto) toast.error(e instanceof Error ? e.message : "Lỗi thanh toán");
    } finally {
      setPaying(false);
    }
  }

  const minutes = String(Math.floor(countdown / 60)).padStart(2, "0");
  const seconds = String(countdown % 60).padStart(2, "0");

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
        <Input name="ma" defaultValue={ma} placeholder="Mã đơn (VD: AN-...)" required className="max-w-56" />
        <Input name="sdt" defaultValue={sdt} placeholder="Số điện thoại đặt hàng" required className="max-w-56" />
        <Button type="submit" disabled={isFetching}>Tra cứu</Button>
      </form>

      {ma && sdt && !isFetching && order === null && (
        <p className="mt-8 text-muted-foreground">Không tìm thấy đơn hàng phù hợp.</p>
      )}

      {order && (
        <div className="mt-8 space-y-6 rounded-2xl bg-card p-6 shadow-warm">
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <p className="text-sm text-muted-foreground">Mã đơn</p>
              <p className="text-xl font-semibold">{order.order_number}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">
                {order.payment_method === "ewallet" ? "Ví điện tử MoMo" : PAYMENT_METHOD_LABEL[order.payment_method]}
              </p>
              <p className="font-medium">{PAYMENT_STATUS_LABEL[order.payment_status]}</p>
            </div>
          </div>

          <OrderProgress status={order.status} />

          {/* GIAO DIỆN CỔNG THANH TOÁN QR MOMO */}
          {order.payment_method === "ewallet" && order.payment_status === "unpaid" && order.status !== "cancelled" && (
            <div className="overflow-hidden rounded-2xl border-2 border-[#A50064] bg-white shadow-lg">
              <div className="flex items-center justify-between bg-[#A50064] px-6 py-4 text-white">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white font-bold text-[#A50064]">
                    MoMo
                  </div>
                  <div>
                    <p className="font-semibold text-base">Cổng thanh toán MoMo</p>
                    <p className="text-xs text-pink-100">Nến Hương Mộc — Thanh toán an toàn</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-pink-100">Đơn hàng hết hạn sau</p>
                  <p className="font-mono text-lg font-bold">{minutes}:{seconds}</p>
                </div>
              </div>

              <div className="grid gap-6 p-6 md:grid-cols-[220px_1fr] md:items-center">
                <div className="mx-auto flex flex-col items-center rounded-xl border-2 border-dashed border-[#A50064]/40 bg-pink-50/40 p-3">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                      `2|99|0976437879|NEN HUONG AN NHIEN|annhien@candle.vn|0|0|${Math.round(Number(order.total))}|${order.order_number}`
                    )}`}
                    alt="Mã QR MoMo"
                    className="h-44 w-44 rounded-lg bg-white p-2 shadow-sm"
                  />
                  <span className="mt-2 text-xs font-medium text-[#A50064]">
                    Sử dụng App MoMo hoặc Camera để quét mã
                  </span>
                </div>

                <div className="space-y-3 text-sm text-gray-700">
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-gray-500">Nhà cung cấp:</span>
                    <span className="font-semibold text-gray-900">Nến Hương Mộc</span>
                  </div>
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-gray-500">Mã đơn hàng:</span>
                    <span className="font-mono font-semibold text-gray-900">{order.order_number}</span>
                  </div>
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-gray-500">Nội dung thanh toán:</span>
                    <span className="font-semibold text-[#A50064]">Thanh toan {order.order_number}</span>
                  </div>
                  <div className="flex justify-between border-b pb-2 text-base">
                    <span className="text-gray-500">Số tiền thanh toán:</span>
                    <span className="text-xl font-bold text-[#A50064]">{formatVND(order.total)}</span>
                  </div>

                  <div className="pt-2">
                    <Button
                      onClick={() => doPay(false)}
                      disabled={paying}
                      className="w-full bg-[#A50064] text-white hover:bg-[#8A0053]"
                    >
                      {paying ? "Đang kiểm tra giao dịch..." : "Tôi đã quét mã thanh toán MoMo"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* GIAO DIỆN CHUYỂN KHOẢN NGÂN HÀNG */}
          {order.payment_method === "bank_transfer" && order.payment_status === "unpaid" && order.status !== "cancelled" && (
            <div className="rounded-xl bg-secondary p-4 text-sm">
              <p className="font-medium">Thanh toán chuyển khoản ngân hàng (mô phỏng)</p>
              <p className="mt-1 text-muted-foreground">
                Nội dung chuyển khoản: <b>{order.order_number}</b> — Số tiền: <b>{formatVND(order.total)}</b>
              </p>
              <Button className="mt-3" onClick={() => doPay(false)} disabled={paying}>
                Xác nhận đã thanh toán
              </Button>
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
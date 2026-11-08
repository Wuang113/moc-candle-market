import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCartStore } from "@/stores/cart";
import { formatVND } from "@/lib/shopify";
import { calcTotals, PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/order-logic";
import { placeOrder } from "@/lib/orders.functions";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/thanh-toan")({
  head: () => ({
    meta: [
      { title: "Đặt hàng — Nến Hương An Nhiên" },
      { name: "description", content: "Nhập thông tin giao hàng và chọn phương thức thanh toán." },
      { property: "og:title", content: "Đặt hàng — Nến Hương An Nhiên" },
      { property: "og:description", content: "Hoàn tất đơn hàng nến thơm." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Checkout,
});

function Checkout() {
  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clearCart);
  const { user } = useAuth();
  const navigate = useNavigate();
  const place = useServerFn(placeOrder);
  const [busy, setBusy] = useState(false);
  const [methodId, setMethodId] = useState<string>("");
  const [pay, setPay] = useState<PaymentMethod>("cod");
  const [promo, setPromo] = useState("");

  const { data: methods = [] } = useQuery({
    queryKey: ["shipping_methods"],
    queryFn: async () => (await supabase.from("shipping_methods").select("*").eq("active", true).order("fee")).data ?? [],
  });
  const method = methods.find((m) => m.id === methodId) ?? methods[0];
  const totals = calcTotals({
    lines: items.map((i) => ({ unitPrice: parseFloat(i.price.amount), quantity: i.quantity })),
    methodFee: Number(method?.fee ?? 0),
    isStandardShipping: method?.name === "Giao hàng tiêu chuẩn",
  });

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-3xl font-semibold">Giỏ hàng trống</h1>
        <Button asChild className="mt-6"><Link to="/">Tiếp tục mua sắm</Link></Button>
      </div>
    );
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!method) return;
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    setBusy(true);
    try {
      const res = await place({
        data: {
          customerName: get("name"),
          customerPhone: get("phone"),
          customerEmail: get("email") || user?.email || "",
          province: get("province"),
          district: get("district"),
          ward: get("ward"),
          street: get("street"),
          note: get("note"),
          shippingMethodId: method.id,
          paymentMethod: pay,
          promoCode: promo || undefined,
          lines: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
        },
      });
      clearCart();
      toast.success(`Đặt hàng thành công: ${res.orderNumber}`);
      navigate({ to: "/tra-cuu", search: { ma: res.orderNumber, sdt: get("phone") } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message.slice(0, 200) : "Đặt hàng thất bại");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[1fr_380px]">
      <div className="space-y-8">
        <h1 className="text-3xl font-semibold">Thông tin đặt hàng</h1>
        <section className="grid gap-4 sm:grid-cols-2">
          <Field name="name" label="Họ tên người nhận" required />
          <Field name="phone" label="Số điện thoại" required placeholder="09xxxxxxxx" />
          <Field name="email" label="Email (nhận xác nhận)" type="email" defaultValue={user?.email ?? ""} />
          <Field name="province" label="Tỉnh / Thành phố" required />
          <Field name="district" label="Quận / Huyện" required />
          <Field name="ward" label="Phường / Xã" required />
          <div className="sm:col-span-2"><Field name="street" label="Số nhà, tên đường" required /></div>
          <div className="sm:col-span-2">
            <Label htmlFor="note">Ghi chú</Label>
            <Textarea id="note" name="note" maxLength={500} placeholder="Ví dụ: gói quà, viết thiệp..." />
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Vận chuyển</h2>
          <div className="mt-3 grid gap-2">
            {methods.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-4 has-[:checked]:border-primary">
                <input type="radio" name="ship" checked={method?.id === m.id} onChange={() => setMethodId(m.id)} />
                <div className="flex-1">
                  <p className="font-medium">{m.name}</p>
                  <p className="text-sm text-muted-foreground">{m.description}</p>
                </div>
                <span className="font-medium">{Number(m.fee) === 0 ? "Miễn phí" : formatVND(m.fee)}</span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Thanh toán</h2>
          <div className="mt-3 grid gap-2">
            {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((k) => (
              <label key={k} className="flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-4 has-[:checked]:border-primary">
                <input type="radio" name="pay" checked={pay === k} onChange={() => setPay(k)} />
                <span>{PAYMENT_METHOD_LABEL[k]}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Chuyển khoản và ví điện tử đang ở chế độ mô phỏng cho mục đích trình diễn.</p>
        </section>
      </div>

      <aside className="h-fit space-y-4 rounded-2xl bg-card p-6 shadow-warm lg:sticky lg:top-24">
        <h2 className="text-xl font-semibold">Đơn hàng</h2>
        {items.map((i) => (
          <div key={i.variantId} className="flex justify-between gap-3 text-sm">
            <span className="line-clamp-2">{i.product.node.title} × {i.quantity}</span>
            <span>{formatVND(parseFloat(i.price.amount) * i.quantity)}</span>
          </div>
        ))}
        <div className="flex gap-2">
          <Input value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="Mã giảm giá" maxLength={30} />
        </div>
        <div className="space-y-1 border-t pt-3 text-sm">
          <Row l="Tạm tính" v={formatVND(totals.subtotal)} />
          <Row l="Phí giao hàng" v={totals.shippingFee === 0 ? "Miễn phí" : formatVND(totals.shippingFee)} />
          {promo && <p className="text-xs text-muted-foreground">Giảm giá được áp khi xác nhận đơn.</p>}
          <div className="flex justify-between pt-2 text-lg font-semibold"><span>Tổng</span><span className="text-primary">{formatVND(totals.total)}</span></div>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={busy || !method}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Xác nhận đặt hàng"}
        </Button>
      </aside>
    </form>
  );
}

function Row({ l, v }: { l: string; v: string }) {
  return <div className="flex justify-between"><span className="text-muted-foreground">{l}</span><span>{v}</span></div>;
}

function Field(props: { name: string; label: string; required?: boolean; type?: string; placeholder?: string; defaultValue?: string }) {
  return (
    <div>
      <Label htmlFor={props.name}>{props.label}</Label>
      <Input id={props.name} name={props.name} required={props.required} type={props.type} placeholder={props.placeholder} defaultValue={props.defaultValue} maxLength={255} />
    </div>
  );
}

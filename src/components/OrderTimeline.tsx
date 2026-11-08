import { STATUS_LABEL, type OrderStatus } from "@/lib/order-logic";

const STEPS: OrderStatus[] = ["pending", "confirmed", "packing", "shipping", "delivered"];

export function OrderProgress({ status }: { status: OrderStatus }) {
  if (status === "cancelled") return <p className="rounded-lg bg-destructive/10 p-3 text-destructive">Đơn hàng đã bị hủy</p>;
  const idx = STEPS.indexOf(status);
  return (
    <div className="flex items-center">
      {STEPS.map((s, i) => (
        <div key={s} className="flex flex-1 flex-col items-center text-center">
          <div className={`h-3 w-3 rounded-full ${i <= idx ? "bg-primary" : "bg-border"}`} />
          <span className={`mt-2 text-xs ${i <= idx ? "text-foreground" : "text-muted-foreground"}`}>{STATUS_LABEL[s]}</span>
        </div>
      ))}
    </div>
  );
}

export function EventList({ events }: { events: { id: string; status: string; note: string | null; created_at: string }[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3">
          <span className="w-36 flex-shrink-0 text-muted-foreground">{new Date(e.created_at).toLocaleString("vi-VN")}</span>
          <span>
            <b>{STATUS_LABEL[e.status as OrderStatus]}</b>
            {e.note ? ` — ${e.note}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

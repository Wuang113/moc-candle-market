import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { formatVND } from "@/lib/shopify";
import { STATUS_LABEL } from "@/lib/order-logic";
import { claimFirstAdmin } from "@/lib/orders.functions";

export const Route = createFileRoute("/_authenticated/tai-khoan")({
  head: () => ({
    meta: [
      { title: "Tài khoản của tôi — Nến Hương An Nhiên" },
      { name: "description", content: "Xem lịch sử đơn hàng của bạn." },
      { property: "og:title", content: "Tài khoản — Nến Hương An Nhiên" },
      { property: "og:description", content: "Lịch sử đơn hàng." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Account,
});

function Account() {
  const { user, isAdmin, refreshRole } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const claim = useServerFn(claimFirstAdmin);
  const { data: orders = [] } = useQuery({
    queryKey: ["my-orders", user?.id],
    enabled: !!user,
    queryFn: async () =>
      (await supabase.from("orders").select("*").eq("user_id", user!.id).order("created_at", { ascending: false })).data ?? [],
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Tài khoản</h1>
          <p className="text-muted-foreground">{user?.email}</p>
        </div>
        <div className="flex gap-2">
          {!isAdmin && (
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await claim();
                  await refreshRole();
                  toast.success("Bạn đã là quản trị viên");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Lỗi");
                }
              }}
            >
              Nhận quyền quản trị (demo)
            </Button>
          )}
          <Button variant="ghost" onClick={signOut}>Đăng xuất</Button>
        </div>
      </div>
      <h2 className="mt-10 text-xl font-semibold">Đơn hàng của tôi</h2>
      {orders.length === 0 ? (
        <p className="mt-4 text-muted-foreground">Bạn chưa có đơn hàng nào.</p>
      ) : (
        <div className="mt-4 divide-y rounded-2xl bg-card shadow-soft">
          {orders.map((o) => (
            <Link key={o.id} to="/tra-cuu" search={{ ma: o.order_number, sdt: o.customer_phone }} className="flex items-center justify-between p-4 hover:bg-muted">
              <div>
                <p className="font-medium">{o.order_number}</p>
                <p className="text-sm text-muted-foreground">{new Date(o.created_at).toLocaleString("vi-VN")}</p>
              </div>
              <div className="text-right">
                <p className="font-medium">{formatVND(o.total)}</p>
                <p className="text-sm text-muted-foreground">{STATUS_LABEL[o.status]}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Star, Send, CheckCircle2, PackageCheck, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { formatVND } from "@/lib/shopify";
import { STATUS_LABEL } from "@/lib/order-logic";
import { claimFirstAdmin, createProductReview } from "@/lib/orders.functions";
import { OrderChatBox } from "@/components/ChatBoxes";


export const Route = createFileRoute("/_authenticated/tai-khoan")({
  head: () => ({
    meta: [
      { title: "Tài khoản của tôi — Nến Hương An Nhiên" },
      { name: "description", content: "Xem lịch sử đơn hàng và đánh giá sản phẩm đã nhận." },
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
  const submitReviewFn = useServerFn(createProductReview);

  // State lưu trạng thái đánh giá cho từng món hàng (key = order_item.id)
  const [activeItemId, setActiveItemId] = useState("");
  const [ratingByItem, setRatingByItem] = useState({} as Record<string, number>);
  const [commentByItem, setCommentByItem] = useState({} as Record<string, string>);
  const [reviewedItems, setReviewedItems] = useState({} as Record<string, boolean>);
  const [busyItemId, setBusyItemId] = useState("");

  const { data: orders = [] } = useQuery({
    queryKey: ["my-orders", user?.id],
    enabled: !!user,
    refetchInterval: 8000,
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("*, order_items(*)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  async function handleSendReview(order: any, item: any) {
    const rating = ratingByItem[item.id] ?? 5;
    const comment = (commentByItem[item.id] ?? "").trim();

    if (comment.length < 3) {
      toast.error("Vui lòng nhập nhận xét (tối thiểu 3 ký tự)");
      return;
    }

    const displayName =
      user?.user_metadata?.["full_name"] ||
      user?.user_metadata?.["name"] ||
      order.customer_name ||
      user?.email?.split("@")[0] ||
      "Khách hàng";

    setBusyItemId(item.id);
    try {
      await submitReviewFn({
        data: {
          handle: item.product_handle,
          customerName: String(displayName),
          rating,
          comment,
        },
      });
      toast.success(`Đã gửi đánh giá cho "${item.product_title}"!`);
      setReviewedItems((prev) => ({ ...prev, [item.id]: true }));
      setActiveItemId("");
      qc.invalidateQueries({ queryKey: ["product-reviews", item.product_handle] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không thể gửi đánh giá");
    } finally {
      setBusyItemId("");
    }
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
        <div className="mt-4 space-y-4">
          {orders.map((o: any) => {
            const isDelivered = o.status === "delivered";
            const items = (o.order_items ?? []) as any[];

            return (
              <div key={o.id} className="overflow-hidden rounded-2xl border bg-card shadow-soft">
                {/* Header thông tin đơn hàng */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-base">{o.order_number}</p>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          isDelivered
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-secondary text-secondary-foreground"
                        }`}
                      >
                        {STATUS_LABEL[o.status as keyof typeof STATUS_LABEL] || o.status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Đặt lúc: {new Date(o.created_at).toLocaleString("vi-VN")}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-semibold text-primary">{formatVND(o.total)}</p>
                      <p className="text-xs text-muted-foreground">{items.length} sản phẩm</p>
                    </div>
                    <Button variant="outline" size="sm" asChild className="gap-1">
                      <Link to="/tra-cuu" search={{ ma: o.order_number, sdt: o.customer_phone }}>
                        Chi tiết <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </div>

                {/* Khung chat trao đổi trực tiếp với Shipper khi đơn đang đóng gói / đang giao */}
                {(o.status === "packing" || o.status === "shipping") && (
                <div className="border-t bg-muted/20 p-4">
                  <OrderChatBox
                    orderId={o.id}
                    orderNumber={o.order_number}
                    role="customer"
                    senderName={o.customer_name || user?.email?.split("@")[0] || "Khách hàng"}
                  />
                </div>
              )}

                {/* KHUNG ĐÁNH GIÁ SẢN PHẨM TỰ ĐỘNG HIỆN KHI SHIPPER GIAO XONG ĐƠN */}
                {isDelivered && items.length > 0 && (
                  <div className="border-t bg-amber-50/50 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                      <PackageCheck className="h-4 w-4 text-emerald-600" />
                      <span>Đơn hàng đã giao thành công — Hãy đánh giá sản phẩm bạn đã nhận:</span>
                    </div>

                    <div className="space-y-3">
                      {items.map((it: any) => {
                        const isReviewed = Boolean(reviewedItems[it.id]);
                        const isOpen = activeItemId === it.id || (!isReviewed && items.length === 1);
                        const currentRating = ratingByItem[it.id] ?? 5;
                        const currentComment = commentByItem[it.id] ?? "";

                        return (
                          <div key={it.id} className="rounded-xl border bg-background p-3.5 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex items-center gap-3">
                                {it.image_url && (
                                  <img
                                    src={it.image_url}
                                    alt={it.product_title}
                                    className="h-12 w-12 rounded-lg border object-cover"
                                  />
                                )}
                                <div>
                                  <Link
                                    to="/product/$handle"
                                    params={{ handle: it.product_handle }}
                                    className="font-medium text-sm hover:text-primary hover:underline"
                                  >
                                    {it.product_title}
                                  </Link>
                                  <p className="text-xs text-muted-foreground">
                                    {it.variant_title} × {it.quantity}
                                  </p>
                                </div>
                              </div>

                              {isReviewed ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Đã đánh giá
                                </span>
                              ) : (
                                items.length > 1 && (
                                  <Button
                                    size="sm"
                                    variant={isOpen ? "ghost" : "default"}
                                    onClick={() => setActiveItemId(isOpen ? "" : it.id)}
                                  >
                                    {isOpen ? "Thu gọn" : "Viết đánh giá"}
                                  </Button>
                                )
                              )}
                            </div>

                            {/* Form chọn sao & viết nhận xét */}
                            {!isReviewed && isOpen && (
                              <div className="space-y-3 border-t pt-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-medium text-muted-foreground">Chất lượng sản phẩm:</span>
                                  <div className="flex items-center gap-1">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                      <button
                                        key={star}
                                        type="button"
                                        onClick={() =>
                                          setRatingByItem((prev) => ({ ...prev, [it.id]: star }))
                                        }
                                        className="p-0.5 transition-transform hover:scale-110"
                                      >
                                        <Star
                                          className={`h-6 w-6 ${
                                            star <= currentRating
                                              ? "fill-amber-400 text-amber-400"
                                              : "text-muted-foreground/35"
                                          }`}
                                        />
                                      </button>
                                    ))}
                                  </div>
                                  <span className="text-xs font-medium text-amber-700">
                                    ({currentRating}/5 sao)
                                  </span>
                                </div>

                                <Textarea
                                  rows={2}
                                  value={currentComment}
                                  onChange={(e) =>
                                    setCommentByItem((prev) => ({ ...prev, [it.id]: e.target.value }))
                                  }
                                  placeholder="Chia sẻ cảm nhận của bạn về mùi hương, đóng gói, giao hàng..."
                                  maxLength={1000}
                                />

                                <div className="flex justify-end">
                                  <Button
                                    size="sm"
                                    disabled={busyItemId === it.id}
                                    onClick={() => handleSendReview(o, it)}
                                    className="gap-1.5"
                                  >
                                    <Send className="h-3.5 w-3.5" />
                                    {busyItemId === it.id ? "Đang gửi..." : "Gửi đánh giá"}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
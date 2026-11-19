import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle, Send, X, Truck, User, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { playMessageSound } from "@/lib/chat-sound";
import {
  listSupportMessages,
  sendSupportMessage,
  listOrderMessages,
  sendOrderMessage,
  listShipperOrders,
} from "@/lib/orders.functions";

// KHUNG CHAT NỔI GÓC DƯỚI BÊN PHẢI: GỒM 2 TAB (CHAT ADMIN & CHAT GIAO HÀNG THEO ĐƠN)
export function SupportChatWidget() {
  const { user, isAdmin, isShipper } = useAuth();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"support" | "delivery">("support");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const fetchSupportMsgs = useServerFn(listSupportMessages);
  const sendSupportMsg = useServerFn(sendSupportMessage);
  const fetchOrderMsgs = useServerFn(listOrderMessages);
  const sendOrderMsg = useServerFn(sendOrderMessage);
  const fetchShipperOrders = useServerFn(listShipperOrders);

  // 1. Lấy danh sách đơn hàng đang hoạt động của Khách hàng
  const { data: myOrders = [] } = useQuery({
    queryKey: ["chat-my-orders", user?.id],
    enabled: Boolean(user && !isAdmin),
    refetchInterval: 10000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("orders")
        .select("id, order_number, status, shipper_name")
        .eq("user_id", user!.id)
        .in("status", ["packing", "shipping"]);
      return data ?? [];
    },
  });

  // 2. Lấy danh sách đơn hàng mà Shipper đang phụ trách
  const { data: shipperOrders = [] } = useQuery({
    queryKey: ["chat-shipper-orders", user?.id],
    enabled: Boolean(user && isShipper),
    refetchInterval: 10000,
    queryFn: () => fetchShipperOrders(),
  });

  // Gộp các đơn hàng có thể nhắn tin giao nhận (đang đóng gói hoặc đang giao)
  const activeDeliveryOrders = (() => {
    const map = new Map<
      string,
      { id: string; order_number: string; partnerLabel: string; myRole: "customer" | "shipper" }
    >();

    for (const o of myOrders as any[]) {
      if (o.status === "packing" || o.status === "shipping") {
        map.set(o.id, {
          id: o.id,
          order_number: o.order_number,
          partnerLabel: o.shipper_name ? `Shipper: ${o.shipper_name}` : "Shipper giao hàng",
          myRole: "customer",
        });
      }
    }

    if (isShipper) {
      for (const o of shipperOrders as any[]) {
        if (o.status === "shipping") {
          map.set(o.id, {
            id: o.id,
            order_number: o.order_number,
            partnerLabel: `Khách: ${o.customer_name} (${o.customer_phone})`,
            myRole: "shipper",
          });
        }
      }
    }

    return Array.from(map.values());
  })();

  const hasDeliveryOrders = activeDeliveryOrders.length > 0;
  const currentOrder =
    activeDeliveryOrders.find((o) => o.id === selectedOrderId) || activeDeliveryOrders[0] || null;

  // Nếu là Admin kiêm Shipper và có đơn đang giao, tự mở sẵn tab Giao hàng
  useEffect(() => {
    if (isShipper && hasDeliveryOrders && activeTab === "support" && isAdmin) {
      setActiveTab("delivery");
    }
  }, [isShipper, hasDeliveryOrders, activeTab, isAdmin]);

  // 3. Tin nhắn kênh Hỗ trợ Admin
  const { data: supportMessages = [] } = useQuery({
    queryKey: ["support-chat", user?.id],
    enabled: Boolean(user && !isAdmin && activeTab === "support"),
    refetchInterval: open ? 3000 : 10000,
    queryFn: () => fetchSupportMsgs({ data: {} }),
  });

  // 4. Tin nhắn kênh Giao nhận theo đơn hàng
  const { data: orderMessages = [] } = useQuery({
    queryKey: ["order-messages", currentOrder?.id],
    enabled: Boolean(user && currentOrder?.id && activeTab === "delivery"),
    refetchInterval: open ? 3000 : 10000,
    queryFn: () => fetchOrderMsgs({ data: { orderId: currentOrder!.id } }),
  });

  // Lắng nghe Realtime cho kênh Hỗ trợ Admin + phát âm thanh khi có tin nhắn mới
  useEffect(() => {
    if (!user || isAdmin) return;
    const channel = supabase
      .channel(`widget-support-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `customer_user_id=eq.${user.id}`,
        },
        (payload: any) => {
          if (payload.new?.sender_id && payload.new.sender_id !== user.id) {
            playMessageSound();
          }
          qc.invalidateQueries({ queryKey: ["support-chat", user.id] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isAdmin, qc]);

  // Lắng nghe Realtime cho kênh Giao nhận đơn hàng + phát âm thanh khi có tin nhắn mới
  useEffect(() => {
    if (!user || !currentOrder?.id) return;
    const channel = supabase
      .channel(`widget-order-${currentOrder.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `order_id=eq.${currentOrder.id}`,
        },
        (payload: any) => {
          if (payload.new?.sender_id && payload.new.sender_id !== user.id) {
            playMessageSound();
          }
          qc.invalidateQueries({ queryKey: ["order-messages", currentOrder.id] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, currentOrder?.id, qc]);

  const displayedMessages = activeTab === "support" ? supportMessages : orderMessages;

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [displayedMessages.length, open, activeTab, currentOrder?.id]);

  // Ẩn widget nếu chưa đăng nhập, hoặc là Admin không có đơn Shipper đang giao
  if (!user) return null;
  if (isAdmin && !hasDeliveryOrders) return null;

  const displayName =
    user.user_metadata?.["full_name"] ||
    user.user_metadata?.["name"] ||
    user.email?.split("@")[0] ||
    "Người dùng";

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;

    setSending(true);
    try {
      if (activeTab === "support" && !isAdmin) {
        await sendSupportMsg({
          data: {
            senderName: String(displayName),
            content,
          },
        });
        qc.invalidateQueries({ queryKey: ["support-chat", user?.id] });
      } else if (activeTab === "delivery" && currentOrder) {
        await sendOrderMsg({
          data: {
            orderId: currentOrder.id,
            senderName: String(displayName),
            content,
          },
        });
        qc.invalidateQueries({ queryKey: ["order-messages", currentOrder.id] });
      }
      setText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không thể gửi tin nhắn");
    } finally {
      setSending(false);
    }
  }

  const effectiveTab = isAdmin ? "delivery" : activeTab;

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {!open ? (
        <Button
          onClick={() => {
            if (isAdmin) setActiveTab("delivery");
            setOpen(true);
          }}
          className="h-12 gap-2 rounded-full px-5 shadow-warm"
        >
          <MessageCircle className="h-5 w-5" />
          <span>
            {isAdmin
              ? `Chat Giao Hàng (${activeDeliveryOrders.length})`
              : hasDeliveryOrders
                ? "Tin nhắn & Giao hàng"
                : "Chat với Quản trị viên"}
          </span>
        </Button>
      ) : (
        <div className="flex h-[460px] w-[350px] sm:w-[385px] flex-col overflow-hidden rounded-2xl border bg-card shadow-warm">
          {/* Header trên cùng */}
          <div className="bg-primary px-4 py-3 text-primary-foreground">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {effectiveTab === "support" ? (
                  <ShieldCheck className="h-5 w-5" />
                ) : (
                  <Truck className="h-5 w-5" />
                )}
                <div>
                  <p className="text-sm font-semibold leading-tight">
                    {effectiveTab === "support"
                      ? "Hỗ trợ trực tuyến Mộc"
                      : "Trao đổi giao nhận đơn hàng"}
                  </p>
                  <p className="text-[11px] opacity-85">
                    {effectiveTab === "support"
                      ? "Nhắn tin trực tiếp với Quản trị viên"
                      : currentOrder
                        ? `${currentOrder.order_number} · ${currentOrder.partnerLabel}`
                        : "Chưa có đơn đang giao"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 hover:bg-white/15"
                aria-label="Đóng chat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Thanh chuyển đổi 2 kênh chat */}
            {!isAdmin && (
              <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-xl bg-black/15 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab("support")}
                  className={`rounded-lg py-1.5 font-medium transition ${
                    effectiveTab === "support"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-primary-foreground/85 hover:text-white"
                  }`}
                >
                  Quản trị viên
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("delivery")}
                  className={`rounded-lg py-1.5 font-medium transition flex items-center justify-center gap-1 ${
                    effectiveTab === "delivery"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-primary-foreground/85 hover:text-white"
                  }`}
                >
                  Shipper / Đơn hàng
                  {hasDeliveryOrders && (
                    <span className="rounded-full bg-amber-500 px-1.5 text-[10px] text-white">
                      {activeDeliveryOrders.length}
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Thanh chọn mã đơn hàng ở tab Giao hàng */}
          {effectiveTab === "delivery" && (
            <div className="border-b bg-muted/40 px-3 py-2">
              {hasDeliveryOrders ? (
                <select
                  value={currentOrder?.id || ""}
                  onChange={(e) => setSelectedOrderId(e.target.value)}
                  className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium"
                >
                  {activeDeliveryOrders.map((ord) => (
                    <option key={ord.id} value={ord.id}>
                      Đơn {ord.order_number} — {ord.partnerLabel}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-center text-[11px] text-muted-foreground py-0.5">
                  Bạn chưa có đơn hàng nào đang trong quá trình giao.
                </p>
              )}
            </div>
          )}

          {/* Khung hiển thị nội dung tin nhắn */}
          <div className="flex-1 space-y-2.5 overflow-y-auto bg-muted/30 p-3 text-sm">
            {effectiveTab === "support" ? (
              <>
                {supportMessages.length === 0 && (
                  <div className="rounded-xl bg-background p-3 text-center text-xs text-muted-foreground border">
                    Xin chào <b>{String(displayName)}</b>! Bạn cần tư vấn mùi hương hay hỗ trợ đơn hàng? Hãy nhắn tin cho Quản trị viên nhé.
                  </div>
                )}
                {supportMessages.map((m: any) => {
                  const isMine = m.sender_role === "customer";
                  return (
                    <div key={m.id} className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
                      <span className="mb-0.5 text-[10px] text-muted-foreground">
                        {m.sender_role === "admin" ? "Quản trị viên" : m.sender_name}
                      </span>
                      <div
                        className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                          isMine
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : "bg-background border text-foreground rounded-bl-sm shadow-soft"
                        }`}
                      >
                        {m.content}
                      </div>
                      <span className="mt-0.5 text-[10px] text-muted-foreground">
                        {new Date(m.created_at).toLocaleTimeString("vi-VN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  );
                })}
              </>
            ) : (
              <>
                {!hasDeliveryOrders ? (
                  <div className="rounded-xl bg-background p-4 text-center text-xs text-muted-foreground border">
                    Khi có đơn hàng đang giao, bạn có thể nhắn tin trực tiếp với Shipper / Khách nhận ngay tại đây.
                  </div>
                ) : orderMessages.length === 0 ? (
                  <div className="rounded-xl bg-background p-3 text-center text-xs text-muted-foreground border">
                    Chưa có tin nhắn cho đơn <b>{currentOrder?.order_number}</b>. Hãy nhắn để hẹn giờ hoặc chỉ dẫn địa chỉ giao hàng!
                  </div>
                ) : (
                  orderMessages.map((m: any) => {
                    const isMine = m.sender_id === user.id;
                    return (
                      <div key={m.id} className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
                        <span className="mb-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                          {m.sender_role === "shipper" ? (
                            <Truck className="h-2.5 w-2.5" />
                          ) : (
                            <User className="h-2.5 w-2.5" />
                          )}
                          {m.sender_role === "shipper" ? "Shipper" : "Khách đặt"} ({m.sender_name})
                        </span>
                        <div
                          className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                            isMine
                              ? "bg-primary text-primary-foreground rounded-br-sm"
                              : "bg-background border text-foreground rounded-bl-sm shadow-soft"
                          }`}
                        >
                          {m.content}
                        </div>
                        <span className="mt-0.5 text-[10px] text-muted-foreground">
                          {new Date(m.created_at).toLocaleTimeString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    );
                  })
                )}
              </>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Ô nhập tin nhắn */}
          <form onSubmit={handleSend} className="flex items-center gap-2 border-t bg-background p-2.5">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={effectiveTab === "delivery" && !hasDeliveryOrders}
              placeholder={
                effectiveTab === "support"
                  ? "Nhập tin nhắn gửi Quản trị viên..."
                  : hasDeliveryOrders
                    ? "Nhắn tin trao đổi giao nhận..."
                    : "Chưa có đơn hàng đang giao"
              }
              className="h-9 text-xs"
              maxLength={1000}
            />
            <Button
              type="submit"
              size="icon"
              className="h-9 w-9 shrink-0"
              disabled={sending || !text.trim() || (effectiveTab === "delivery" && !hasDeliveryOrders)}
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
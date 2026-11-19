import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle, Send, X, Truck, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  listSupportMessages,
  sendSupportMessage,
  listOrderMessages,
  sendOrderMessage,
} from "@/lib/orders.functions";

// 1. KHUNG CHAT NỔI GÓC MÀN HÌNH: KHÁCH HÀNG <-> QUẢN TRỊ VIÊN
export function SupportChatWidget() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const fetchMsgs = useServerFn(listSupportMessages);
  const sendMsg = useServerFn(sendSupportMessage);

  const { data: messages = [] } = useQuery({
    queryKey: ["support-chat", user?.id],
    enabled: Boolean(user && !isAdmin),
    refetchInterval: open ? 3000 : 10000,
    queryFn: () => fetchMsgs({ data: {} }),
  });

  // Lắng nghe Realtime trực tiếp từ bảng `messages` lọc đúng theo customer_user_id
  useEffect(() => {
    if (!user || isAdmin) return;
    const channel = supabase
      .channel(`support-chat-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `customer_user_id=eq.${user.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["support-chat", user.id] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isAdmin, qc]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  if (!user || isAdmin) return null;

  const displayName =
    user.user_metadata?.["full_name"] ||
    user.user_metadata?.["name"] ||
    user.email?.split("@")[0] ||
    "Khách hàng";

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setSending(true);
    try {
      await sendMsg({
        data: {
          senderName: String(displayName),
          content,
        },
      });
      setText("");
      qc.invalidateQueries({ queryKey: ["support-chat", user?.id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không thể gửi tin nhắn");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {!open ? (
        <Button
          onClick={() => setOpen(true)}
          className="h-12 gap-2 rounded-full px-5 shadow-warm"
        >
          <MessageCircle className="h-5 w-5" />
          <span>Chat với Quản trị viên</span>
        </Button>
      ) : (
        <div className="flex h-[430px] w-[340px] sm:w-[370px] flex-col overflow-hidden rounded-2xl border bg-card shadow-warm">
          <div className="flex items-center justify-between bg-primary px-4 py-3 text-primary-foreground">
            <div>
              <p className="text-sm font-semibold">Hỗ trợ trực tuyến An Nhiên</p>
              <p className="text-[11px] opacity-85">Nhắn tin trực tiếp với Quản trị viên</p>
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

          <div className="flex-1 space-y-2.5 overflow-y-auto bg-muted/30 p-3 text-sm">
            {messages.length === 0 && (
              <div className="rounded-xl bg-background p-3 text-center text-xs text-muted-foreground border">
                Xin chào <b>{String(displayName)}</b>! Bạn cần tư vấn mùi hương hay hỗ trợ đơn hàng? Hãy nhắn tin cho chúng tôi nhé.
              </div>
            )}
            {messages.map((m: any) => {
              const isMine = m.sender_role === "customer";
              return (
                <div key={m.id} className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
                  <span className="mb-0.5 text-[10px] text-muted-foreground">{m.sender_name}</span>
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
            <div ref={bottomRef} />
          </div>

          <form onSubmit={handleSend} className="flex items-center gap-2 border-t bg-background p-2.5">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Nhập tin nhắn gửi Admin..."
              className="h-9 text-xs"
              maxLength={1000}
            />
            <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={sending || !text.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

// 2. KHUNG CHAT THEO ĐƠN HÀNG: SHIPPER <-> NGƯỜI ĐẶT ĐƠN
export function OrderChatBox({
  orderId,
  orderNumber,
  role,
  senderName,
  defaultOpen = false,
}: {
  orderId: string;
  orderNumber: string;
  role: "customer" | "shipper" | "admin";
  senderName: string;
  defaultOpen?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const fetchMsgs = useServerFn(listOrderMessages);
  const sendMsg = useServerFn(sendOrderMessage);

  const { data: messages = [] } = useQuery({
    queryKey: ["order-messages", orderId],
    refetchInterval: open ? 3000 : 10000,
    queryFn: () => fetchMsgs({ data: { orderId } }),
  });

  // Lắng nghe Realtime trực tiếp từ bảng `messages` lọc đúng theo order_id
  useEffect(() => {
    const channel = supabase
      .channel(`order-chat-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `order_id=eq.${orderId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["order-messages", orderId] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId, qc]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const content = text.trim();
    if (!content) return;
    setSending(true);
    try {
      await sendMsg({
        data: {
          orderId,
          senderName: senderName || (role === "shipper" ? "Tài xế giao hàng" : "Khách đặt đơn"),
          content,
        },
      });
      setText("");
      qc.invalidateQueries({ queryKey: ["order-messages", orderId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lỗi gửi tin nhắn");
    } finally {
      setSending(false);
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()} className="mt-3 rounded-xl border bg-background">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3.5 py-2 text-xs font-medium hover:bg-muted/50"
      >
        <span className="flex items-center gap-1.5 text-primary">
          <MessageCircle className="h-3.5 w-3.5" />
          {role === "shipper"
            ? `Nhắn tin với Người đặt đơn (${orderNumber})`
            : `Nhắn tin với Shipper giao đơn (${orderNumber})`}
          {messages.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 py-0.2 text-[10px] text-primary-foreground">
              {messages.length}
            </span>
          )}
        </span>
        <span className="text-muted-foreground">{open ? "Thu gọn" : "Mở khung chat"}</span>
      </button>

      {open && (
        <div className="border-t p-3 space-y-2.5">
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg bg-muted/30 p-2.5">
            {messages.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-2">
                Chưa có tin nhắn nào cho đơn {orderNumber}. Hãy nhắn để trao đổi địa chỉ hoặc thời gian giao hàng!
              </p>
            )}
            {messages.map((m: any) => {
              const isMine = m.sender_role === role;
              return (
                <div key={m.id} className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
                  <span className="mb-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    {m.sender_role === "shipper" ? <Truck className="h-2.5 w-2.5" /> : <User className="h-2.5 w-2.5" />}
                    {m.sender_name}
                  </span>
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-1.5 text-xs ${
                      isMine
                        ? "bg-primary text-primary-foreground"
                        : "bg-card border text-foreground shadow-soft"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              );
            })}
          </div>

          <form onSubmit={handleSend} className="flex items-center gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                role === "shipper"
                  ? "Nhắn cho khách (VD: Em đang tới cổng, anh/chị ra nhận nhé)..."
                  : "Nhắn cho Shipper (VD: Giao giờ hành chính giúp mình nhé)..."
              }
              className="h-8 text-xs"
              maxLength={1000}
            />
            <Button type="submit" size="sm" className="h-8 gap-1 px-3" disabled={sending || !text.trim()}>
              <Send className="h-3.5 w-3.5" /> Gửi
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
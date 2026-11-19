import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  MapPin,
  Navigation,
  Phone,
  Package,
  CheckCircle2,
  Truck,
  Banknote,
  Clock,
  LocateFixed,
  UserCheck,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatVND } from "@/lib/shopify";
import { PAYMENT_METHOD_LABEL, STATUS_LABEL } from "@/lib/order-logic";
import { listShipperOrders, shipperHandleOrder } from "@/lib/orders.functions";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/giao-hang")({
  head: () => ({
    meta: [
      { title: "Cổng Người Giao Hàng — Nến Hương Mộc" },
      { name: "description", content: "Nhận đơn, xem bản đồ Google Maps và cập nhật hành trình giao hàng." },
    ],
  }),
  component: ShipperPortal,
});

const WAREHOUSE_ADDRESS = "Quận 1, Thành phố Hồ Chí Minh";

const MOVE_STAGES = [
  { step: 0, label: "Tại kho Mộc", note: "Shipper đã lấy hàng tại kho Nến Hương Mộc" },
  { step: 1, label: "Đang đi trên đường", note: "Shipper đang di chuyển trên tuyến đường chính hướng về khu vực giao" },
  { step: 2, label: "Sắp tới nơi (cách 500m)", note: "Shipper đã vào khu vực Phường/Xã của khách, chuẩn bị gọi điện" },
  { step: 3, label: "Đã tới điểm giao", note: "Shipper đã tới trước địa chỉ nhà khách hàng" },
];

function ShipperPortal() {
  const { user, isAdmin, isShipper, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const fetchOrders = useServerFn(listShipperOrders);
  const handleOrder = useServerFn(shipperHandleOrder);

  const [shipperName, setShipperName] = useState("");
  const [shipperPhone, setShipperPhone] = useState("0909123456");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [stageByOrder, setStageByOrder] = useState({} as Record<string, number>);
  const [busyId, setBusyId] = useState("");
  const [shipperFilter, setShipperFilter] = useState("all");

  // Tự động lấy tên tài khoản đang đăng nhập làm tên tài xế
  useEffect(() => {
    if (user?.email && !shipperName) {
      const nameFromAccount =
        user.user_metadata?.["full_name"] ||
        user.user_metadata?.["name"] ||
        user.email.split("@")[0];
      setShipperName(String(nameFromAccount));
    }
  }, [user, shipperName]);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["shipper-orders", user?.id],
    queryFn: () => fetchOrders(),
    enabled: Boolean(isShipper && user),
    refetchInterval: 8000,
  });

  if (authLoading) {
    return <p className="p-10 text-center text-muted-foreground">Đang kiểm tra quyền truy cập...</p>;
  }

  if (!isShipper) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center space-y-4">
        <h1 className="text-2xl font-semibold">Khu vực dành riêng cho Người giao hàng</h1>
        <p className="text-sm text-muted-foreground">
          Tài khoản của bạn chưa được cấp quyền Shipper. Vui lòng liên hệ Quản trị viên để được cấp quyền.
        </p>
      </div>
    );
  }

  // Lấy danh sách các Shipper đang có đơn (dành cho Admin lọc)
  const uniqueShippers = Array.from(
    new Set(
      orders
        .map((o: any) => o.shipper_name)
        .filter((name: any) => typeof name === "string" && name.trim().length > 0),
    ),
  ) as string[];

  const waitingOrders = orders.filter((o: any) => o.status === "packing");

  const shippingOrders = orders.filter((o: any) => {
    if (o.status !== "shipping") return false;
    if (isAdmin && shipperFilter !== "all") return o.shipper_name === shipperFilter;
    return true;
  });

  const deliveredOrders = orders.filter((o: any) => {
    if (o.status !== "delivered") return false;
    if (isAdmin && shipperFilter !== "all") return o.shipper_name === shipperFilter;
    return true;
  });

  const activeOrder =
    orders.find((o: any) => o.id === selectedOrderId) ||
    shippingOrders[0] ||
    waitingOrders[0] ||
    null;

  function getFullAddress(o: any) {
    return `${o.street}, ${o.ward}, ${o.district}, ${o.province}`;
  }

  function getCollectAmount(o: any) {
    if (o.payment_status === "paid" || o.payment_method !== "cod") return 0;
    return Number(o.total ?? 0);
  }

  async function onAcceptOrder(o: any) {
    if (!shipperName.trim() || !shipperPhone.trim()) {
      toast.error("Vui lòng nhập Tên và SĐT người giao hàng ở thanh trên cùng!");
      return;
    }
    setBusyId(o.id);
    try {
      await handleOrder({
        data: {
          orderId: o.id,
          shipperName,
          shipperPhone,
          action: "accept",
        },
      });
      setSelectedOrderId(o.id);
      setStageByOrder((prev) => ({ ...prev, [o.id]: 0 }));
      toast.success(`Đã nhận giao đơn ${o.order_number}!`);
      qc.invalidateQueries({ queryKey: ["shipper-orders"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không thể nhận đơn");
    } finally {
      setBusyId("");
    }
  }

  async function onAdvanceStage(o: any, nextStep: number) {
    const stageInfo = MOVE_STAGES[nextStep];
    if (!stageInfo) return;
    setBusyId(o.id);
    try {
      await handleOrder({
        data: {
          orderId: o.id,
          shipperName,
          shipperPhone,
          action: "checkpoint",
          checkpointNote: `${stageInfo.note} (${o.district}, ${o.province})`,
        },
      });
      setStageByOrder((prev) => ({ ...prev, [o.id]: nextStep }));
      toast.success(`Đã cập nhật vị trí: ${stageInfo.label}`);
      qc.invalidateQueries({ queryKey: ["shipper-orders"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lỗi cập nhật hành trình");
    } finally {
      setBusyId("");
    }
  }

  async function onCompleteOrder(o: any) {
    setBusyId(o.id);
    try {
      await handleOrder({
        data: {
          orderId: o.id,
          shipperName,
          shipperPhone,
          action: "complete",
        },
      });
      toast.success(`Giao thành công đơn ${o.order_number}!`);
      qc.invalidateQueries({ queryKey: ["shipper-orders"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lỗi hoàn tất đơn");
    } finally {
      setBusyId("");
    }
  }

  const totalEarnedFee = deliveredOrders.reduce((s: number, o: any) => s + Number(o.shipping_fee || 30000), 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-card p-5 shadow-warm border">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Truck className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Trạm Điều Phối Giao Hàng</h1>
              {isAdmin ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-3 py-0.5 text-xs font-semibold text-primary">
                  <ShieldCheck className="h-3.5 w-3.5" /> Chế độ Quản trị (Xem tất cả Shipper)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-0.5 text-xs font-semibold text-blue-800">
                  <UserCheck className="h-3.5 w-3.5" /> Tài khoản Shipper: {user?.email}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {isAdmin
                ? "Theo dõi toàn bộ đơn hàng đang giao và đã hoàn tất của tất cả nhân viên giao hàng"
                : "Nhận đơn mới, xem bản đồ Google Maps và quản lý các đơn hàng bạn đang phụ trách"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Tên tài xế giao hàng</Label>
            <Input
              value={shipperName}
              onChange={(e) => setShipperName(e.target.value)}
              className="h-9 w-44"
              placeholder="Tên của bạn"
            />
          </div>
          <div>
            <Label className="text-xs">SĐT tài xế</Label>
            <Input
              value={shipperPhone}
              onChange={(e) => setShipperPhone(e.target.value)}
              className="h-9 w-36"
              placeholder="09xxxxxxxx"
            />
          </div>
        </div>
      </div>

      {/* Bộ lọc theo từng Shipper — Chỉ hiện cho Admin khi có nhiều người giao hàng */}
      {isAdmin && uniqueShippers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-sm">
          <span className="font-medium text-muted-foreground">Lọc theo người giao hàng:</span>
          <Button
            size="sm"
            variant={shipperFilter === "all" ? "default" : "outline"}
            onClick={() => setShipperFilter("all")}
          >
            Tất cả tài xế ({uniqueShippers.length})
          </Button>
          {uniqueShippers.map((spName) => (
            <Button
              key={spName}
              size="sm"
              variant={shipperFilter === spName ? "default" : "outline"}
              onClick={() => setShipperFilter(spName)}
            >
              {spName}
            </Button>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-2xl bg-card p-4 shadow-soft border">
          <p className="text-xs text-muted-foreground">Đơn chờ nhận giao</p>
          <p className="mt-1 text-2xl font-bold text-amber-600">{waitingOrders.length} đơn</p>
        </div>
        <div className="rounded-2xl bg-card p-4 shadow-soft border">
          <p className="text-xs text-muted-foreground">
            {isAdmin ? "Tất cả đơn đang giao" : "Đơn bạn đang giao"}
          </p>
          <p className="mt-1 text-2xl font-bold text-blue-600">{shippingOrders.length} đơn</p>
        </div>
        <div className="rounded-2xl bg-card p-4 shadow-soft border">
          <p className="text-xs text-muted-foreground">
            {isAdmin ? "Tổng đơn đã giao" : "Đơn bạn đã giao"}
          </p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{deliveredOrders.length} đơn</p>
        </div>
        <div className="rounded-2xl bg-card p-4 shadow-soft border">
          <p className="text-xs text-muted-foreground">
            {isAdmin ? "Tổng cước vận chuyển" : "Cước vận chuyển của bạn"}
          </p>
          <p className="mt-1 text-2xl font-bold text-primary">{formatVND(totalEarnedFee)}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-4">
          <Tabs defaultValue="waiting">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="waiting">Đơn cần giao ({waitingOrders.length})</TabsTrigger>
              <TabsTrigger value="shipping">
                {isAdmin ? `Tất cả đang giao (${shippingOrders.length})` : `Đơn của tôi đang giao (${shippingOrders.length})`}
              </TabsTrigger>
              <TabsTrigger value="delivered">
                {isAdmin ? `Tất cả đã giao (${deliveredOrders.length})` : `Đơn của tôi đã giao (${deliveredOrders.length})`}
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: ĐƠN CHỜ NHẬN GIAO */}
            <TabsContent value="waiting" className="space-y-3 pt-3">
              {isLoading && <p className="p-6 text-muted-foreground">Đang tải danh sách đơn...</p>}
              {!isLoading && waitingOrders.length === 0 && (
                <div className="rounded-2xl border bg-card p-8 text-center text-muted-foreground">
                  Hiện không có đơn hàng nào đang chờ nhận giao.
                </div>
              )}
              {waitingOrders.map((o: any) => {
                const collectAmount = getCollectAmount(o);
                const fullAddr = getFullAddress(o);
                const isSelected = activeOrder?.id === o.id;
                return (
                  <div
                    key={o.id}
                    onClick={() => setSelectedOrderId(o.id)}
                    className={`cursor-pointer rounded-2xl border bg-card p-5 transition shadow-soft ${
                      isSelected ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/50"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold">{o.order_number}</span>
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                            {STATUS_LABEL[o.status as keyof typeof STATUS_LABEL] || o.status}
                          </span>
                        </div>
                        <p className="mt-1 font-medium">
                          Khách nhận: {o.customer_name} —{" "}
                          <a
                            href={`tel:${o.customer_phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-primary underline"
                          >
                            {o.customer_phone}
                          </a>
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Số tiền cần thu khách (COD):</p>
                        <p className={`text-xl font-bold ${collectAmount > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {collectAmount > 0 ? formatVND(collectAmount) : "0 ₫ (Đã trả online)"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Cước ship: {formatVND(Number(o.shipping_fee) || 30000)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-sm">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div className="flex-1">
                        <p className="font-medium text-foreground">{fullAddr}</p>
                        <p className="text-xs text-muted-foreground">
                          Gói giao: {o.shipping_methods?.name || "Tiêu chuẩn"} · Thanh toán:{" "}
                          {PAYMENT_METHOD_LABEL[o.payment_method as keyof typeof PAYMENT_METHOD_LABEL]}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="text-xs text-muted-foreground">
                        <Package className="mr-1 inline h-3.5 w-3.5" />
                        {o.order_items?.length || 0} món:{" "}
                        {(o.order_items ?? []).map((it: any) => `${it.product_title} (x${it.quantity})`).join(", ")}
                      </div>
                      <Button
                        size="sm"
                        disabled={busyId === o.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAcceptOrder(o);
                        }}
                        className="gap-1.5"
                      >
                        <Truck className="h-4 w-4" />
                        {busyId === o.id ? "Đang nhận..." : "Nhận đơn giao ngay"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </TabsContent>

            {/* TAB 2: ĐƠN ĐANG GIAO */}
            <TabsContent value="shipping" className="space-y-3 pt-3">
              {shippingOrders.length === 0 && (
                <div className="rounded-2xl border bg-card p-8 text-center text-muted-foreground">
                  {isAdmin
                    ? "Hiện chưa có Shipper nào đang đi giao đơn."
                    : "Bạn chưa nhận đơn nào để giao. Hãy sang tab \"Đơn cần giao\" để nhận đơn."}
                </div>
              )}
              {shippingOrders.map((o: any) => {
                const collectAmount = getCollectAmount(o);
                const fullAddr = getFullAddress(o);
                const currentStage = stageByOrder[o.id] ?? 0;
                const isSelected = activeOrder?.id === o.id;

                return (
                  <div
                    key={o.id}
                    onClick={() => setSelectedOrderId(o.id)}
                    className={`cursor-pointer rounded-2xl border bg-card p-5 transition shadow-soft ${
                      isSelected ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/50"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-lg font-bold">{o.order_number}</span>
                          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                            Đang giao hàng
                          </span>
                          {/* Hiện tên tài xế đang phụ trách đơn */}
                          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-foreground">
                            <UserCheck className="h-3 w-3 text-primary" />
                            Tài xế: {o.shipper_name || "Chưa cập nhật"}
                          </span>
                        </div>
                        <p className="mt-1 font-medium">
                          Người nhận: {o.customer_name} ·{" "}
                          <a href={`tel:${o.customer_phone}`} className="text-primary underline">
                            {o.customer_phone}
                          </a>
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Cần thu hộ (COD):</p>
                        <p className={`text-xl font-bold ${collectAmount > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {collectAmount > 0 ? formatVND(collectAmount) : "0 ₫ (Đã thanh toán)"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-sm">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{fullAddr}</span>
                    </div>

                    <div className="mt-4 space-y-2 rounded-xl border bg-background p-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold flex items-center gap-1">
                          <LocateFixed className="h-3.5 w-3.5 text-primary" /> Hành trình di chuyển thực tế:
                        </span>
                        <span className="text-primary font-medium">{MOVE_STAGES[currentStage]?.label}</span>
                      </div>

                      <div className="grid grid-cols-4 gap-1.5 pt-1">
                        {MOVE_STAGES.map((st) => (
                          <button
                            key={st.step}
                            type="button"
                            disabled={busyId === o.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onAdvanceStage(o, st.step);
                            }}
                            className={`rounded-lg px-2 py-1.5 text-[11px] font-medium transition border ${
                              currentStage >= st.step
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-muted/40 text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            {st.step + 1}. {st.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
                          WAREHOUSE_ADDRESS,
                        )}&destination=${encodeURIComponent(fullAddr)}&travelmode=two-wheeler`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-primary px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10"
                      >
                        <Navigation className="h-4 w-4" /> Mở Google Maps Chỉ Đường
                      </a>

                      <Button
                        size="sm"
                        disabled={busyId === o.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onCompleteOrder(o);
                        }}
                        className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {busyId === o.id ? "Đang xử lý..." : "Xác nhận Đã Giao & Thu Tiền"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </TabsContent>

            {/* TAB 3: ĐƠN ĐÃ GIAO */}
            <TabsContent value="delivered" className="space-y-3 pt-3">
              {deliveredOrders.length === 0 && (
                <div className="rounded-2xl border bg-card p-8 text-center text-muted-foreground">
                  Chưa có đơn hàng nào hoàn tất.
                </div>
              )}
              {deliveredOrders.map((o: any) => (
                <div
                  key={o.id}
                  onClick={() => setSelectedOrderId(o.id)}
                  className="cursor-pointer rounded-2xl border bg-card p-4 shadow-soft flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{o.order_number}</span>
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                        Đã giao thành công
                      </span>
                      {o.shipper_name && (
                        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground">
                          Tài xế: {o.shipper_name}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {o.customer_name} · {getFullAddress(o)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-emerald-700">{formatVND(o.total)}</p>
                    <p className="text-xs text-muted-foreground">Đã thu đủ / Hoàn tất</p>
                  </div>
                </div>
              ))}
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 h-fit">
          <div className="overflow-hidden rounded-2xl border bg-card shadow-warm">
            <div className="border-b bg-muted/40 p-4">
              {activeOrder ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                      Bản đồ định vị đơn: {activeOrder.order_number}
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {new Date(activeOrder.created_at).toLocaleString("vi-VN")}
                    </span>
                  </div>
                  <p className="font-semibold text-base flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-rose-600 shrink-0" />
                    {getFullAddress(activeOrder)}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-xs pt-1">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1 font-semibold text-rose-700 border border-rose-200">
                      <Banknote className="h-3.5 w-3.5" />
                      Thu hộ COD: {formatVND(getCollectAmount(activeOrder))}
                    </span>
                    <a
                      href={`tel:${activeOrder.customer_phone}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1 font-semibold text-primary"
                    >
                      <Phone className="h-3.5 w-3.5" /> Gọi khách: {activeOrder.customer_phone}
                    </a>
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
                        WAREHOUSE_ADDRESS,
                      )}&destination=${encodeURIComponent(getFullAddress(activeOrder))}&travelmode=two-wheeler`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-700 ml-auto"
                    >
                      <Navigation className="h-3.5 w-3.5" /> Dẫn đường GPS
                    </a>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Chọn một đơn hàng bên trái để xem vị trí và lộ trình trên Google Maps.
                </p>
              )}
            </div>

            <div className="relative h-[380px] w-full bg-muted">
              <iframe
                title="Google Maps Delivery"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                loading="lazy"
                allowFullScreen
                referrerPolicy="no-referrer-when-downgrade"
                src={`https://maps.google.com/maps?q=${encodeURIComponent(
                  activeOrder ? getFullAddress(activeOrder) : "Thành phố Hồ Chí Minh",
                )}&t=&z=15&ie=UTF8&iwloc=&output=embed`}
              />
            </div>

            {activeOrder && (
              <div className="p-4 space-y-2 text-sm border-t bg-card">
                <p className="font-semibold">Chi tiết kiện hàng cần giao:</p>
                <div className="divide-y rounded-xl border bg-muted/20 px-3">
                  {(activeOrder.order_items ?? []).map((it: any) => (
                    <div key={it.id} className="flex justify-between py-2 text-xs">
                      <span>
                        {it.product_title} ({it.variant_title}) × <b>{it.quantity}</b>
                      </span>
                      <span className="font-medium">{formatVND(Number(it.unit_price) * it.quantity)}</span>
                    </div>
                  ))}
                </div>
                {activeOrder.note && (
                  <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900 border border-amber-200">
                    <b>Ghi chú của khách:</b> {activeOrder.note}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
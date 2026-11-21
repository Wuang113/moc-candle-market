import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Plus, Pencil, Trash2, Minus, Upload, X, MessageCircle, Send, User } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { formatVND } from "@/lib/shopify";
import { playMessageSound } from "@/lib/chat-sound";
import {
  nextStatuses,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  STATUS_LABEL,
  type OrderStatus,
} from "@/lib/order-logic";
import {
  getAdminOverview,
  listAdminOrders,
  listCustomers,
  updateOrderStatus,
  listAdminProducts,
  upsertProduct,
  deleteProduct,
  toggleShipperRole,
  listSupportMessages,
  sendSupportMessage,
} from "@/lib/orders.functions";
import { EventList } from "@/components/OrderTimeline";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Quản trị — Nến Hương Mộc" },
      { name: "description", content: "Quản lý đơn hàng, khách hàng, sản phẩm và vận chuyển." },
      { property: "og:title", content: "Quản trị — Nến Hương Mộc" },
      { property: "og:description", content: "Trang quản trị cửa hàng." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Admin,
});

function readAndCompressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Không thể đọc file ảnh"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("File ảnh không hợp lệ"));
      img.onload = () => {
        const maxDim = 800;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

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
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Tổng quan</TabsTrigger>
          <TabsTrigger value="orders">Đơn hàng</TabsTrigger>
          <TabsTrigger value="customers">Khách hàng</TabsTrigger>
          <TabsTrigger value="products">Sản phẩm & Tồn kho</TabsTrigger>
          <TabsTrigger value="support" className="gap-1.5">
            <MessageCircle className="h-4 w-4" /> Tin nhắn khách hàng
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><Overview /></TabsContent>
        <TabsContent value="orders"><Orders /></TabsContent>
        <TabsContent value="customers"><Customers /></TabsContent>
        <TabsContent value="products"><Products /></TabsContent>
        <TabsContent value="support"><SupportInbox /></TabsContent>
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
        <Stat l="Chờ xác nhận" v={data.byStatus["pending"] ?? 0} />
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
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState("");
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

  const statusTabs: (OrderStatus | "all")[] = [
    "all",
    "pending",
    "confirmed",
    "packing",
    "shipping",
    "delivered",
    "cancelled",
  ];

  return (
    <div className="pt-4">
      <div className="flex flex-wrap gap-2">
        {statusTabs.map((s) => (
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
              <button className="text-left" onClick={() => setOpen(open === o.id ? "" : o.id)}>
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
                  {o.order_items.map((it) => (
                    <p key={it.id}>{it.product_title} × {it.quantity} — {formatVND(Number(it.unit_price) * it.quantity)}</p>
                  ))}
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
  const qc = useQueryClient();
  const fn = useServerFn(listCustomers);
  const toggleShipper = useServerFn(toggleShipperRole);
  const [busyUserId, setBusyUserId] = useState("");
  const { data = [] } = useQuery({ queryKey: ["admin-customers"], queryFn: () => fn() });

  async function handleToggleShipper(userId: string, currentlyShipper: boolean) {
    setBusyUserId(userId);
    try {
      await toggleShipper({ data: { targetUserId: userId, grant: !currentlyShipper } });
      toast.success(!currentlyShipper ? "Đã cấp quyền Người giao hàng!" : "Đã gỡ quyền Người giao hàng!");
      qc.invalidateQueries({ queryKey: ["admin-customers"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lỗi phân quyền");
    } finally {
      setBusyUserId("");
    }
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-2xl bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="p-3">Email</th>
            <th>Tên</th>
            <th>Vai trò</th>
            <th>Ngày tạo</th>
            <th>Số đơn</th>
            <th>Đã chi</th>
            <th className="p-3 text-right">Phân quyền giao hàng</th>
          </tr>
        </thead>
        <tbody>
          {data.map((c: any) => {
            const isUserAdmin = (c.roles ?? []).includes("admin");
            const isUserShipper = (c.roles ?? []).includes("shipper");
            return (
              <tr key={c.id} className="border-t">
                <td className="p-3">{c.email}</td>
                <td>{c.name}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {isUserAdmin && (
                      <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                        Admin
                      </span>
                    )}
                    {isUserShipper && (
                      <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                        Shipper
                      </span>
                    )}
                    {!isUserAdmin && !isUserShipper && (
                      <span className="text-xs text-muted-foreground">Khách hàng</span>
                    )}
                  </div>
                </td>
                <td>{new Date(c.createdAt).toLocaleDateString("vi-VN")}</td>
                <td>{c.orderCount}</td>
                <td>{formatVND(c.spent)}</td>
                <td className="p-3 text-right">
                  {isUserAdmin ? (
                    <span className="text-xs text-muted-foreground">Toàn quyền</span>
                  ) : (
                    <Button
                      size="sm"
                      variant={isUserShipper ? "outline" : "default"}
                      disabled={busyUserId === c.id}
                      onClick={() => handleToggleShipper(c.id, isUserShipper)}
                    >
                      {isUserShipper ? "Gỡ quyền Shipper" : "Cấp quyền Shipper"}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Products() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listAdminProducts);
  const saveProduct = useServerFn(upsertProduct);
  const removeProduct = useServerFn(deleteProduct);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["admin-products"],
    queryFn: () => fetchList(),
  });

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [handle, setHandle] = useState("");
  const [price, setPrice] = useState("280000");
  const [stock, setStock] = useState("20");
  const [variantTitle, setVariantTitle] = useState("Hũ thủy tinh 200g");
  const [imageUrl, setImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);

  function openCreate() {
    setId("");
    setTitle("");
    setHandle("");
    setPrice("280000");
    setStock("20");
    setVariantTitle("Hũ thủy tinh 200g");
    setImageUrl("");
    setDescription("");
    setActive(true);
    setEditing(true);
  }

  function openEdit(p: any) {
    setId(p.id);
    setTitle(p.title || "");
    setHandle(p.handle || "");
    setPrice(String(p.price ?? 0));
    setStock(String(p.stock ?? 0));
    setVariantTitle(p.variant_title || "Tiêu chuẩn (200g)");
    setImageUrl(p.image_url || "");
    setDescription(p.description || "");
    setActive(Boolean(p.active));
    setEditing(true);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Vui lòng chọn file hình ảnh (.jpg, .png, .webp...)");
      return;
    }
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const filePath = `candles/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("product-images")
        .upload(filePath, file, { cacheControl: "3600", upsert: false });

      if (!uploadErr) {
        const { data: pub } = supabase.storage.from("product-images").getPublicUrl(filePath);
        setImageUrl(pub.publicUrl);
        toast.success(`Đã tải ảnh "${file.name}" lên Cloud Storage!`);
        return;
      }

      // Dự phòng nếu chưa tạo bucket
      const dataUrl = await readAndCompressImage(file);
      setImageUrl(dataUrl);
      toast.success(`Đã tải ảnh "${file.name}" từ máy tính!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không thể xử lý ảnh");
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await saveProduct({
        data: {
          id: id || undefined,
          title,
          handle: handle || undefined,
          price: Math.max(0, Number(price) || 0),
          stock: Math.max(0, Math.round(Number(stock) || 0)),
          variant_title: variantTitle || "Tiêu chuẩn (200g)",
          image_url: imageUrl,
          description,
          active,
        },
      });
      toast.success(id ? "Đã cập nhật sản phẩm!" : "Đã thêm sản phẩm mới!");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không thể lưu sản phẩm");
    } finally {
      setSaving(false);
    }
  }

  async function adjustStock(p: any, delta: number) {
    const nextStock = Math.max(0, Number(p.stock ?? 0) + delta);
    try {
      await saveProduct({
        data: {
          id: p.id,
          title: p.title,
          handle: p.handle,
          price: Number(p.price ?? 0),
          stock: nextStock,
          variant_title: p.variant_title || "Tiêu chuẩn (200g)",
          image_url: p.image_url || "",
          description: p.description || "",
          active: Boolean(p.active),
        },
      });
      toast.success(`Đã cập nhật tồn kho "${p.title}": ${nextStock}`);
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lỗi cập nhật số lượng");
    }
  }

  async function handleDelete(p: any) {
    if (!window.confirm(`Bạn có chắc muốn xóa sản phẩm "${p.title}" không?`)) return;
    try {
      await removeProduct({ data: { id: p.id } });
      toast.success(`Đã xóa "${p.title}"`);
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lỗi xóa sản phẩm");
    }
  }

  return (
    <div className="space-y-6 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Danh sách sản phẩm ({products.length})</h2>
          <p className="text-sm text-muted-foreground">
            Thêm, sửa, xóa sản phẩm, tải ảnh từ máy tính và điều chỉnh số lượng tồn kho trực tiếp.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Thêm sản phẩm mới
        </Button>
      </div>

      {editing && (
        <form onSubmit={handleSave} className="space-y-4 rounded-2xl border bg-card p-6 shadow-warm">
          <div className="flex items-center justify-between border-b pb-3">
            <h3 className="text-lg font-semibold">
              {id ? "Chỉnh sửa sản phẩm" : "Thêm sản phẩm nến thơm mới"}
            </h3>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Đóng
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Tên sản phẩm *</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="VD: Nến Thơm Trà Trắng & Hoa Nhài"
                required
              />
            </div>
            <div>
              <Label>Đường dẫn (Slug / Handle — để trống sẽ tự tạo)</Label>
              <Input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="VD: nen-thom-tra-trang-hoa-nhai"
              />
            </div>
            <div>
              <Label>Giá bán (VNĐ) *</Label>
              <Input
                type="number"
                min={0}
                step={1000}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Số lượng tồn kho *</Label>
              <Input
                type="number"
                min={0}
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Quy cách / Phân loại</Label>
              <Input
                value={variantTitle}
                onChange={(e) => setVariantTitle(e.target.value)}
                placeholder="VD: Hũ gốm 200g"
              />
            </div>

            <div className="sm:col-span-2 space-y-2 rounded-xl border bg-muted/30 p-4">
              <Label className="text-sm font-medium">Hình ảnh sản phẩm (Chọn từ máy tính hoặc dán Link URL)</Label>
              <div className="flex flex-wrap items-center gap-4 pt-1">
                {imageUrl ? (
                  <div className="relative">
                    <img
                      src={imageUrl}
                      alt="Xem trước"
                      className="h-24 w-24 rounded-xl border object-cover bg-background shadow-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setImageUrl("")}
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-white shadow"
                      title="Xóa ảnh"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-xl border border-dashed bg-background text-xs text-muted-foreground">
                    Chưa có ảnh
                  </div>
                )}

                <div className="flex-1 min-w-[240px] space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label
                      htmlFor="upload-product-image"
                      className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground shadow hover:bg-primary/90"
                    >
                      <Upload className="h-4 w-4" /> Chọn ảnh từ máy tính
                    </Label>
                    <input
                      id="upload-product-image"
                      type="file"
                      accept="image/*"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <span className="text-xs text-muted-foreground">
                      Hỗ trợ JPG, PNG, WEBP (tự động tối ưu dung lượng)
                    </span>
                  </div>

                  <Input
                    value={imageUrl.startsWith("data:image/") ? "" : imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder={
                      imageUrl.startsWith("data:image/")
                        ? "Đang sử dụng ảnh tải lên từ máy tính (dán link mới vào đây nếu muốn thay thế)"
                        : "Hoặc dán trực tiếp link hình ảnh (https://...)"
                    }
                  />
                </div>
              </div>
            </div>

            <div className="sm:col-span-2">
              <Label>Mô tả chi tiết mùi hương & công dụng</Label>
              <Textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Nhập mô tả hương thơm, nguyên liệu sáp đậu nành, thời gian đốt..."
              />
            </div>
            <div className="sm:col-span-2 flex items-center gap-2">
              <input
                id="prod-active"
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="prod-active" className="cursor-pointer">
                Hiển thị mở bán ngoài cửa hàng
              </Label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Hủy
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Đang lưu..." : id ? "Lưu cập nhật" : "Tạo sản phẩm"}
            </Button>
          </div>
        </form>
      )}

      <div className="divide-y rounded-2xl bg-card shadow-soft">
        {isLoading && <p className="p-6 text-muted-foreground">Đang tải danh sách sản phẩm...</p>}
        {!isLoading && products.length === 0 && (
          <p className="p-6 text-muted-foreground">
            Chưa có sản phẩm nào trong bảng products. Hãy bấm "Thêm sản phẩm mới" hoặc chạy lệnh SQL tạo dữ liệu mẫu.
          </p>
        )}
        {products.map((p: any) => (
          <div key={p.id} className="flex flex-wrap items-center gap-4 p-4 text-sm">
            <img
              src={
                p.image_url ||
                "https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=400&q=80"
              }
              alt={p.title}
              className="h-14 w-14 rounded-xl object-cover border"
            />
            <div className="min-w-[200px] flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-base">{p.title}</p>
                {!p.active && (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">Đã ẩn</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Phân loại: {p.variant_title || "Tiêu chuẩn"} · Mã: {p.handle}
              </p>
            </div>

            <div className="text-right">
              <p className="font-semibold text-primary">{formatVND(p.price)}</p>
              <p className="text-xs text-muted-foreground">Đơn giá</p>
            </div>

            <div className="flex items-center gap-2 rounded-xl border bg-background px-2 py-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => adjustStock(p, -1)}
                disabled={Number(p.stock) <= 0}
                title="Giảm 1"
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <div className="min-w-[60px] text-center">
                <p className="font-semibold">{p.stock}</p>
                <p className="text-[10px] text-muted-foreground">
                  {Number(p.stock) > 0 ? "Tồn kho" : "Hết hàng"}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => adjustStock(p, 1)}
                title="Tăng 1"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => openEdit(p)} className="gap-1">
                <Pencil className="h-3.5 w-3.5" /> Sửa
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleDelete(p)}
                className="gap-1 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" /> Xóa
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SupportInbox() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const fetchCustomersFn = useServerFn(listCustomers);
  const fetchMsgsFn = useServerFn(listSupportMessages);
  const sendMsgFn = useServerFn(sendSupportMessage);

  const [selectedUserId, setSelectedUserId] = useState("");
  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const { data: rawCustomers } = useQuery({
    queryKey: ["admin-customers"],
    queryFn: () => fetchCustomersFn(),
  });

  const customers = Array.isArray(rawCustomers) ? rawCustomers : [];

  // Lọc danh sách các tài khoản không phải Admin
  const clientUsers = customers.filter((c: any) => !(c?.roles ?? []).includes("admin"));
  const filteredUsers = clientUsers.filter((c: any) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      String(c?.email ?? "").toLowerCase().includes(q) ||
      String(c?.name ?? "").toLowerCase().includes(q)
    );
  });

  const getCustomerId = (c: any) => String(c?.id || c?.user_id || "");
  const activeCustomer =
    clientUsers.find((c: any) => getCustomerId(c) === selectedUserId) ||
    filteredUsers[0] ||
    null;
  const activeUserId = getCustomerId(activeCustomer);

  const {
    data: rawMessages,
    isLoading: isLoadingMsgs,
    error: msgsError,
  } = useQuery({
    queryKey: ["support-chat", activeUserId],
    queryFn: () => fetchMsgsFn({ data: { targetUserId: activeUserId } }),
    enabled: Boolean(activeUserId),
    refetchInterval: 4000,
  });

  // Đảm bảo messages luôn là mảng dù server trả về array hay object
  const messages = Array.isArray(rawMessages)
    ? rawMessages
    : Array.isArray((rawMessages as any)?.messages)
      ? (rawMessages as any).messages
      : [];

  useEffect(() => {
    const channel = supabase
      .channel("admin-support-inbox-global")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload: any) => {
          if (
            payload.new?.channel_type === "support" &&
            payload.new?.sender_role === "customer"
          ) {
            playMessageSound();
            toast.info(`Tin nhắn mới từ ${payload.new.sender_name || "Khách hàng"}`);
          }
          if (activeUserId) {
            qc.invalidateQueries({ queryKey: ["support-chat", activeUserId] });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeUserId, qc]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, activeUserId]);

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    const content = reply.trim();
    if (!content || !activeUserId) return;

    const adminName =
      user?.user_metadata?.["full_name"] ||
      user?.user_metadata?.["name"] ||
      "Quản trị viên Mộc";

    setSending(true);
    try {
      await sendMsgFn({
        data: {
          targetUserId: activeUserId,
          senderName: String(adminName),
          content,
        },
      });
      setReply("");
      qc.invalidateQueries({ queryKey: ["support-chat", activeUserId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không thể gửi phản hồi");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-4 grid overflow-hidden rounded-2xl border bg-card shadow-soft md:grid-cols-[300px_1fr] h-[560px]">
      {/* Cột trái: Danh sách khách hàng */}
      <div className="flex flex-col border-r bg-muted/20 overflow-hidden">
        <div className="border-b p-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm email hoặc tên khách..."
            className="h-9 text-xs"
          />
        </div>
        <div className="flex-1 divide-y overflow-y-auto">
          {filteredUsers.length === 0 && (
            <p className="p-6 text-center text-xs text-muted-foreground">
              Không tìm thấy tài khoản khách hàng nào.
            </p>
          )}
          {filteredUsers.map((c: any, idx: number) => {
            const cId = getCustomerId(c);
            const isSelected = cId !== "" && cId === activeUserId;
            return (
              <button
                key={cId || idx}
                type="button"
                onClick={() => setSelectedUserId(cId)}
                className={`flex w-full items-start gap-2.5 p-3.5 text-left transition ${
                  isSelected ? "bg-primary/10 border-l-4 border-primary" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <User className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.name || c.email}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {c.orderCount ?? 0} đơn · {formatVND(c.spent ?? 0)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Cột phải: Khung hội thoại trực tiếp */}
      <div className="flex flex-col bg-background overflow-hidden">
        {activeCustomer ? (
          <>
            <div className="flex items-center justify-between border-b bg-card px-4 py-3">
              <div>
                <p className="font-semibold text-sm">{activeCustomer.name || activeCustomer.email}</p>
                <p className="text-xs text-muted-foreground">
                  {activeCustomer.email} · {activeCustomer.orderCount ?? 0} đơn hàng đã đặt
                </p>
              </div>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                Hỗ trợ trực tuyến
              </span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {isLoadingMsgs && (
                <p className="py-16 text-center text-xs text-muted-foreground">
                  Đang tải lịch sử tin nhắn...
                </p>
              )}
              {msgsError && (
                <p className="py-10 text-center text-xs text-destructive">
                  Lỗi tải tin nhắn: {msgsError instanceof Error ? msgsError.message : "Không thể kết nối máy chủ"}
                </p>
              )}
              {!isLoadingMsgs && !msgsError && messages.length === 0 && (
                <p className="py-16 text-center text-xs text-muted-foreground">
                  Chưa có tin nhắn nào với khách hàng này. Hãy gửi lời chào để bắt đầu hỗ trợ!
                </p>
              )}
              {messages.map((m: any, i: number) => {
                const isAdminMsg = m?.sender_role === "admin";
                return (
                  <div
                    key={m?.id || i}
                    className={`flex flex-col ${isAdminMsg ? "items-end" : "items-start"}`}
                  >
                    <span className="mb-1 px-1 text-[11px] text-muted-foreground">
                      {isAdminMsg ? "Quản trị viên" : m?.sender_name || "Khách hàng"} ·{" "}
                      {m?.created_at
                        ? new Date(m.created_at).toLocaleTimeString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                        isAdminMsg
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-secondary text-secondary-foreground rounded-bl-sm"
                      }`}
                    >
                      {m?.content}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            <form onSubmit={handleSendReply} className="flex items-center gap-2 border-t bg-card p-3">
              <Input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={`Trả lời ${activeCustomer.name || activeCustomer.email}...`}
                className="flex-1"
                maxLength={1000}
              />
              <Button type="submit" disabled={sending || !reply.trim()} className="gap-1.5">
                <Send className="h-4 w-4" /> Gửi phản hồi
              </Button>
            </form>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Chọn một khách hàng ở danh sách bên trái để xem và trả lời tin nhắn.
          </div>
        )}
      </div>
    </div>
  );
}
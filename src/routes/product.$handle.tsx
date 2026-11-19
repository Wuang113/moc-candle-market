import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Minus, Plus, Star, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchProductByHandle, formatVND } from "@/lib/shopify";
import { listProductReviews, createProductReview } from "@/lib/orders.functions";
import { useCartStore } from "@/stores/cart";
import { useAuth } from "@/hooks/useAuth";

const productQuery = (handle: string) =>
  queryOptions({ queryKey: ["product", handle], queryFn: () => fetchProductByHandle(handle) });

export const Route = createFileRoute("/product/$handle")({
  loader: async ({ context, params }) => {
    const p = await context.queryClient.ensureQueryData(productQuery(params.handle));
    if (!p) throw notFound();
    return { title: p.title, description: p.description, image: p.images.edges[0]?.node.url };
  },
  head: ({ loaderData }) => {
    const title = loaderData ? `${loaderData.title} — Nến Hương Mộc` : "Sản phẩm — Nến Hương Mộc";
    const desc = loaderData?.description?.slice(0, 155) ?? "Nến thơm thủ công";
    const meta = [
      { title },
      { name: "description", content: desc },
      { property: "og:title", content: title },
      { property: "og:description", content: desc },
      { property: "og:type", content: "product" },
      { name: "twitter:card", content: "summary_large_image" },
    ];
    if (loaderData?.image) {
      meta.push({ property: "og:image", content: loaderData.image }, { name: "twitter:image", content: loaderData.image });
    }
    return { meta };
  },
  component: ProductPage,
});

function ProductPage() {
  const { handle } = Route.useParams();
  const { data: p } = useSuspenseQuery(productQuery(handle));
  const { user } = useAuth();
  const qc = useQueryClient();

  const [qty, setQty] = useState(1);
  const [variantIdx, setVariantIdx] = useState(0);
  const [imgIdx, setImgIdx] = useState(0);
  const addItem = useCartStore((s) => s.addItem);
  const isLoading = useCartStore((s) => s.isLoading);

  // State cho phần đánh giá khách hàng
  const fetchReviews = useServerFn(listProductReviews);
  const submitReviewFn = useServerFn(createProductReview);
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [reviewerName, setReviewerName] = useState("");
  const [comment, setComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  const { data: reviews = [], isLoading: loadingReviews } = useQuery({
    queryKey: ["product-reviews", handle],
    queryFn: () => fetchReviews({ data: { handle } }),
  });

  useEffect(() => {
    if (user?.email && !reviewerName) {
      const defaultName = user.user_metadata?.['full_name'] || user.user_metadata?.['name'] || user.email.split("@")[0];
    }
  }, [user]);

  useEffect(() => {
    window.__lovableEvents?.track?.("project.product_viewed", { product_handle: handle });
  }, [handle]);

  if (!p) return null;

  const variant = p.variants.edges[variantIdx]?.node;
  const images = p.images.edges;

  const avgRating =
    reviews.length > 0
      ? (reviews.reduce((sum: number, r: any) => sum + Number(r.rating || 5), 0) / reviews.length).toFixed(1)
      : "0.0";

  const add = async () => {
    if (!variant) return;
    const ok = await addItem({
      product: { node: p },
      variantId: variant.id,
      variantTitle: variant.title,
      price: variant.price,
      quantity: qty,
      selectedOptions: variant.selectedOptions,
    });
    if (ok) {
      window.__lovableEvents?.track?.("project.product_added_to_cart", {
        product_handle: p.handle,
        quantity: qty,
      });
      toast.success("Đã thêm vào giỏ hàng");
    } else {
      toast.error("Không thể thêm vào giỏ");
    }
  };

  async function handleReviewSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reviewerName.trim()) {
      toast.error("Vui lòng nhập tên của bạn");
      return;
    }
    if (comment.trim().length < 3) {
      toast.error("Vui lòng nhập nội dung đánh giá (tối thiểu 3 ký tự)");
      return;
    }
    setSubmittingReview(true);
    try {
      await submitReviewFn({
        data: {
          handle,
          customerName: reviewerName.trim(),
          rating,
          comment: comment.trim(),
        },
      });
      toast.success("Cảm ơn bạn đã gửi đánh giá sản phẩm!");
      setComment("");
      setRating(5);
      qc.invalidateQueries({ queryKey: ["product-reviews", handle] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không thể gửi đánh giá");
    } finally {
      setSubmittingReview(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Quay lại cửa hàng
      </Link>
      <div className="mt-6 grid gap-10 md:grid-cols-2">
        <div>
          <div className="aspect-square overflow-hidden rounded-3xl bg-muted shadow-warm">
            {images[imgIdx] && <img src={images[imgIdx].node.url} alt={p.title} className="h-full w-full object-cover" />}
          </div>
          {images.length > 1 && (
            <div className="mt-3 flex gap-2">
              {images.map((im, i) => (
                <button key={im.node.url} onClick={() => setImgIdx(i)} className="h-16 w-16 overflow-hidden rounded-lg border">
                  <img src={im.node.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-sm uppercase tracking-wider text-accent">{p.productType}</p>
          <h1 className="mt-2 text-3xl font-semibold md:text-4xl">{p.title}</h1>

          {/* Hiển thị nhanh điểm sao trung bình */}
          <div className="mt-2 flex items-center gap-2 text-sm">
            <div className="flex items-center text-amber-500">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`h-4 w-4 ${
                    reviews.length > 0 && star <= Math.round(Number(avgRating))
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground/40"
                  }`}
                />
              ))}
            </div>
            <span className="text-muted-foreground">
              {reviews.length > 0 ? `${avgRating}/5 (${reviews.length} đánh giá)` : "Chưa có đánh giá"}
            </span>
          </div>

          <p className="mt-4 text-3xl font-semibold text-primary">{variant && formatVND(variant.price.amount)}</p>
          <p className="mt-6 leading-relaxed text-muted-foreground">{p.description}</p>

          {p.options.map((opt) => (
            <div key={opt.name} className="mt-6">
              <p className="text-sm font-medium">{opt.name}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {p.variants.edges.map((v, i) => (
                  <Button key={v.node.id} size="sm" variant={i === variantIdx ? "default" : "outline"} onClick={() => setVariantIdx(i)}>
                    {v.node.title}
                  </Button>
                ))}
              </div>
            </div>
          ))}

          <div className="mt-8 flex items-center gap-3">
            <div className="flex items-center rounded-full border">
              <Button variant="ghost" size="icon" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Giảm">
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-10 text-center">{qty}</span>
              <Button variant="ghost" size="icon" onClick={() => setQty(Math.min(20, qty + 1))} aria-label="Tăng">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <Button size="lg" className="flex-1" onClick={add} disabled={isLoading || !variant?.availableForSale}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : variant?.availableForSale ? "Thêm vào giỏ hàng" : "Hết hàng"}
            </Button>
          </div>
        </div>
      </div>

      {/* KHU VỰC ĐÁNH GIÁ CỦA KHÁCH HÀNG */}
      <section className="mt-14 border-t pt-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Đánh giá của khách hàng</h2>
            <p className="text-sm text-muted-foreground">
              {reviews.length > 0
                ? `Điểm trung bình ${avgRating} / 5 sao dựa trên ${reviews.length} nhận xét thực tế`
                : "Hãy là người đầu tiên chia sẻ cảm nhận về mùi hương sản phẩm này"}
            </p>
          </div>
          {reviews.length > 0 && (
            <div className="flex items-center gap-2 rounded-2xl bg-secondary px-4 py-2">
              <span className="text-2xl font-bold text-primary">{avgRating}</span>
              <div className="flex text-amber-500">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    className={`h-4 w-4 ${s <= Math.round(Number(avgRating)) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
                  />
                ))}
              </div>
              <span className="text-xs text-muted-foreground">({reviews.length})</span>
            </div>
          )}
        </div>

        <div className="mt-6 grid gap-8 lg:grid-cols-[380px_1fr]">
          {/* Form viết đánh giá mới */}
          <form onSubmit={handleReviewSubmit} className="h-fit space-y-4 rounded-2xl border bg-card p-6 shadow-soft">
            <h3 className="text-base font-semibold">Viết đánh giá của bạn</h3>

            <div>
              <Label className="text-xs text-muted-foreground">Mức độ hài lòng *</Label>
              <div className="mt-1.5 flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => {
                  const active = star <= (hoverRating || rating);
                  return (
                    <button
                      key={star}
                      type="button"
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(0)}
                      onClick={() => setRating(star)}
                      className="p-0.5 transition-transform hover:scale-110"
                      aria-label={`${star} sao`}
                    >
                      <Star
                        className={`h-7 w-7 ${
                          active ? "fill-amber-400 text-amber-400" : "text-muted-foreground/35"
                        }`}
                      />
                    </button>
                  );
                })}
                <span className="ml-2 text-xs font-medium text-muted-foreground">
                  {rating === 5
                    ? "Tuyệt vời"
                    : rating === 4
                      ? "Rất hài lòng"
                      : rating === 3
                        ? "Bình thường"
                        : rating === 2
                          ? "Chưa hài lòng"
                          : "Không hài lòng"}
                </span>
              </div>
            </div>

            <div>
              <Label htmlFor="reviewer-name">Tên hiển thị *</Label>
              <Input
                id="reviewer-name"
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                placeholder="Nhập tên của bạn..."
                required
                maxLength={100}
              />
            </div>

            <div>
              <Label htmlFor="review-comment">Cảm nhận về sản phẩm *</Label>
              <Textarea
                id="review-comment"
                rows={4}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Chia sẻ trải nghiệm của bạn về mùi hương, độ tỏa hương, thiết kế hũ nến..."
                required
                maxLength={1000}
              />
            </div>

            <Button type="submit" className="w-full gap-2" disabled={submittingReview}>
              <Send className="h-4 w-4" />
              {submittingReview ? "Đang gửi..." : "Gửi đánh giá"}
            </Button>
          </form>

          {/* Danh sách nhận xét đã gửi */}
          <div className="space-y-3">
            {loadingReviews && <p className="text-sm text-muted-foreground">Đang tải đánh giá...</p>}
            {!loadingReviews && reviews.length === 0 && (
              <div className="rounded-2xl bg-secondary/60 p-8 text-center text-sm text-muted-foreground">
                Chưa có đánh giá nào cho sản phẩm này. Hãy viết nhận xét đầu tiên ở khung bên trái nhé!
              </div>
            )}
            {reviews.map((rev: any) => (
              <div key={rev.id} className="rounded-2xl border bg-card p-5 shadow-soft space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                      {String(rev.customer_name || "K").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{rev.customer_name}</p>
                      <div className="flex items-center gap-0.5 text-amber-500">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star
                            key={s}
                            className={`h-3.5 w-3.5 ${
                              s <= Number(rev.rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(rev.created_at).toLocaleDateString("vi-VN")}
                  </span>
                </div>
                <p className="pt-1 text-sm leading-relaxed text-foreground/90">{rev.comment}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
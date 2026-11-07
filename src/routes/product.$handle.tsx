import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchProductByHandle, formatVND } from "@/lib/shopify";
import { useCartStore } from "@/stores/cart";

const productQuery = (handle: string) =>
  queryOptions({ queryKey: ["product", handle], queryFn: () => fetchProductByHandle(handle) });

export const Route = createFileRoute("/product/$handle")({
  loader: async ({ context, params }) => {
    const p = await context.queryClient.ensureQueryData(productQuery(params.handle));
    if (!p) throw notFound();
    return { title: p.title, description: p.description, image: p.images.edges[0]?.node.url };
  },
  head: ({ loaderData }) => {
    const title = loaderData ? `${loaderData.title} — Nến Hương An Nhiên` : "Sản phẩm — Nến Hương An Nhiên";
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
  const [qty, setQty] = useState(1);
  const [variantIdx, setVariantIdx] = useState(0);
  const [imgIdx, setImgIdx] = useState(0);
  const addItem = useCartStore((s) => s.addItem);
  const isLoading = useCartStore((s) => s.isLoading);
  if (!p) return null;

  const variant = p.variants.edges[variantIdx]?.node;
  const images = p.images.edges;

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
    ok ? toast.success("Đã thêm vào giỏ hàng") : toast.error("Không thể thêm vào giỏ");
  };

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

          <div className="mt-10 rounded-2xl bg-secondary p-5 text-sm">
            <p className="font-medium">Đánh giá sản phẩm</p>
            <p className="mt-1 text-muted-foreground">Chưa có đánh giá nào.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

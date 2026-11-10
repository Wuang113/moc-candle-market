import { Link } from "@tanstack/react-router";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCartStore } from "@/stores/cart";
import { formatVND, type ShopifyProduct } from "@/lib/shopify";

export function ProductCard({ product }: { product: ShopifyProduct }) {
  const addItem = useCartStore((s) => s.addItem);
  const isLoading = useCartStore((s) => s.isLoading);
  const p = product.node;
  const variant = p.variants.edges[0]?.node;
  const image = p.images.edges[0]?.node;

  const add = async () => {
    if (!variant) return;
    const ok = await addItem({
      product,
      variantId: variant.id,
      variantTitle: variant.title,
      price: variant.price,
      quantity: 1,
      selectedOptions: variant.selectedOptions,
    });
    if (ok) {
      window.__lovableEvents?.track?.("project.product_added_to_cart", {
        product_handle: p.handle,
        quantity: 1,
      });
      toast.success("Đã thêm vào giỏ hàng", { description: p.title });
    } else {
      toast.error("Không thể thêm vào giỏ");
    }
  };

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl bg-card shadow-soft transition hover:shadow-warm">
      <Link to="/product/$handle" params={{ handle: p.handle }} className="aspect-square overflow-hidden bg-muted">
        {image && (
          <img
            src={image.url}
            alt={image.altText ?? p.title}
            loading="lazy"
            width={600}
            height={600}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        )}
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-xs uppercase tracking-wider text-accent">{p.productType}</p>
        <Link to="/product/$handle" params={{ handle: p.handle }} className="mt-1 line-clamp-2 font-medium hover:text-primary">
          {p.title}
        </Link>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
        <div className="mt-auto flex items-center justify-between pt-4">
          <span className="text-lg font-semibold text-primary">{formatVND(p.priceRange.minVariantPrice.amount)}</span>
          <Button size="sm" onClick={add} disabled={isLoading || !variant?.availableForSale}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="mr-1 h-4 w-4" />Thêm</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

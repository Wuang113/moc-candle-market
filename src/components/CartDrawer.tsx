import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ShoppingBag, Minus, Plus, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useCartStore } from "@/stores/cart";
import { formatVND } from "@/lib/shopify";

export function CartDrawer() {
  const [open, setOpen] = useState(false);
  const { items, isLoading, isSyncing, updateQuantity, removeItem, getCheckoutUrl, syncCart } = useCartStore();
  const totalItems = items.reduce((s, i) => s + i.quantity, 0);
  const totalPrice = items.reduce((s, i) => s + parseFloat(i.price.amount) * i.quantity, 0);

  useEffect(() => {
    if (open) void syncCart();
  }, [open, syncCart]);

  const openShopifyCheckout = () => {
    const url = getCheckoutUrl();
    if (url) {
      window.open(url, "_blank");
      setOpen(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="relative rounded-full" aria-label="Giỏ hàng">
          <ShoppingBag className="h-5 w-5" />
          {totalItems > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
              {totalItems}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex h-full w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">Giỏ hàng</SheetTitle>
          <SheetDescription>{totalItems === 0 ? "Giỏ hàng đang trống" : `${totalItems} sản phẩm`}</SheetDescription>
        </SheetHeader>
        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <ShoppingBag className="h-12 w-12" />
            <p>Chưa có sản phẩm nào</p>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4">
              {items.map((item) => (
                <div key={item.variantId} className="flex gap-3">
                  <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                    {item.product.node.images.edges[0] && (
                      <img src={item.product.node.images.edges[0].node.url} alt={item.product.node.title} className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium">{item.product.node.title}</p>
                    <p className="mt-1 text-sm font-semibold text-primary">{formatVND(item.price.amount)}</p>
                    <div className="mt-2 flex items-center gap-1">
                      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.variantId, item.quantity - 1)} aria-label="Giảm">
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-8 text-center text-sm">{item.quantity}</span>
                      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.variantId, item.quantity + 1)} aria-label="Tăng">
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="ml-auto h-7 w-7" onClick={() => removeItem(item.variantId)} aria-label="Xóa">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-3 border-t px-4 pt-4 pb-4">
              <div className="flex justify-between text-lg font-semibold">
                <span>Tạm tính</span>
                <span>{formatVND(totalPrice)}</span>
              </div>
              <Button asChild size="lg" className="w-full" disabled={isLoading}>
                <Link to="/thanh-toan" onClick={() => setOpen(false)}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Đặt hàng"}
                </Link>
              </Button>
              <Button variant="outline" className="w-full" onClick={openShopifyCheckout} disabled={isLoading || isSyncing}>
                <ExternalLink className="mr-2 h-4 w-4" /> Thanh toán qua Shopify
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

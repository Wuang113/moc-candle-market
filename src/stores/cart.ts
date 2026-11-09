/**
 * Giỏ hàng đồng bộ với Shopify Storefront API.
 * Tạo giỏ khi thêm sản phẩm đầu tiên, cập nhật real-time với Shopify.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  addLineToShopifyCart,
  createShopifyCart,
  removeLineFromShopifyCart,
  storefrontApiRequest,
  updateShopifyCartLine,
  CART_QUERY,
  type ShopifyProduct,
} from "@/lib/shopify";

export interface CartItem {
  lineId: string | null;
  product: ShopifyProduct;
  variantId: string;
  variantTitle: string;
  price: { amount: string; currencyCode: string };
  quantity: number;
  selectedOptions: Array<{ name: string; value: string }>;
}

interface CartStore {
  items: CartItem[];
  cartId: string | null;
  checkoutUrl: string | null;
  isLoading: boolean;
  isSyncing: boolean;
  addItem: (item: Omit<CartItem, "lineId">) => Promise<boolean>;
  updateQuantity: (variantId: string, quantity: number) => Promise<void>;
  removeItem: (variantId: string) => Promise<void>;
  clearCart: () => void;
  syncCart: () => Promise<void>;
  getCheckoutUrl: () => string | null;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      cartId: null,
      checkoutUrl: null,
      isLoading: false,
      isSyncing: false,

      addItem: async (item) => {
        const { items, cartId, clearCart } = get();
        const existingItem = items.find((i) => i.variantId === item.variantId);

        set({ isLoading: true });
        try {
          if (!cartId) {
            const result = await createShopifyCart(item);
            if (result) {
              set({
                cartId: result.cartId,
                checkoutUrl: result.checkoutUrl,
                items: [{ ...item, lineId: result.lineId }],
              });
              return true;
            }
            return false;
          } else if (existingItem) {
            const newQuantity = existingItem.quantity + item.quantity;
            if (!existingItem.lineId) {
              console.error("Không thể cập nhật số lượng khi thiếu lineId:", existingItem);
              return false;
            }
            const result = await updateShopifyCartLine(cartId, existingItem.lineId, newQuantity);
            if (result.success) {
              const currentItems = get().items;
              set({
                items: currentItems.map((i) =>
                  i.variantId === item.variantId ? { ...i, quantity: newQuantity } : i,
                ),
              });
              return true;
            } else if (result.cartNotFound) {
              clearCart();
            }
            return false;
          } else {
            const result = await addLineToShopifyCart(cartId, item);
            if (result.success) {
              const currentItems = get().items;
              set({ items: [...currentItems, { ...item, lineId: result.lineId ?? null }] });
              return true;
            } else if (result.cartNotFound) {
              clearCart();
            }
            return false;
          }
        } catch (error) {
          console.error("Không thể thêm vào giỏ hàng:", error);
          return false;
        } finally {
          set({ isLoading: false });
        }
      },

      updateQuantity: async (variantId, quantity) => {
        if (quantity <= 0) {
          await get().removeItem(variantId);
          return;
        }

        const { items, cartId, clearCart } = get();
        const item = items.find((i) => i.variantId === variantId);
        if (!item?.lineId || !cartId) return;

        set({ isLoading: true });
        try {
          const result = await updateShopifyCartLine(cartId, item.lineId, quantity);
          if (result.success) {
            const currentItems = get().items;
            set({
              items: currentItems.map((i) => (i.variantId === variantId ? { ...i, quantity } : i)),
            });
          } else if (result.cartNotFound) {
            clearCart();
          }
        } catch (error) {
          console.error("Không thể cập nhật số lượng:", error);
        } finally {
          set({ isLoading: false });
        }
      },

      removeItem: async (variantId) => {
        const { items, cartId, clearCart } = get();
        const item = items.find((i) => i.variantId === variantId);
        if (!item) return;

        if (item.lineId && cartId) {
          const result = await removeLineFromShopifyCart(cartId, item.lineId);
          if (!result.success && !result.cartNotFound) {
            return;
          }
        }

        const newItems = items.filter((i) => i.variantId !== variantId);
        newItems.length === 0 ? clearCart() : set({ items: newItems });
      },

      clearCart: () => set({ items: [], cartId: null, checkoutUrl: null }),
      getCheckoutUrl: () => get().checkoutUrl,

      syncCart: async () => {
        const { cartId, isSyncing, clearCart } = get();
        if (!cartId || isSyncing) return;

        set({ isSyncing: true });
        try {
          const data = await storefrontApiRequest(CART_QUERY, { id: cartId });
          if (!data) return;
          const cart = data?.data?.cart;
          if (!cart || cart.totalQuantity === 0) clearCart();
        } catch (error) {
          console.error("Đồng bộ giỏ hàng với Shopify thất bại:", error);
        } finally {
          set({ isSyncing: false });
        }
      },
    }),
    {
      name: "shopify-cart",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        items: state.items,
        cartId: state.cartId,
        checkoutUrl: state.checkoutUrl,
      }),
    },
  ),
);

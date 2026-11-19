/**
 * Lớp kết nối dữ liệu Sản phẩm (Ưu tiên lấy từ bảng products của Supabase để Admin thêm/sửa/xóa trực tiếp,
 * tự động fallback sang Shopify nếu bảng products đang trống).
 */
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const SHOPIFY_API_VERSION = "2026-10";
export const SHOPIFY_STORE_PERMANENT_DOMAIN =
  "n-n-h-ng-an-nhi-n-kozjl-ttvvccu0.myshopify.com";
export const SHOPIFY_STOREFRONT_URL = `https://${SHOPIFY_STORE_PERMANENT_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`;

const SHOPIFY_STOREFRONT_TOKEN = "d2a78613e910965b703d4b989328138c";

export interface ShopifyImageEdge {
  node: { url: string; altText: string | null };
}

export interface ShopifySelectedOption {
  name: string;
  value: string;
}

export interface ShopifyVariantEdge {
  node: {
    id: string;
    title: string;
    price: { amount: string; currencyCode: string };
    availableForSale: boolean;
    selectedOptions: ShopifySelectedOption[];
  };
}

export interface ShopifyOption {
  name: string;
  values: string[];
}

export interface ShopifyProductNode {
  id: string;
  title: string;
  description: string;
  handle: string;
  productType: string;
  tags: string[];
  priceRange: {
    minVariantPrice: { amount: string; currencyCode: string };
  };
  images: {
    edges: ShopifyImageEdge[];
  };
  variants: {
    edges: ShopifyVariantEdge[];
  };
  options: ShopifyOption[];
}

export interface ShopifyProduct {
  node: ShopifyProductNode;
}

/** Chuyển đổi 1 dòng trong bảng products của Supabase sang cấu trúc chuẩn của giao diện */
function mapDbProductToShopify(p: any): ShopifyProduct {
  const priceStr = String(p.price ?? 0);
  const variantTitle = p.variant_title || "Tiêu chuẩn (200g)";
  const available = Boolean(p.active && Number(p.stock) > 0);
  const imgUrl =
    p.image_url ||
    "https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=800&q=80";

  return {
    node: {
      id: p.id,
      title: p.title,
      description: p.description || "",
      handle: p.handle,
      productType: p.category || "Nến thơm",
      tags: [`Tồn kho: ${p.stock}`],
      priceRange: {
        minVariantPrice: { amount: priceStr, currencyCode: "VND" },
      },
      images: {
        edges: [{ node: { url: imgUrl, altText: p.title } }],
      },
      variants: {
        edges: [
          {
            node: {
              id: `supabase-variant-${p.id}`,
              title: `${variantTitle} (Còn ${p.stock} SP)`,
              price: { amount: priceStr, currencyCode: "VND" },
              availableForSale: available,
              selectedOptions: [{ name: "Phân loại", value: variantTitle }],
            },
          },
        ],
      },
      options: [{ name: "Phân loại", values: [variantTitle] }],
    },
  };
}

export async function storefrontApiRequest(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(SHOPIFY_STOREFRONT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 402) {
    toast.error("Shopify: cần gói trả phí", {
      description: "API Shopify cần gói trả phí đang hoạt động. Mở admin.shopify.com để nâng cấp.",
    });
    return undefined;
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(`Lỗi Shopify API: ${data.errors.map((e: { message: string }) => e.message).join(", ")}`);
  }

  return data;
}

export const STOREFRONT_QUERY = `
  query GetProducts($first: Int!, $query: String) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          description
          handle
          productType
          tags
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          images(first: 5) {
            edges {
              node {
                url
                altText
              }
            }
          }
          variants(first: 10) {
            edges {
              node {
                id
                title
                price {
                  amount
                  currencyCode
                }
                availableForSale
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
          options {
            name
            values
          }
        }
      }
    }
  }
`;

export const PRODUCT_BY_HANDLE_QUERY = `
  query GetProductByHandle($handle: String!) {
    product(handle: $handle) {
      id
      title
      description
      handle
      productType
      tags
      priceRange {
        minVariantPrice {
          amount
          currencyCode
        }
      }
      images(first: 5) {
        edges {
          node {
            url
            altText
          }
        }
      }
      variants(first: 10) {
        edges {
          node {
            id
            title
            price {
              amount
              currencyCode
            }
            availableForSale
            selectedOptions {
              name
              value
            }
          }
        }
      }
      options {
        name
        values
      }
    }
  }
`;

export async function fetchProducts(first = 24, query?: string) {
  try {
    let q = (supabase as any)
      .from("products")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(first);

    if (query && query.trim()) {
      const clean = query.replace(/^title:\*|\*$/g, "").trim();
      if (clean) {
        q = q.ilike("title", `%${clean}%`);
      }
    }

    const { data: dbProducts, error } = await q;
    if (!error && dbProducts && dbProducts.length > 0) {
      return dbProducts.map(mapDbProductToShopify) as ShopifyProduct[];
    }
  } catch {
    // Nếu chưa tạo bảng products thì fallback xuống Shopify
  }

  const data = await storefrontApiRequest(STOREFRONT_QUERY, { first, query: query ?? null });
  return (data?.data?.products?.edges ?? []) as ShopifyProduct[];
}

export async function fetchProductByHandle(handle: string) {
  try {
    const { data: p, error } = await (supabase as any)
      .from("products")
      .select("*")
      .eq("handle", handle)
      .maybeSingle();

    if (!error && p) {
      return mapDbProductToShopify(p).node;
    }
  } catch {
    // Fallback sang Shopify
  }

  const data = await storefrontApiRequest(PRODUCT_BY_HANDLE_QUERY, { handle });
  return (data?.data?.product ?? null) as ShopifyProductNode | null;
}

// ================= GIỎ HÀNG (HỖ TRỢ CẢ SUPABASE VÀ SHOPIFY) =================

const CART_QUERY = `
  query cart($id: ID!) {
    cart(id: $id) { id totalQuantity }
  }
`;

const CART_CREATE_MUTATION = `
  mutation cartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
        lines(first: 100) { edges { node { id merchandise { ... on ProductVariant { id } } } } }
      }
      userErrors { field message }
    }
  }
`;

const CART_LINES_ADD_MUTATION = `
  mutation cartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart {
        id
        lines(first: 100) { edges { node { id merchandise { ... on ProductVariant { id } } } } }
      }
      userErrors { field message }
    }
  }
`;

const CART_LINES_UPDATE_MUTATION = `
  mutation cartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) {
      cart { id }
      userErrors { field message }
    }
  }
`;

const CART_LINES_REMOVE_MUTATION = `
  mutation cartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
      cart { id }
      userErrors { field message }
    }
  }
`;

function formatCheckoutUrl(checkoutUrl: string): string {
  try {
    const url = new URL(checkoutUrl);
    url.searchParams.set("channel", "online_store");
    return url.toString();
  } catch {
    return checkoutUrl;
  }
}

interface UserError {
  field: string[] | null;
  message: string;
}

function isCartNotFoundError(userErrors: UserError[]): boolean {
  return userErrors.some(
    (e) => e.message.toLowerCase().includes("cart not found") || e.message.toLowerCase().includes("does not exist"),
  );
}

function isLocalVariant(id: string) {
  return id.startsWith("supabase-variant-") || !id.startsWith("gid://");
}

export async function createShopifyCart(item: { quantity: number; variantId: string }) {
  if (isLocalVariant(item.variantId)) {
    return {
      cartId: `local-cart-${Date.now()}`,
      checkoutUrl: "/thanh-toan",
      lineId: `local-line-${item.variantId}`,
    };
  }

  const data = await storefrontApiRequest(CART_CREATE_MUTATION, {
    input: { lines: [{ quantity: item.quantity, merchandiseId: item.variantId }] },
  });

  if (data?.data?.cartCreate?.userErrors?.length > 0) {
    console.error("Tạo giỏ hàng thất bại:", data.data.cartCreate.userErrors);
    return null;
  }

  const cart = data?.data?.cartCreate?.cart;
  if (!cart?.checkoutUrl) return null;

  const lineId = cart.lines.edges[0]?.node?.id;
  if (!lineId) return null;

  return { cartId: cart.id, checkoutUrl: formatCheckoutUrl(cart.checkoutUrl), lineId };
}

export async function addLineToShopifyCart(
  cartId: string,
  item: { quantity: number; variantId: string },
) {
  if (cartId.startsWith("local-cart-") || isLocalVariant(item.variantId)) {
    return { success: true, lineId: `local-line-${item.variantId}`, cartNotFound: false };
  }

  const data = await storefrontApiRequest(CART_LINES_ADD_MUTATION, {
    cartId,
    lines: [{ quantity: item.quantity, merchandiseId: item.variantId }],
  });

  const userErrors: UserError[] = data?.data?.cartLinesAdd?.userErrors || [];
  if (isCartNotFoundError(userErrors)) return { success: false, cartNotFound: true };
  if (userErrors.length > 0) {
    console.error("Thêm sản phẩm vào giỏ thất bại:", userErrors);
    return { success: false };
  }

  const lines = data?.data?.cartLinesAdd?.cart?.lines?.edges || [];
  const newLine = lines.find(
    (l: { node: { id: string; merchandise: { id: string } } }) => l.node.merchandise.id === item.variantId,
  );
  return { success: true, lineId: newLine?.node?.id };
}

export async function updateShopifyCartLine(
  cartId: string,
  lineId: string,
  quantity: number,
) {
  if (cartId.startsWith("local-cart-") || lineId.startsWith("local-line-")) {
    return { success: true, cartNotFound: false };
  }

  const data = await storefrontApiRequest(CART_LINES_UPDATE_MUTATION, {
    cartId,
    lines: [{ id: lineId, quantity }],
  });

  const userErrors: UserError[] = data?.data?.cartLinesUpdate?.userErrors || [];
  if (isCartNotFoundError(userErrors)) return { success: false, cartNotFound: true };
  if (userErrors.length > 0) {
    console.error("Cập nhật giỏ hàng thất bại:", userErrors);
    return { success: false };
  }
  return { success: true };
}

export async function removeLineFromShopifyCart(
  cartId: string,
  lineId: string,
) {
  if (cartId.startsWith("local-cart-") || lineId.startsWith("local-line-")) {
    return { success: true, cartNotFound: false };
  }

  const data = await storefrontApiRequest(CART_LINES_REMOVE_MUTATION, {
    cartId,
    lineIds: [lineId],
  });

  const userErrors: UserError[] = data?.data?.cartLinesRemove?.userErrors || [];
  if (isCartNotFoundError(userErrors)) return { success: false, cartNotFound: true };
  if (userErrors.length > 0) {
    console.error("Xóa sản phẩm khỏi giỏ thất bại:", userErrors);
    return { success: false };
  }
  return { success: true };
}

export { CART_QUERY, formatCheckoutUrl };

/** Định dạng giá tiền Việt Nam đồng */
export function formatVND(amount: string | number): string {
  const value = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}
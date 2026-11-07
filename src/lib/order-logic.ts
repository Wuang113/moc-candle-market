/**
 * Quy tắc nghiệp vụ đơn hàng — thuần, không phụ thuộc DB, dùng chung client/server và để kiểm thử.
 */
export type OrderStatus = "pending" | "confirmed" | "packing" | "shipping" | "delivered" | "cancelled";
export type PaymentMethod = "cod" | "bank_transfer" | "ewallet";
export type PaymentStatus = "unpaid" | "paid" | "refunded";

/** Đơn từ mức này trở lên được miễn phí giao hàng tiêu chuẩn */
export const FREE_SHIPPING_THRESHOLD = 500_000;
export const MAX_QTY_PER_LINE = 20;

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  packing: "Đang đóng gói",
  shipping: "Đang giao hàng",
  delivered: "Đã giao",
  cancelled: "Đã hủy",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cod: "Thanh toán khi nhận hàng (COD)",
  bank_transfer: "Chuyển khoản ngân hàng",
  ewallet: "Ví điện tử (MoMo/ZaloPay)",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Chưa thanh toán",
  paid: "Đã thanh toán",
  refunded: "Đã hoàn tiền",
};

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["packing", "cancelled"],
  packing: ["shipping", "cancelled"],
  shipping: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function nextStatuses(current: OrderStatus): OrderStatus[] {
  return TRANSITIONS[current];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Trạng thái thanh toán sau khi chuyển trạng thái đơn */
export function paymentStatusAfter(
  to: OrderStatus,
  method: PaymentMethod,
  current: PaymentStatus,
): PaymentStatus {
  if (to === "delivered" && method === "cod") return "paid";
  if (to === "cancelled" && current === "paid") return "refunded";
  return current;
}

export function calcShippingFee(subtotal: number, methodFee: number, isStandard: boolean): number {
  if (isStandard && subtotal >= FREE_SHIPPING_THRESHOLD) return 0;
  return methodFee;
}

export function calcDiscount(subtotal: number, percent: number | null | undefined): number {
  if (!percent || percent <= 0) return 0;
  return Math.round((subtotal * Math.min(percent, 100)) / 100);
}

export function calcTotals(input: {
  lines: Array<{ unitPrice: number; quantity: number }>;
  methodFee: number;
  isStandardShipping: boolean;
  discountPercent?: number | null;
}) {
  const subtotal = input.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const discount = calcDiscount(subtotal, input.discountPercent);
  const shippingFee = calcShippingFee(subtotal, input.methodFee, input.isStandardShipping);
  const total = Math.max(0, subtotal - discount + shippingFee);
  return { subtotal, discount, shippingFee, total };
}

/** Số điện thoại di động Việt Nam: 0 + 9 chữ số (03, 05, 07, 08, 09) */
export function isValidVNPhone(phone: string): boolean {
  return /^0(3|5|7|8|9)\d{8}$/.test(phone.replace(/\s|\./g, ""));
}

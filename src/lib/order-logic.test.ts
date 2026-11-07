import { describe, expect, it } from "vitest";
import {
  calcTotals,
  canTransition,
  isValidVNPhone,
  paymentStatusAfter,
} from "./order-logic";

describe("tính tiền đơn hàng", () => {
  it("miễn phí giao hàng tiêu chuẩn khi tạm tính từ 500.000đ", () => {
    const t = calcTotals({ lines: [{ unitPrice: 250_000, quantity: 2 }], methodFee: 25_000, isStandardShipping: true });
    expect(t.shippingFee).toBe(0);
    expect(t.total).toBe(500_000);
  });

  it("tính phí giao hàng khi dưới 500.000đ", () => {
    const t = calcTotals({ lines: [{ unitPrice: 285_000, quantity: 1 }], methodFee: 25_000, isStandardShipping: true });
    expect(t.total).toBe(310_000);
  });

  it("giao nhanh vẫn tính phí dù đơn lớn", () => {
    const t = calcTotals({ lines: [{ unitPrice: 490_000, quantity: 2 }], methodFee: 35_000, isStandardShipping: false });
    expect(t.shippingFee).toBe(35_000);
  });

  it("mã giảm 10% áp trên tạm tính", () => {
    const t = calcTotals({
      lines: [{ unitPrice: 320_000, quantity: 1 }],
      methodFee: 25_000,
      isStandardShipping: true,
      discountPercent: 10,
    });
    expect(t.discount).toBe(32_000);
    expect(t.total).toBe(313_000);
  });
});

describe("chuyển trạng thái đơn", () => {
  it("không thể giao khi chưa xác nhận", () => {
    expect(canTransition("pending", "delivered")).toBe(false);
  });
  it("không thể hủy đơn đang giao", () => {
    expect(canTransition("shipping", "cancelled")).toBe(false);
  });
  it("COD chuyển thành đã thanh toán khi giao thành công", () => {
    expect(paymentStatusAfter("delivered", "cod", "unpaid")).toBe("paid");
  });
  it("hủy đơn đã thanh toán thì hoàn tiền", () => {
    expect(paymentStatusAfter("cancelled", "bank_transfer", "paid")).toBe("refunded");
  });
});

describe("số điện thoại", () => {
  it("chấp nhận số di động VN", () => expect(isValidVNPhone("0912345678")).toBe(true));
  it("từ chối số sai", () => expect(isValidVNPhone("12345")).toBe(false));
});

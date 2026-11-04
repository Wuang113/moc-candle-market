# Roadmap — Hệ thống TMĐT "Nến Hương An Nhiên"

Dự án môn học: xây dựng hệ thống thương mại điện tử bán nến hương, vận hành được trong thực tế, tiếng Việt.

## Kiến trúc đã chốt
- Giao diện & logic: TanStack Start (React 19) trên Lovable.
- Sản phẩm & giỏ hàng: Shopify (store thật, API 2026-10).
- Tài khoản, đơn hàng, thanh toán mô phỏng, quản trị: Lovable Cloud (database + auth + RLS).
- Thanh toán: mô phỏng cho demo (COD / chuyển khoản / ví) — không cổng thanh toán thật.
- Ngôn ngữ: tiếng Việt.

## Nhiệm vụ
- [x] Chọn kiến trúc, kích hoạt Lovable Cloud + Shopify
- [ ] Migration CSDL: profiles, user_roles, orders, order_items, payments, shipping, addresses, categories
- [ ] Tạo bộ sản phẩm nến hương trong Shopify (kèm hình ảnh)
- [ ] Storefront: trang chủ, danh mục, chi tiết sản phẩm, giỏ hàng (Shopify cart API)
- [ ] Đặt hàng + thanh toán mô phỏng (COD/chuyển khoản/ví) → ghi đơn vào CSDL
- [ ] Đăng ký/đăng nhập khách hàng (email + Google + Lovable)
- [ ] Trang tài khoản: đơn hàng của tôi, địa chỉ
- [ ] Trang quản trị (/admin): tổng quan, sản phẩm (đọc từ Shopify), đơn hàng, khách hàng, vận chuyển, trạng thái đơn
- [ ] Bảo mật: RLS từng bảng, vai trò admin qua user_roles, kiểm tra role phía server
- [ ] Kiểm thử: unit test logic đơn hàng + kiểm tra luồng thật qua trình duyệt
- [ ] Tài liệu phân tích - thiết kế (nghiệp vụ, ERD, use case) cho báo cáo
- [ ] Publish + hướng dẫn vận hành/giám sát

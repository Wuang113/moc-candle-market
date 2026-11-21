import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { User as UserIcon, ShieldCheck, Truck } from "lucide-react";
import { Analytics } from "@vercel/analytics/react";

import appCss from "../styles.css?url";
import candleLogo from "@/assets/logo-candle-cup.png";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { CartDrawer } from "@/components/CartDrawer";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useCartStore } from "@/stores/cart";
import { SupportChatWidget } from "@/components/ChatBoxes";

function NotFoundComponent() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Không tìm thấy trang</h2>
        <p className="mt-2 text-sm text-muted-foreground">Trang bạn tìm không tồn tại hoặc đã được di chuyển.</p>
        <Button asChild className="mt-6">
          <Link to="/">Về trang chủ</Link>
        </Button>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Trang chưa tải được</h1>
        <p className="mt-2 text-sm text-muted-foreground">Đã có lỗi xảy ra. Bạn thử tải lại hoặc về trang chủ.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Thử lại
          </Button>
          <Button variant="outline" asChild>
            <a href="/">Về trang chủ</a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Nến Hương Mộc — Nến thơm thủ công Việt Nam" },
      { name: "description", content: "Cửa hàng nến thơm đậu nành thủ công, giao hàng toàn quốc." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Analytics />
        <Scripts />
      </body>
    </html>
  );
}

function CartSync() {
  const syncCart = useCartStore((s) => s.syncCart);
  useEffect(() => {
    void syncCart();
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncCart();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [syncCart]);
  return null;
}

function Header() {
  const { user, isAdmin, isShipper } = useAuth();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
        <Link to="/" className="flex items-center gap-2">
          <img src={candleLogo} alt="" width={40} height={40} className="h-10 w-10 object-contain" />
          <span className="font-display text-xl font-semibold">Mộc</span>
        </Link>
        <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
          <Link to="/" className="hover:text-foreground" activeProps={{ className: "text-foreground" }} activeOptions={{ exact: true }}>
            Cửa hàng
          </Link>
          <Link to="/tra-cuu" className="hover:text-foreground" activeProps={{ className: "text-foreground" }}>
            Tra cứu đơn
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {isShipper && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/giao-hang">
                <Truck className="mr-1 h-4 w-4" /> Giao hàng
              </Link>
            </Button>
          )}
          {isAdmin && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/admin">
                <ShieldCheck className="mr-1 h-4 w-4" /> Quản trị
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link to={user ? "/tai-khoan" : "/auth"}>
              <UserIcon className="mr-1 h-4 w-4" /> {user ? "Tài khoản" : "Đăng nhập"}
            </Link>
          </Button>
          <CartDrawer />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-20 border-t bg-secondary/60">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm text-muted-foreground md:grid-cols-3">
        <div>
          <p className="font-display text-lg text-foreground">Nến Hương Mộc</p>
          <p className="mt-2">Nến thơm đậu nành thủ công, an toàn cho sức khỏe.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">Chính sách</p>
          <p className="mt-2">Miễn phí giao tiêu chuẩn cho đơn từ 500.000đ</p>
          <p>Đổi trả trong 7 ngày nếu sản phẩm lỗi</p>
        </div>
        <div>
          <p className="font-medium text-foreground">Liên hệ</p>
          <p className="mt-2">149 Nguyễn Văn Cừ, TP.HCM</p>
          <p>Hotline: 0900 000 000</p>
        </div>
      </div>
    </footer>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CartSync />
        <div className="flex min-h-screen flex-col">
          <Header />
          <main className="flex-1">
            <Outlet />
          </main>
          <Footer />
        </div>
        <SupportChatWidget />
        <Toaster position="top-center" richColors />
      </AuthProvider>
    </QueryClientProvider>
  );
}
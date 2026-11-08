import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Đăng nhập — Nến Hương An Nhiên" },
      { name: "description", content: "Đăng nhập hoặc tạo tài khoản để theo dõi đơn hàng." },
      { property: "og:title", content: "Đăng nhập — Nến Hương An Nhiên" },
      { property: "og:description", content: "Tài khoản khách hàng An Nhiên." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate({ to: "/tai-khoan" });
  }, [user, navigate]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    setBusy(true);
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error("Email hoặc mật khẩu không đúng");
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin, data: { full_name: String(f.get("name")) } },
      });
      error ? toast.error(error.message) : toast.success("Kiểm tra email để xác nhận tài khoản");
    }
    setBusy(false);
  }

  async function google() {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (r.error) toast.error("Đăng nhập Google thất bại");
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-center text-3xl font-semibold">{mode === "in" ? "Đăng nhập" : "Tạo tài khoản"}</h1>
      <form onSubmit={submit} className="mt-8 space-y-4">
        {mode === "up" && (
          <div><Label htmlFor="name">Họ tên</Label><Input id="name" name="name" required maxLength={100} /></div>
        )}
        <div><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required /></div>
        <div><Label htmlFor="password">Mật khẩu</Label><Input id="password" name="password" type="password" required minLength={8} /></div>
        <Button type="submit" className="w-full" disabled={busy}>{mode === "in" ? "Đăng nhập" : "Đăng ký"}</Button>
      </form>
      <Button variant="outline" className="mt-3 w-full" onClick={google}>Tiếp tục với Google</Button>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {mode === "in" ? "Chưa có tài khoản?" : "Đã có tài khoản?"}{" "}
        <button className="text-primary underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "Đăng ký" : "Đăng nhập"}
        </button>
      </p>
    </div>
  );
}

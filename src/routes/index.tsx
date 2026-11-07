import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Leaf, Truck, Gift, Search } from "lucide-react";
import heroImg from "@/assets/hero-candles.jpg";
import { fetchProducts } from "@/lib/shopify";
import { ProductCard } from "@/components/ProductCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const productsQuery = queryOptions({ queryKey: ["products"], queryFn: () => fetchProducts(50) });

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Nến Hương An Nhiên — Nến thơm đậu nành thủ công" },
      { name: "description", content: "Mua nến thơm đậu nành, nến gốm, hộp quà nến hương thủ công. Giao hàng toàn quốc, miễn phí từ 500.000đ." },
      { property: "og:title", content: "Nến Hương An Nhiên — Nến thơm thủ công" },
      { property: "og:description", content: "Nến thơm đậu nành thủ công Việt Nam, giao toàn quốc." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(productsQuery),
  component: Index,
});

function Index() {
  const { data: products } = useSuspenseQuery(productsQuery);
  const [q, setQ] = useState("");
  const [type, setType] = useState<string | null>(null);
  const [sort, setSort] = useState<"default" | "asc" | "desc">("default");

  const types = useMemo(() => Array.from(new Set(products.map((p) => p.node.productType).filter(Boolean))), [products]);
  const shown = useMemo(() => {
    let list = products.filter(
      (p) => (!type || p.node.productType === type) && p.node.title.toLowerCase().includes(q.trim().toLowerCase()),
    );
    const price = (p: (typeof list)[number]) => parseFloat(p.node.priceRange.minVariantPrice.amount);
    if (sort === "asc") list = [...list].sort((a, b) => price(a) - price(b));
    if (sort === "desc") list = [...list].sort((a, b) => price(b) - price(a));
    return list;
  }, [products, q, type, sort]);

  return (
    <div>
      <section className="hero-gradient">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-primary">Thủ công tại Việt Nam</p>
            <h1 className="mt-4 text-4xl leading-tight font-semibold md:text-6xl">
              Thắp lên <em className="text-primary">sự an nhiên</em> trong từng góc nhà
            </h1>
            <p className="mt-5 max-w-md text-lg text-muted-foreground">
              Nến thơm từ sáp đậu nành tự nhiên, tinh dầu thuần khiết, đựng trong gốm và thủy tinh tái sử dụng.
            </p>
            <Button size="lg" className="mt-8" asChild>
              <a href="#san-pham">Khám phá bộ sưu tập</a>
            </Button>
          </div>
          <img src={heroImg} alt="Nến thơm thủ công An Nhiên" width={1024} height={1024} className="rounded-3xl shadow-warm" />
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-12 md:grid-cols-3">
        {[
          { icon: Leaf, t: "Sáp đậu nành 100%", d: "Không paraffin, cháy sạch, ít khói" },
          { icon: Truck, t: "Giao toàn quốc", d: "Miễn phí giao tiêu chuẩn từ 500.000đ" },
          { icon: Gift, t: "Gói quà miễn phí", d: "Kèm thiệp viết tay theo yêu cầu" },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="flex items-start gap-4 rounded-2xl bg-card p-5 shadow-soft">
            <Icon className="h-8 w-8 flex-shrink-0 text-accent" />
            <div>
              <p className="font-medium">{t}</p>
              <p className="text-sm text-muted-foreground">{d}</p>
            </div>
          </div>
        ))}
      </section>

      <section id="san-pham" className="mx-auto max-w-6xl scroll-mt-20 px-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <h2 className="text-3xl font-semibold">Bộ sưu tập</h2>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nến..." className="w-52 pl-9" />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="h-9 rounded-md border bg-background px-3 text-sm"
              aria-label="Sắp xếp"
            >
              <option value="default">Mặc định</option>
              <option value="asc">Giá tăng dần</option>
              <option value="desc">Giá giảm dần</option>
            </select>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" variant={type === null ? "default" : "outline"} onClick={() => setType(null)}>
            Tất cả
          </Button>
          {types.map((t) => (
            <Button key={t} size="sm" variant={type === t ? "default" : "outline"} onClick={() => setType(t)}>
              {t}
            </Button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="py-20 text-center text-muted-foreground">Không tìm thấy sản phẩm nào</p>
        ) : (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => (
              <ProductCard key={p.node.id} product={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

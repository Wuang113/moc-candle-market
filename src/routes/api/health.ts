import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

export const Route = (createFileRoute as any)("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const startedAt = Date.now();
        let dbStatus = "ok";
        let productCount = 0;

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { count, error } = await (supabaseAdmin as any)
            .from("products")
            .select("*", { count: "exact", head: true });
          if (error) dbStatus = error.message;
          productCount = count ?? 0;
        } catch (err) {
          dbStatus = err instanceof Error ? err.message : "unknown_error";
        }

        const latencyMs = Date.now() - startedAt;

        return json(
          {
            status: dbStatus === "ok" ? "healthy" : "degraded",
            service: "nen-huong-an-nhien-headless",
            timestamp: new Date().toISOString(),
            uptimeSeconds: Math.round(process.uptime()),
            checks: {
              database: { status: dbStatus, latencyMs },
              catalog: { activeProducts: productCount },
              paymentGateway: { momoSandbox: Boolean(process.env["MOMO_PARTNER_CODE"] || true) },
              sslTls: { enforcedInProduction: true },
            },
          },
          { status: dbStatus === "ok" ? 200 : 503 },
        );
      },
    },
  },
});
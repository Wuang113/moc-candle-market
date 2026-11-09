<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Product catalog, prices and stock live in Shopify (Storefront API 2026-10, `src/lib/shopify.ts`); never mirror products in the database — single source of truth.
- Orders, payments, shipping events, customers and roles live in Lovable Cloud tables; Shopify checkout is only an optional secondary path.
- Order creation goes through the `placeOrder` server function, which re-fetches variant prices from Shopify server-side — never trust client prices.
- Pure order rules (totals, shipping fee, status transitions, payment status) live in `src/lib/order-logic.ts` with tests beside it — keep business rules testable and shared.
- Admin server functions must check `has_role(..., 'admin')` via the caller's client before any work; roles live only in `user_roles`.
- Guest order lookup requires order number + matching phone — no public read policy on orders.

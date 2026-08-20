import type { Metadata } from "next";
import CartView from "@/components/CartView";

/**
 * A thin server wrapper so the route can carry its own title. The cart itself is
 * interactive and lives in components/CartView.tsx.
 */
export const metadata: Metadata = {
  title: "Your cart",
  description: "Review your order from DeVine's Flowers & Botanicals before checking out.",
};

export default function CartPage() {
  return <CartView />;
}

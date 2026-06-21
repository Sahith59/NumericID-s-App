import { NextResponse } from "next/server";
import { findOrderById } from "../../../lib/data";
import { requireUserResponse } from "../../../lib/session";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const auth = await requireUserResponse();
  if (auth.response) return auth.response;

  const { id } = await params;

  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Order id must be a plain integer" }, { status: 400 });
  }

  const order = findOrderById(Number(id));
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Intentional BOLA for BoLD testing:
  // this route authenticates the caller but intentionally skips the ownership check.
  return NextResponse.json({
    id: order.id,
    ownerId: order.ownerId,
    status: order.status,
    total: order.total,
    currency: order.currency,
    placedAt: order.placedAt,
    shippingName: order.shippingName,
    shippingCity: order.shippingCity,
    lastFour: order.lastFour,
    items: order.items,
    internalMemo: order.internalMemo,
    requestedBy: auth.user
  });
}

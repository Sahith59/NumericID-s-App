"use client";

import { useState } from "react";
import type { Order } from "../lib/data";

export default function OrderConsole({ orders }: { orders: Order[] }) {
  const [orderId, setOrderId] = useState(String(orders[0]?.id || ""));
  const [result, setResult] = useState<string>("No request sent yet.");
  const [status, setStatus] = useState<string>("idle");

  async function fetchOrder(id = orderId) {
    setOrderId(id);
    setStatus("loading");
    const response = await fetch(`/api/orders/${encodeURIComponent(id)}`);
    const text = await response.text();

    try {
      setResult(JSON.stringify(JSON.parse(text), null, 2));
    } catch {
      setResult(text);
    }

    setStatus(`${response.status} ${response.statusText}`);
  }

  return (
    <section className="panel wide">
      <div className="panelHeader row">
        <div>
          <p className="kicker">Probe</p>
          <h2>Order lookup</h2>
        </div>
        <span className="status">{status}</span>
      </div>

      <div className="lookup">
        <label>
          Numeric ID
          <input value={orderId} onChange={(event) => setOrderId(event.target.value)} inputMode="numeric" />
        </label>
        <button className="button" onClick={() => fetchOrder()} type="button">
          Fetch order
        </button>
      </div>

      <div className="chips" aria-label="Seed orders">
        {orders.map((order) => (
          <button key={order.id} type="button" onClick={() => fetchOrder(String(order.id))}>
            #{order.id} · {order.ownerId}
          </button>
        ))}
      </div>

      <pre className="response">{result}</pre>
    </section>
  );
}

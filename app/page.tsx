import { orders, publicUser, users } from "./lib/data";
import { currentUser } from "./lib/session";
import LoginPanel from "./orders/login-panel";
import OrderConsole from "./orders/order-console";

export default async function Home() {
  const user = await currentUser();

  return (
    <main className="shell">
      <section className="masthead" aria-labelledby="title">
        <div>
          <p className="eyebrow">BoLD fixture / App 1</p>
          <h1 id="title">Numeric order IDs</h1>
          <p className="lede">
            A compact order portal with a deliberately vulnerable read endpoint:
            authenticated users can fetch any numeric order.
          </p>
        </div>
        <div className="contract">
          <span>GET</span>
          <code>/api/orders/[id]</code>
        </div>
      </section>

      <section className="grid">
        <LoginPanel initialUser={user ? publicUser(user) : null} demoUsers={users.map(publicUser)} />
        <OrderConsole orders={orders} />
      </section>
    </main>
  );
}

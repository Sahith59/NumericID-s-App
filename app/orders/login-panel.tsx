"use client";

import { useState } from "react";

type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

export default function LoginPanel({
  initialUser,
  demoUsers
}: {
  initialUser: PublicUser | null;
  demoUsers: PublicUser[];
}) {
  const [user, setUser] = useState<PublicUser | null>(initialUser);
  const [email, setEmail] = useState(demoUsers[0]?.email || "");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState("");

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Login failed");
      return;
    }

    setUser(data.user);
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    setUser(null);
  }

  return (
    <section className="panel">
      <div className="panelHeader">
        <p className="kicker">Session</p>
        <h2>Login</h2>
      </div>

      {user ? (
        <div className="signedIn">
          <p className="identity">{user.name}</p>
          <p className="muted">
            {user.email} · <strong>{user.id}</strong>
          </p>
          <button className="button secondary" onClick={logout} type="button">
            Sign out
          </button>
        </div>
      ) : (
        <form className="form" onSubmit={login}>
          <label>
            Email
            <select value={email} onChange={(event) => setEmail(event.target.value)}>
              {demoUsers.map((demoUser) => (
                <option key={demoUser.id} value={demoUser.email}>
                  {demoUser.email} ({demoUser.id})
                </option>
              ))}
            </select>
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button className="button" type="submit">
            Sign in
          </button>
        </form>
      )}
    </section>
  );
}

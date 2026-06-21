/**
 * @bold/next — the Next.js (App Router) route wrapper for BoLD live monitoring (Stage 3 / S3.3).
 *
 * Why a route wrapper and not `proxy.ts`/middleware: Next.js proxy runs BEFORE the response and
 * cannot read the response body — but confirming a BOLA needs the owner field FROM the response
 * (e.g. `ownerId`). The route handler is the only place that sees both the request and the response,
 * so that is where BoLD watches. The user wraps their existing handler; it runs unchanged.
 *
 * What it sends to BoLD: METADATA ONLY — who made the request (an opaque, non-reversible identity
 * handle, never the token/cookie), the endpoint shape, the object id, the status, and the object's
 * declared owner if the response JSON exposed one. The response body is read once to extract that
 * single owner field and then DISCARDED. No body, no headers, no credentials ever leave the app.
 *
 * Failure mode: FAIL-SAFE. Shipping the metadata is fire-and-forget; if BoLD is slow or down, the
 * user's response is returned untouched and on time. BoLD can never break or slow the app it watches.
 *
 * Usage (a few lines, no terminal):
 *
 *   // app/api/invoices/[id]/route.ts
 *   import { withBold } from "@bold/next";
 *
 *   export const GET = withBold(
 *     async (req, ctx) => {
 *       const invoice = await getInvoice(ctx.params.id);
 *       return Response.json(invoice); // { id, ownerId, ... }
 *     },
 *     { resolveCallerId: (req) => getUserIdFromSession(req) }, // RECOMMENDED — see BoldConfig
 *   );
 *
 * Config via env (set once): BOLD_INGEST_URL, BOLD_INGEST_KEY, optional BOLD_OWNER_FIELDS.
 */

export interface BoldConfig {
  /** Where to send events — your BoLD ingest endpoint. Defaults to env BOLD_INGEST_URL. */
  ingestUrl?: string;
  /** The monitor's ingest key (shown once when you connect the app). Defaults to env BOLD_INGEST_KEY. */
  ingestKey?: string;
  /** Owner-field names to look for in the response JSON. Defaults to env BOLD_OWNER_FIELDS or a
   *  common set. The FIRST one present (top level or one level of nesting) is used. */
  ownerFields?: string[];
  /** The authenticated caller's RESOLVED id (e.g. `usr_101`) — same namespace as the response's
   *  owner field. STRONGLY RECOMMENDED: your app already authenticated the user, so it knows this.
   *  With it, BoLD sees "caller IS the owner" and never false-CONFIRMs an owner's own access. Pass
   *  a `(request) => id` resolver. Without it, identity falls back to a non-reversible hash of the
   *  auth header — which cannot match the owner namespace, so an owner reading their own object can
   *  be wrongly flagged. */
  resolveCallerId?: (request: Request) => string | null | Promise<string | null>;
}

/** The shape of a Next.js App Router route handler: (request, context) => Response. We keep the
 *  context generic so any `{ params }` shape passes through untouched. */
export type RouteHandler<C> = (request: Request, context: C) => Response | Promise<Response>;

const DEFAULT_OWNER_FIELDS = [
  "ownerId",
  "owner_id",
  "userId",
  "user_id",
  "accountId",
  "account_id",
  "createdBy",
  "created_by",
  "tenantId",
  "tenant_id",
];

const OBJECT_PATH = /^(.*?)\/([^/]+)\/?$/; // ".../{prefix}/{lastSegment}"
// An id-looking last path segment: a pure number (42), a uuid/long-hex (>=6 hex/dash chars), or a
// PREFIXED id with one OR MORE underscore segments (inv_7001, acct_northstar_001,
// note_priya_investor_followup). Requiring at least one `_segment` is what distinguishes a real id
// from a route word like `orders` / `login` (which must NOT be treated as an object id).
const ID_LIKE = /^[0-9]+$|^[0-9a-fA-F-]{6,}$|^[a-zA-Z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)+$/;

interface ResolvedConfig {
  ingestUrl: string;
  ingestKey: string;
  ownerFields: string[];
  resolveCallerId?: (request: Request) => string | null | Promise<string | null>;
}

function resolveConfig(cfg?: BoldConfig): ResolvedConfig | null {
  const env: Record<string, string | undefined> =
    typeof process !== "undefined" && process.env ? process.env : {};
  const ingestUrl = cfg?.ingestUrl ?? env.BOLD_INGEST_URL ?? "";
  const ingestKey = cfg?.ingestKey ?? env.BOLD_INGEST_KEY ?? "";
  if (!ingestUrl || !ingestKey) return null; // not configured -> silently no-op (never throw)
  const ownerFields =
    cfg?.ownerFields ??
    (env.BOLD_OWNER_FIELDS
      ? env.BOLD_OWNER_FIELDS.split(",").map((s: string) => s.trim())
      : DEFAULT_OWNER_FIELDS);
  return { ingestUrl, ingestKey, ownerFields, resolveCallerId: cfg?.resolveCallerId };
}

/** The caller's identity for the engine. Best: the app's RESOLVED owner-id (same namespace as the
 *  response owner field) so own-access is never false-CONFIRMED. Fallback: a NON-reversible hash of
 *  the auth material (never the token) — lets BoLD tell "same vs different caller" but can't match
 *  the owner namespace. */
async function identityFrom(request: Request, cfg: ResolvedConfig): Promise<string | null> {
  if (cfg.resolveCallerId) {
    try {
      const resolved = await cfg.resolveCallerId(request);
      if (resolved) return String(resolved);
    } catch {
      // a throwing resolver must never break the app -> fall back to the hash
    }
  }
  const auth = request.headers.get("authorization") ?? request.headers.get("cookie") ?? "";
  if (!auth) return null;
  try {
    const data = new TextEncoder().encode(auth);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return "id_" + hex.slice(0, 16);
  } catch {
    return null;
  }
}

/** Split a path into an endpoint template (".../{id}") + the object id, or null if no id segment. */
export function endpointAndObject(pathname: string): { endpoint: string; objectId: string | null } {
  const m = pathname.match(OBJECT_PATH);
  if (!m) return { endpoint: pathname, objectId: null };
  const [, prefix, last] = m;
  if (!ID_LIKE.test(last)) return { endpoint: pathname, objectId: null };
  return { endpoint: `${prefix}/{id}`, objectId: last };
}

/** Max nesting depth declaredOwner walks. Real owner fields live shallow (top level, or under a
 *  `data`/`account`/`attributes` wrapper); we bound the walk so a deeply nested LOOK-ALIKE field can
 *  never be mistaken for the owner, and so a huge response can't cost unbounded work. */
const OWNER_MAX_DEPTH = 4;

/** Pull the first owner-looking field from a parsed JSON body, searching by KNOWN field name only,
 *  breadth-first to a bounded depth. We NEVER guess an owner from an unnamed field — if no
 *  configured owner-field name is present anywhere in range, we return null, and the engine then
 *  yields needs-review (the anthem: an unfindable owner is loud, never a false clean). Breadth-first
 *  + shallow bound means the SHALLOWEST match wins (the real owner), not a deep look-alike. */
export function declaredOwner(json: unknown, ownerFields: string[]): string | null {
  const fields = new Set(ownerFields);
  // BFS so the shallowest occurrence of an owner field wins; bounded depth + visited-guard keep it
  // safe on large/cyclic objects.
  let level: unknown[] = [json];
  const seen = new Set<unknown>();
  for (let depth = 0; depth <= OWNER_MAX_DEPTH && level.length; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (!node || typeof node !== "object" || Array.isArray(node) || seen.has(node)) continue;
      seen.add(node);
      const obj = node as Record<string, unknown>;
      for (const f of fields) {
        const v = obj[f];
        if (v !== undefined && v !== null && typeof v !== "object") return String(v);
      }
      for (const v of Object.values(obj)) {
        if (v && typeof v === "object") next.push(v);
      }
    }
    level = next;
  }
  return null;
}

// ── GraphQL adapter (Shape 3) ──────────────────────────────────────────────────────────────────
// GraphQL puts the object id in the REQUEST BODY (not the URL path) and the data under `data.<field>`
// in the response, so the path-based extractor finds nothing. This adapter parses the operation +
// id from the request and maps the owner from the response. The anthem floor holds throughout: if we
// cannot identify EXACTLY ONE object operation + its id, we return null and ship nothing for it —
// BoLD never invents an object, so it never produces a false verdict on a query it can't read.

const GQL_PATH = /\/graphql\/?$/i; // the conventional GraphQL endpoint
// A top-level selection like `order(id: $x)` or `invoice(id: "7")` — capture the field name + the id
// arg (variable ref `$name` or an inline string/number literal). Intentionally conservative.
const GQL_FIELD_WITH_ID =
  /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*[^)]*?\bid\s*:\s*(?:\$([A-Za-z_][A-Za-z0-9_]*)|"([^"]+)"|([0-9]+))/;

export interface GraphqlOp {
  field: string;
  objectId: string;
  isMutation: boolean;
}

/** Parse a GraphQL request body into a single object operation + its id, or null. Reads the id from
 *  `variables` (the standard pattern) when the query references `$var`, else from an inline literal.
 *  Returns null for anything ambiguous (no id, multiple object ops, batched array) so we stay loud. */
export function parseGraphqlOp(body: unknown): GraphqlOp | null {
  if (Array.isArray(body)) return null; // batched queries -> ambiguous, hold loud
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const query = b.query;
  if (typeof query !== "string") return null;
  const variables = (b.variables && typeof b.variables === "object" ? b.variables : {}) as Record<
    string,
    unknown
  >;
  const isMutation = /^\s*mutation\b/i.test(query) || /\bmutation\b/i.test(query.split("{")[0] ?? "");
  const m = query.match(GQL_FIELD_WITH_ID);
  if (!m) return null;
  const [, field, varRef, strLit, numLit] = m;
  let objectId: string | null = null;
  if (varRef) {
    const v = variables[varRef];
    if (v !== undefined && v !== null && typeof v !== "object") objectId = String(v);
  } else if (strLit !== undefined) {
    objectId = strLit;
  } else if (numLit !== undefined) {
    objectId = numLit;
  }
  if (!objectId) return null; // an id we can't resolve -> don't guess, hold loud
  return { field, objectId, isMutation };
}

/** The owner for a GraphQL op: look under the response's `data.<field>` subtree (the GraphQL result
 *  shape), reusing the same name-based owner search. Null if not present -> needs-review. */
function graphqlOwner(json: unknown, field: string, ownerFields: string[]): string | null {
  if (!json || typeof json !== "object") return null;
  const data = (json as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return null;
  const node = (data as Record<string, unknown>)[field];
  if (node === undefined) return null;
  return declaredOwner(node, ownerFields);
}

function methodToAction(method: string): string | null {
  const m = method.toUpperCase();
  if (m === "GET") return "GET";
  if (m === "PUT" || m === "PATCH" || m === "POST") return m;
  if (m === "DELETE") return "DELETE";
  return null;
}

/** Build the metadata event + ship it fire-and-forget. Never throws; never blocks the response. */
async function observe(
  request: Request,
  response: Response,
  cfg: ResolvedConfig,
): Promise<void> {
  try {
    const url = new URL(request.url);
    const respIsJson = (response.headers.get("content-type") ?? "").includes("application/json");

    // Resolve {endpoint, objectId, owner, method} for either a REST object route OR a GraphQL op.
    let endpoint: string;
    let objectId: string | null;
    let owner: string | null = null;
    let method: string;

    if (request.method.toUpperCase() === "POST" && GQL_PATH.test(url.pathname)) {
      // ── GraphQL path: the id is in the request body, the owner under data.<field>. ──
      let op: GraphqlOp | null = null;
      try {
        op = parseGraphqlOp(await request.clone().json());
      } catch {
        op = null;
      }
      if (!op) return; // can't identify exactly one object op -> ship nothing, never guess
      endpoint = `${url.pathname}#${op.field}`; // endpoint template names the GraphQL field
      objectId = op.objectId;
      method = op.isMutation ? "PATCH" : "GET"; // mutation -> write (UPDATE), query -> read
      if (respIsJson) {
        try {
          owner = graphqlOwner(await response.clone().json(), op.field, cfg.ownerFields);
        } catch {
          owner = null;
        }
      }
    } else {
      // ── REST path: id in the URL, owner anywhere named in the response JSON. ──
      const eo = endpointAndObject(url.pathname);
      endpoint = eo.endpoint;
      objectId = eo.objectId;
      if (!objectId) return; // not an object-by-id route -> nothing to judge
      if (!methodToAction(request.method)) return;
      method = request.method.toUpperCase();
      if (respIsJson) {
        try {
          owner = declaredOwner(await response.clone().json(), cfg.ownerFields);
        } catch {
          owner = null; // not the JSON shape we need -> no owner signal, never an error
        }
      }
    }

    const event = {
      identity: await identityFrom(request, cfg),
      method,
      endpoint,
      object_id: objectId,
      status_code: response.status,
      declared_owner: owner,
    };

    // On serverless (Vercel/Lambda) the function is FROZEN the instant the response is returned, so
    // an un-awaited fetch is killed mid-flight and the metadata never leaves (proven on a real
    // deploy — `keepalive` is a browser-only hint Node ignores). So we AWAIT the POST. Still
    // fail-safe: the inner .catch + the outer try/catch mean a slow/down BoLD can never break or
    // alter the response — and `observe()` itself is awaited by the wrapper only up to here, so the
    // owner-bytes were already read from the clone before this.
    await fetch(cfg.ingestUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.ingestKey}` },
      body: JSON.stringify(event),
    }).catch(() => {});
  } catch {
    // The wrapper must NEVER affect the app. Swallow everything.
  }
}

/**
 * Wrap a Next.js App Router route handler so BoLD watches it live. The handler runs exactly as
 * before; its response is returned untouched. BoLD observes metadata out of band.
 */
export function withBold<C>(handler: RouteHandler<C>, config?: BoldConfig): RouteHandler<C> {
  return async (request: Request, context: C): Promise<Response> => {
    const response = await handler(request, context);
    const cfg = resolveConfig(config);
    if (cfg) {
      // AWAIT the observe so the metadata POST actually transmits before the serverless function
      // freezes at return (an un-awaited POST is silently dropped on Vercel/Lambda — proven on a
      // real deploy). observe() is fully fail-safe internally (try/catch + .catch), so awaiting it
      // can never throw, never alter the response, and only briefly delays returning it.
      await observe(request, response, cfg);
    }
    return response;
  };
}

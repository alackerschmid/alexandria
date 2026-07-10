// Seeds a fixed local-dev test account so testing/manual QA doesn't require registering a
// throwaway user each time. Talks to the local worker over HTTP (not direct D1 writes) so it
// stays correct regardless of how password hashing or scan resolution work internally.
//
// Usage: npm run seed:dev   (worker must already be running via `npm run dev:worker`)
// Only ever targets the local D1 — never point WORKER_URL at a deployed/production worker.

const BASE_URL = process.env.WORKER_URL || "http://localhost:8787";
const EMAIL = "dev@example.com";
const PASSWORD = "devpassword123";
const FIRSTNAME = "Dev";

// A spread of statuses/owning-states/ratings so grouped and filtered library views have
// something in every bucket to look at.
const SEED_BOOKS = [
  { isbn: "9780141439518", status: "read", owning_status: "owned", rating: 8 }, // Pride and Prejudice
  { isbn: "9780061120084", status: "reading", owning_status: "owned", rating: null }, // To Kill a Mockingbird
  { isbn: "9780451524935", status: "unread", owning_status: "owned", rating: null }, // 1984
  { isbn: "9780547928227", status: "dnf", owning_status: "owned", rating: null }, // The Hobbit
  { isbn: "9780441013593", status: "unread", owning_status: "want", rating: null }, // Dune
  { isbn: "9780743273565", status: "read", owning_status: "lent_out", rating: 6 }, // The Great Gatsby
];

async function api(path, token, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  return res;
}

async function getToken() {
  const register = await api("/api/auth/register", null, {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, firstname: FIRSTNAME }),
  });
  if (register.ok) {
    console.log(`Created dev user ${EMAIL}`);
    return (await register.json()).token;
  }

  const login = await api("/api/auth/login", null, {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) {
    throw new Error(
      `Could not register or log in as ${EMAIL}: ${register.status} / ${login.status} — ` +
      `is the worker running (npm run dev:worker)?`,
    );
  }
  console.log(`Dev user ${EMAIL} already exists, logged in`);
  return (await login.json()).token;
}

async function main() {
  const token = await getToken();

  const existingRes = await api("/api/scans?limit=500", token);
  if (!existingRes.ok) throw new Error(`Failed to list existing scans: ${existingRes.status}`);
  const existingIsbns = new Set((await existingRes.json()).map((s) => s.isbn));

  for (const book of SEED_BOOKS) {
    if (existingIsbns.has(book.isbn)) {
      console.log(`  skip ${book.isbn} (already in library)`);
      continue;
    }
    const created = await api("/api/scans", token, {
      method: "POST",
      body: JSON.stringify({ isbn: book.isbn }),
    });
    if (!created.ok) {
      console.warn(`  ! failed to add ${book.isbn}: ${created.status}`);
      continue;
    }
    const scan = await created.json();
    const patched = await api(`/api/scans/${scan.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({
        status: book.status,
        owning_status: book.owning_status,
        rating: book.rating,
      }),
    });
    if (!patched.ok) {
      console.warn(`  ! added ${book.isbn} but failed to set status: ${patched.status}`);
      continue;
    }
    console.log(`  + ${scan.title || book.isbn} (${book.status}/${book.owning_status})`);
  }

  console.log(`\nDone. Login with ${EMAIL} / ${PASSWORD}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});

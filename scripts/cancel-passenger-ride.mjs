const API = process.env.API_URL ?? "http://127.0.0.1:4000";

async function main() {
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: "+254712000001",
      password: "SongaDev1",
      role: "passenger",
    }),
  });
  if (!loginRes.ok) {
    console.error("login failed", loginRes.status, await loginRes.text());
    process.exit(1);
  }
  const { sessionToken } = await loginRes.json();
  const activeRes = await fetch(`${API}/api/rides/active`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (!activeRes.ok) {
    console.error("active failed", activeRes.status, await activeRes.text());
    process.exit(1);
  }
  const { ride } = await activeRes.json();
  if (!ride) {
    console.log("NO_ACTIVE_RIDE");
    return;
  }
  console.log("ACTIVE", ride.id, ride.phase);
  const cancelRes = await fetch(`${API}/api/rides/${ride.id}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reasonId: "changed_mind",
      reasonLabel: "Changed mind",
    }),
  });
  if (!cancelRes.ok) {
    console.error("cancel failed", cancelRes.status, await cancelRes.text());
    process.exit(1);
  }
  const cancelled = await cancelRes.json();
  console.log("CANCELLED", cancelled.ride.phase);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

const BASE = '';

export async function fetchTopology() {
  const res = await fetch(`${BASE}/api/v1/topology-config`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function saveTopology(data) {
  const res = await fetch(`${BASE}/api/v1/topology-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchStatus() {
  const [ptRes, fwRes, tunnelRes, healthRes] = await Promise.allSettled([
    fetch(`${BASE}/api/v1/physical-topology`),
    fetch(`${BASE}/api/v1/firewall/status`),
    fetch(`${BASE}/api/v1/tunnel/status`),
    fetch(`${BASE}/api/v1/health`),
  ]);

  return {
    physical: ptRes.status === 'fulfilled' ? await ptRes.value.json() : null,
    firewall: fwRes.status === 'fulfilled' ? await fwRes.value.json() : null,
    tunnel: tunnelRes.status === 'fulfilled' ? await tunnelRes.value.json() : null,
    health: healthRes.status === 'fulfilled' ? await healthRes.value.json() : [],
  };
}

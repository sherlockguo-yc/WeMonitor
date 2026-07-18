const { stmts } = require('../db');

// GET /api/v1/services
function listServices(req, res) {
  const services = stmts.getAllServices.all();
  res.json(services);
}

// POST /api/v1/services
function createService(req, res) {
  const { name, scrape_url, scrape_interval, health_type, health_target } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const existing = stmts.getServiceByName.get(name);
  if (existing) {
    return res.status(409).json({ error: `Service "${name}" already exists` });
  }

  const info = stmts.insertServiceFull.run(
    name,
    scrape_url || null,
    scrape_interval || 30,
    health_type || 'tcp',
    health_target || null,
    1
  );

  res.status(201).json({ id: info.lastInsertRowid, name });
}

// PUT /api/v1/services/:id
function updateService(req, res) {
  const { id } = req.params;
  const { scrape_url, scrape_interval, health_type, health_target } = req.body;

  const svc = stmts.getServiceById.get(id);
  if (!svc) {
    return res.status(404).json({ error: 'Service not found' });
  }

  stmts.updateService.run(
    scrape_url ?? svc.scrape_url,
    scrape_interval ?? svc.scrape_interval,
    health_type ?? svc.health_type,
    health_target ?? svc.health_target,
    1,
    id
  );

  res.json({ id: Number(id), updated: true });
}

// PATCH /api/v1/services/:id/toggle
function toggleService(req, res) {
  const { id } = req.params;
  const svc = stmts.getServiceById.get(id);
  if (!svc) {
    return res.status(404).json({ error: 'Service not found' });
  }

  const newEnabled = svc.enabled ? 0 : 1;
  stmts.updateService.run(svc.scrape_url, svc.scrape_interval, svc.health_type, svc.health_target, newEnabled, id);
  res.json({ id: Number(id), enabled: !!newEnabled });
}

// DELETE /api/v1/services/:id
function deleteService(req, res) {
  const { id } = req.params;
  const svc = stmts.getServiceById.get(id);
  if (!svc) {
    return res.status(404).json({ error: 'Service not found' });
  }

  stmts.deleteService.run(id);
  res.json({ id: Number(id), deleted: true });
}

module.exports = { listServices, createService, updateService, toggleService, deleteService };

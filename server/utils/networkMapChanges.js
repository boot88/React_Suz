const { parseNetworkZone, ipToNumber } = require('../../src/utils/networkZone');

// Compare IP records, not the source text: ordering, TTL, whitespace and repeated
// DNS aliases must not turn an unchanged snapshot into a list of changes.
const networkRecords = (zoneText = '') => new Map(parseNetworkZone(zoneText).flatMap((network) => network.occupied)
  .map((record) => [record.ip, {
    ip: record.ip,
    hosts: [...new Set(record.host.split(', ').map((host) => host.toLowerCase().replace(/\.$/, '')))].sort(),
    section: record.section.replace(/\s+/g, ' ').trim()
  }]));

const compareNetworkSnapshots = (previousText, nextText, { initialLoad = false, previewLimit = 100 } = {}) => {
  const before = networkRecords(previousText);
  const after = networkRecords(nextText);
  const added = [], removed = [], updated = [];
  for (const [ip, record] of after) {
    const previous = before.get(ip);
    if (!previous) added.push(record);
    else if (JSON.stringify(previous) !== JSON.stringify(record)) updated.push({ ip, before: previous, after: record });
  }
  for (const [ip, record] of before) if (!after.has(ip)) removed.push(record);
  const summarize = (items) => ({ count: items.length, items: items.sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip)).slice(0, previewLimit) });
  return { initialLoad, previousTotal: before.size, total: after.size, added: summarize(added), removed: summarize(removed), updated: summarize(updated) };
};

module.exports = { networkRecords, compareNetworkSnapshots };

const ipToNumber = (ip) => ip.split('.').reduce((sum, part) => sum * 256 + Number(part), 0);
const freeRanges = (ips) => {
  const ranges = [];
  for (let index = 0; index < ips.length;) {
    const first = ips[index]; let last = first;
    while (++index < ips.length && ipToNumber(ips[index]) === ipToNumber(last) + 1) last = ips[index];
    ranges.push(first === last ? first : `${first} — ${last}`);
  }
  return ranges;
};
const parseNetworkZone = (text = '') => {
  const networks = new Map(); let section = 'Без раздела';
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith(';')) { section = line.trim().replace(/^;+|;+$/g, '').trim() || section; continue; }
    const match = line.split(';')[0].trim().match(/^(\S+)\s+(?:\d+\s+)?(?:IN\s+)?A\s+((?:\d{1,3}\.){3}\d{1,3})\b/i);
    if (!match) continue;
    const [, host, ip] = match, octets = ip.split('.').map(Number);
    if (octets.some((value) => value > 255) || octets[3] === 0 || octets[3] === 255) continue;
    const key = octets.slice(0, 3).join('.');
    if (!networks.has(key)) networks.set(key, new Map());
    const entries = networks.get(key), existing = entries.get(ip);
    if (existing) existing.hosts.add(host);
    else entries.set(ip, { ip, hosts: new Set([host]), section, networkKey: key });
  }
  return [...networks].map(([networkKey, entries]) => {
    const occupied = Array.from(entries.values()).map((record) => ({ ip: record.ip, section: record.section, networkKey: record.networkKey, host: Array.from(record.hosts).join(', ') })).sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip));
    const freeIps = Array.from({ length: 254 }, (_, index) => `${networkKey}.${index + 1}`).filter((ip) => !entries.has(ip));
    return { networkKey, cidr: `${networkKey}.0/24`, section: occupied[0].section, occupied, freeIps, freeRanges: freeRanges(freeIps) };
  }).sort((a, b) => ipToNumber(`${a.networkKey}.0`) - ipToNumber(`${b.networkKey}.0`));
};
module.exports = { parseNetworkZone, ipToNumber };

import dns from 'node:dns';
import { isIP, BlockList } from 'node:net';

const reserved = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) reserved.addSubnet(address, prefix, 'ipv4');
reserved.addSubnet('192.88.99.0', 24, 'ipv4');
reserved.addAddress('168.63.129.16', 'ipv4');
// Conservative IPv6: globally routed unicast only, excluding special ranges.
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
reserved.addSubnet('2001::', 23, 'ipv6');
reserved.addSubnet('2001:db8::', 32, 'ipv6');
reserved.addSubnet('2002::', 16, 'ipv6');

export const isPublicDownloadAddress = (raw) => {
  const address = String(raw || '').replace(/^\[|\]$/g, '');
  const family = isIP(address);
  if (family === 4) return !reserved.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !reserved.check(address, 'ipv6');
};

export const validateDownloadUrl = (value, { allowLocal = false } = {}) => {
  const url = new URL(value);
  if (url.username || url.password) throw new Error('Download URL credentials are not allowed.');
  if (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:')) {
    throw new Error('Downloads require HTTPS.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowLocal && isIP(host) && !isPublicDownloadAddress(host)) {
    throw new Error('Download destination is not a public address.');
  }
  return url;
};

/** Validate the actual DNS answer used by the connection; never resolve twice. */
export const createDownloadLookup = ({ allowLocal = false, lookup = dns.lookup } = {}) => (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses?.length || (!allowLocal && addresses.some((entry) => !isPublicDownloadAddress(entry.address)))) {
      return callback(new Error('Download DNS answer contains a non-public address.'));
    }
    if (options?.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
};

/**
 * Zeroconf/mDNS-Advertising: Clients im LAN finden den Host als
 * `unableset.local` bzw. über den Service-Typ `_unableset._tcp` (plus
 * `_http._tcp` für Browser/Bonjour-Browser). Fehler sind nie fatal —
 * ohne mDNS bleibt der QR-Code/IP-Weg.
 */

export async function startMdns(
  httpPort: number,
  log: (message: string) => void,
): Promise<() => void> {
  try {
    const { Bonjour } = await import('bonjour-service');
    const bonjour = new Bonjour();
    bonjour.publish({ name: 'UnableSet', type: 'unableset', protocol: 'tcp', port: httpPort });
    bonjour.publish({ name: 'UnableSet', type: 'http', protocol: 'tcp', port: httpPort });
    log(`mDNS-Advertising aktiv (_unableset._tcp auf Port ${httpPort})`);
    return () => {
      try {
        bonjour.unpublishAll(() => bonjour.destroy());
      } catch {
        // Shutdown — egal
      }
    };
  } catch (error) {
    log(`mDNS nicht verfügbar: ${error instanceof Error ? error.message : String(error)}`);
    return () => {};
  }
}

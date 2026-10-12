// Schlägt zu einem Standort die Adresse nach (OpenStreetMap Nominatim, kostenlos, ohne Schlüssel).
// Nominatim erlaubt höchstens eine Anfrage pro Sekunde. Ladevorgänge gibt es nur wenige,
// und jede Adresse wird nur einmal nachgeschlagen und dann in der Datenbank gespeichert.

/** Macht aus der Nominatim-Antwort „Hauptstraße 5, 12345 Berlin“. */
export function formatAddress(data: { display_name?: string; address?: Record<string, string> }): string | null {
  const a = data.address;
  if (!a) return data.display_name ?? null;
  const street = [a.road ?? a.pedestrian ?? a.footway ?? a.square, a.house_number].filter(Boolean).join(" ");
  const place = a.city ?? a.town ?? a.village ?? a.municipality ?? a.suburb;
  const city = [a.postcode, place].filter(Boolean).join(" ");
  const parts = [a.amenity ?? a.shop ?? a.building, street, city].filter(Boolean);
  return parts.length ? [...new Set(parts)].join(", ") : (data.display_name ?? null);
}

const USER_AGENT = "ford-ev-api (selbst gehostete Ladevorgang-Übersicht, github.com/noahtrr/ford-ev-api)";

async function nominatim(lat: number, lon: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=de&lat=${lat}&lon=${lon}`;
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim antwortet mit ${res.status}`);
  return formatAddress((await res.json()) as Parameters<typeof formatAddress>[0]);
}

/** Macht aus der Photon-Antwort (GeoJSON) „Hauptstraße 5, 12345 Berlin“. */
export function formatPhoton(data: { features?: { properties?: Record<string, string> }[] }): string | null {
  const p = data.features?.[0]?.properties;
  if (!p) return null;
  const address: Record<string, string> = {};
  const fields: [string, string | undefined][] = [
    ["road", p.street ?? p.name],
    ["house_number", p.housenumber],
    ["postcode", p.postcode],
    ["city", p.city ?? p.locality ?? p.district],
    ["amenity", p.street ? p.name : undefined],
  ];
  for (const [key, value] of fields) if (value) address[key] = value;
  return formatAddress({ address, display_name: p.name });
}

/** Ersatz, falls Nominatim nicht antwortet: Photon (komoot), ebenfalls OpenStreetMap-Daten, kostenlos, ohne Schlüssel. */
async function photon(lat: number, lon: number): Promise<string | null> {
  const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=de`, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Photon antwortet mit ${res.status}`);
  return formatPhoton((await res.json()) as Parameters<typeof formatPhoton>[0]);
}

/** Fragt erst Nominatim, klappt das nicht oder kommt kein Name zurück, dann Photon. */
export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const address = await nominatim(lat, lon);
    if (address) return address;
  } catch (err) {
    try {
      return await photon(lat, lon);
    } catch (err2) {
      throw new Error(`${(err as Error).message}; ${(err2 as Error).message}`);
    }
  }
  return photon(lat, lon);
}

/** Rundet eine Position auf 4 Nachkommastellen (etwa 10 m), damit kleine GPS-Schwankungen denselben Ortsnamen nutzen. */
export function placeKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

export type AddressLookup = (lat: number, lon: number) => Promise<string | null>;

/**
 * Warteschlange für Adressen: eine Anfrage nach der anderen, mit Pause dazwischen.
 * Klappt eine Anfrage nicht, wird es frühestens nach fünf Minuten noch einmal versucht.
 */
export function addressQueue(lookup: AddressLookup, save: (key: string, address: string) => void, onError: (err: unknown) => void, pauseMs = 1100) {
  const waiting = new Map<string, { lat: number; lon: number }>();
  const failedAt = new Map<string, number>();
  let running = false;

  async function run() {
    running = true;
    while (waiting.size) {
      const [key, { lat, lon }] = waiting.entries().next().value!;
      try {
        const address = await lookup(lat, lon);
        if (address) save(key, address);
        failedAt.delete(key);
      } catch (err) {
        failedAt.set(key, Date.now());
        onError(err);
      }
      waiting.delete(key);
      if (waiting.size) await new Promise((r) => setTimeout(r, pauseMs));
    }
    running = false;
  }

  return (key: string, lat: number, lon: number) => {
    const failed = failedAt.get(key);
    if (waiting.has(key) || (failed !== undefined && Date.now() - failed < 300_000)) return;
    waiting.set(key, { lat, lon });
    if (!running) void run();
  };
}

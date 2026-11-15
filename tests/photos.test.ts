import { describe, expect, test } from "bun:test";
import { fetchPhotos, parsePhotos, photosUrl, plainText } from "../src/services/photos";

const page = (index: number, title: string, overrides: Record<string, unknown> = {}) => ({
  title,
  index,
  imageinfo: [
    {
      thumburl: `https://upload.wikimedia.org/thumb/${index}.jpg`,
      descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
      mime: "image/jpeg",
      width: 4000,
      height: 3000,
      thumbwidth: 480,
      thumbheight: 360,
      extmetadata: {
        Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Ana" title="User:Ana">Ana &amp; Luis</a>' },
        LicenseShortName: { value: "CC BY-SA 4.0" },
      },
      ...overrides,
    },
  ],
});

const body = (...pages: ReturnType<typeof page>[]) => ({
  query: { pages: Object.fromEntries(pages.map((p, i) => [String(1000 - i), p])) },
});

const respond = (payload: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(payload), { status })) as unknown as typeof fetch;

describe("fotos del lugar", () => {
  test("arma la consulta por coordenadas, sin clave", () => {
    const url = new URL(photosUrl(37.75, 14.99));
    expect(url.origin + url.pathname).toBe("https://commons.wikimedia.org/w/api.php");
    expect(url.searchParams.get("ggscoord")).toBe("37.7500|14.9900");
    expect(url.searchParams.get("ggsradius")).toBe("10000");
    expect(url.searchParams.get("origin")).toBe("*");
  });

  test("el autor llega como HTML y se muestra como texto", () => {
    expect(plainText('<a href="x">Ana &amp; Luis</a>')).toBe("Ana & Luis");
    expect(plainText("<script>alert(1)</script>  Pedro\n")).toBe("alert(1) Pedro");
    expect(plainText("L&#039;Etna")).toBe("L'Etna");
  });

  test("ordena por cercanía y conserva autor, licencia y enlace", () => {
    const [first, second] = parsePhotos(body(page(2, "File:Cráter sur.jpg"), page(1, "File:Etna peak.jpg")));
    expect(first.title).toBe("Etna peak");
    expect(first.author).toBe("Ana & Luis");
    expect(first.license).toBe("CC BY-SA 4.0");
    expect(first.page).toContain("commons.wikimedia.org/wiki/");
    expect(second.title).toBe("Cráter sur");
  });

  test("descarta lo que no es una fotografía con autor y licencia", () => {
    const photos = parsePhotos(
      body(
        page(1, "File:Mapa.svg", { mime: "image/svg+xml" }),
        page(2, "File:Sin licencia.jpg", { extmetadata: { Artist: { value: "Ana" } } }),
        page(3, "File:Sin autor.jpg", { extmetadata: { LicenseShortName: { value: "CC0" } } }),
        page(4, "File:Pequeña.jpg", { width: 320 }),
        page(5, "File:Buena.jpg"),
      ),
    );
    expect(photos.map((p) => p.title)).toEqual(["Buena"]);
    expect(parsePhotos({})).toEqual([]);
    expect(parsePhotos({ query: {} })).toEqual([]);
  });

  test("no repite series casi idénticas y limita la cantidad", () => {
    const series = Array.from({ length: 6 }, (_, i) => page(i + 1, `File:Erupción 2011 (${i + 1}).jpg`));
    expect(parsePhotos(body(...series)).map((p) => p.title)).toEqual(["Erupción 2011"]);

    const many = Array.from({ length: 20 }, (_, i) => page(i + 1, `File:Vista ${String.fromCharCode(65 + i)}.jpg`));
    expect(parsePhotos(body(...many))).toHaveLength(8);
  });

  test("reutiliza la consulta y no guarda los fallos", async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return new Response(JSON.stringify(body(page(1, "File:Una.jpg"))));
    }) as unknown as typeof fetch;
    await fetchPhotos(1.5, 2.5, counting, 1000);
    await fetchPhotos(1.5, 2.5, counting, 2000);
    expect(calls).toBe(1);

    await expect(fetchPhotos(3.5, 4.5, respond({}, 503), 1000)).rejects.toThrow("503");
    expect(await fetchPhotos(3.5, 4.5, respond(body(page(1, "File:Otra.jpg"))), 1000)).toHaveLength(1);
  });
});

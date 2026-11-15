/**
 * Inkora — MangaDex (API officielle), API v1.
 * Langues demandées : en + fr. Usage personnel uniquement.
 * `host` est lu à l'appel : ne pas le capturer au chargement du module.
 */

const API = "https://api.mangadex.org";
const SITE = "https://mangadex.org";
const UPLOADS = "https://uploads.mangadex.org";
const LANGS = ["en", "fr"];

function fail(message) {
  host.log("error", message);
  throw new Error(message);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} : JSON invalide`);
  }
}

function pickTitle(titleMap) {
  if (!titleMap || typeof titleMap !== "object") return "";
  for (const key of ["en", "fr", "ja-ro", "ja"]) {
    if (titleMap[key]) return String(titleMap[key]);
  }
  const first = Object.values(titleMap)[0];
  return first ? String(first) : "";
}

function pickDescription(descMap) {
  if (!descMap || typeof descMap !== "object") return "";
  for (const key of ["en", "fr"]) {
    if (descMap[key]) return String(descMap[key]).replace(/\s+/g, " ").trim();
  }
  const first = Object.values(descMap)[0];
  return first ? String(first).replace(/\s+/g, " ").trim() : "";
}

function mapStatus(status) {
  const value = String(status ?? "").toLowerCase();
  if (value === "ongoing" || value === "hiatus") return "EN_COURS";
  if (value === "completed" || value === "cancelled") return "TERMINEE";
  return "INCONNUE";
}

function mapType(tags) {
  const names = (tags ?? [])
    .map((tag) => tag?.attributes?.name?.en)
    .filter(Boolean)
    .map((name) => name.toLowerCase());
  if (names.includes("long strip") || names.includes("webtoon")) return "WEBTOON";
  return "MANGA";
}

function mangaIdFromUrl(url) {
  const text = String(url ?? "");
  const match = text.match(
    /(?:mangadex\.org\/title\/|api\.mangadex\.org\/manga\/)([0-9a-f-]{36})/i,
  );
  return match?.[1] ?? null;
}

function chapterIdFromUrl(url) {
  const text = String(url ?? "");
  const match = text.match(
    /(?:mangadex\.org\/chapter\/|api\.mangadex\.org\/(?:at-home\/server|chapter)\/)([0-9a-f-]{36})/i,
  );
  return match?.[1] ?? null;
}

function coverUrl(mangaId, relationships) {
  const cover = (relationships ?? []).find((rel) => rel.type === "cover_art");
  const fileName = cover?.attributes?.fileName;
  if (!mangaId || !fileName) return null;
  return `${UPLOADS}/covers/${mangaId}/${fileName}`;
}

/** Crochets encodés : OkHttp refuse `[]` bruts et la recherche tombait en statut 0. */
function qp(name, value) {
  return `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
}

function contentRatingParams() {
  return ["safe", "suggestive", "erotica"].map((value) => qp("contentRating[]", value)).join("&");
}

function langParams() {
  return LANGS.map((lang) => qp("translatedLanguage[]", lang)).join("&");
}

async function attachCovers(items) {
  const ids = items.map((item) => mangaIdFromUrl(item.url)).filter(Boolean);
  if (!ids.length) return;
  const params = [
    qp("limit", String(ids.length)),
    qp("includes[]", "cover_art"),
    contentRatingParams(),
    ...ids.map((id) => qp("ids[]", id)),
  ];
  const response = await host.fetch(`${API}/manga?${params.join("&")}`);
  if (response.status !== 200) return;
  let body;
  try {
    body = JSON.parse(response.text);
  } catch {
    return;
  }
  const byId = new Map();
  for (const entry of body.data ?? []) {
    byId.set(entry.id, coverUrl(entry.id, entry.relationships));
  }
  for (const item of items) {
    const id = mangaIdFromUrl(item.url);
    const cover = id ? byId.get(id) : null;
    if (cover) item.coverUrl = cover;
  }
}

function langList(lang) {
  if (lang === "fr" || lang === "en") return [lang];
  return LANGS;
}

function pageNumber(spec) {
  const value = Number(spec?.page);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

function morePages(body, offset, size) {
  const got = Array.isArray(body?.data) ? body.data.length : 0;
  const total = Number(body?.total);
  const end = Number.isFinite(total) ? offset + got >= total : got < size;
  return !end && offset + size < 10000;
}

export async function browse(spec) {
  const kind = String(spec?.kind || "");
  const lang = String(spec?.lang || "all");
  const page = pageNumber(spec);
  const size = 100;
  const offset = (page - 1) * size;
  host.log("info", `browse:${kind}:${page}`);
  if (offset >= 10000) return { items: [], facets: [], hasMore: false };
  if (kind === "tags") {
    const response = await host.fetch(`${API}/manga/tag`);
    if (response.status !== 200) fail(`Tags introuvables (${response.status})`);
    const body = parseJson(response.text, "tags");
    const facets = (body.data ?? [])
      .filter((tag) => tag?.attributes?.group === "genre")
      .map((tag) => ({ id: String(tag.id), name: String(tag.attributes?.name?.en || "") }))
      .filter((tag) => tag.name);
    facets.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { items: [], facets, hasMore: false };
  }
  if (kind === "popular") {
    const params = [
      qp("limit", String(size)),
      qp("offset", String(offset)),
      qp("includes[]", "cover_art"),
      contentRatingParams(),
      qp("order[followedCount]", "desc"),
      ...langList(lang).map((value) => qp("availableTranslatedLanguage[]", value)),
    ];
    const tag = String(spec?.tag || "").trim();
    if (tag) params.push(qp("includedTags[]", tag));
    const response = await host.fetch(`${API}/manga?${params.join("&")}`);
    if (response.status !== 200) fail(`Populaires interrompus (${response.status})`);
    const body = parseJson(response.text, "popular");
    if (body.result !== "ok" || !Array.isArray(body.data)) fail("Réponse MangaDex inattendue");
    return {
      items: body.data.map((entry) => ({
        title: pickTitle(entry.attributes?.title) || "Sans titre",
        url: `${SITE}/title/${entry.id}`,
        coverUrl: coverUrl(entry.id, entry.relationships),
        lang,
      })),
      facets: [],
      hasMore: morePages(body, offset, size),
    };
  }
  if (kind === "latest") {
    const params = [
      qp("limit", String(size)),
      qp("offset", String(offset)),
      qp("includes[]", "manga"),
      contentRatingParams(),
      qp("order[readableAt]", "desc"),
      qp("includeEmptyPages", "0"),
      qp("includeFuturePublishAt", "0"),
      qp("includeExternalUrl", "0"),
      ...langList(lang).map((value) => qp("translatedLanguage[]", value)),
    ];
    const response = await host.fetch(`${API}/chapter?${params.join("&")}`);
    if (response.status !== 200) fail(`Derniers chapitres interrompus (${response.status})`);
    const body = parseJson(response.text, "latest");
    if (body.result !== "ok" || !Array.isArray(body.data)) fail("Réponse MangaDex inattendue");
    const seen = new Set();
    const items = [];
    for (const entry of body.data) {
      const attrs = entry.attributes ?? {};
      if (attrs.externalUrl) continue;
      const manga = (entry.relationships ?? []).find((rel) => rel.type === "manga");
      if (!manga?.id || seen.has(manga.id)) continue;
      const number = attrs.chapter;
      if (number == null || number === "") continue;
      seen.add(manga.id);
      const code = attrs.translatedLanguage || "";
      const title = pickTitle(manga.attributes?.title) || "Sans titre";
      items.push({
        title,
        url: `${SITE}/title/${manga.id}`,
        coverUrl: null,
        lang: code,
        subtitle: attrs.title ? `Ch. ${number} — ${attrs.title} [${code}]` : `Ch. ${number} [${code}]`,
      });
    }
    await attachCovers(items);
    return { items, facets: [], hasMore: morePages(body, offset, size) };
  }
  fail("Section MangaDex inconnue");
}

export async function search(query) {
  const q = String(query ?? "").trim();
  host.log("info", `search:${q}`);
  const params = [
    qp("limit", "20"),
    qp("includes[]", "cover_art"),
    contentRatingParams(),
    q ? qp("title", q) : qp("order[followedCount]", "desc"),
  ].join("&");
  const response = await host.fetch(`${API}/manga?${params}`);
  if (response.status !== 200) fail(`Recherche interrompue (${response.status})`);
  const body = parseJson(response.text, "search");
  if (body.result !== "ok" || !Array.isArray(body.data)) fail("Réponse MangaDex inattendue");

  return body.data.map((entry) => {
    const id = entry.id;
    const title = pickTitle(entry.attributes?.title) || "Sans titre";
    return {
      title,
      url: `${SITE}/title/${id}`,
      coverUrl: coverUrl(id, entry.relationships),
      lang: "en",
    };
  });
}

export async function getSeries(url) {
  host.log("info", `getSeries:${url}`);
  const id = mangaIdFromUrl(url);
  if (!id) fail("Identifiant MangaDex manquant");
  const response = await host.fetch(
    `${API}/manga/${id}?${[qp("includes[]", "cover_art"), qp("includes[]", "author"), qp("includes[]", "artist")].join("&")}`,
  );
  if (response.status !== 200) fail(`Fiche introuvable (${response.status})`);
  const body = parseJson(response.text, "getSeries");
  const data = body.data;
  if (body.result !== "ok" || !data) fail("Réponse MangaDex inattendue");

  const altTitles = (data.attributes?.altTitles ?? [])
    .map((entry) => Object.values(entry ?? {})[0])
    .filter(Boolean)
    .map(String);

  return {
    title: pickTitle(data.attributes?.title) || "Sans titre",
    altTitles,
    url: `${SITE}/title/${id}`,
    coverUrl: coverUrl(id, data.relationships),
    description: pickDescription(data.attributes?.description),
    type: mapType(data.attributes?.tags),
    pubStatus: mapStatus(data.attributes?.status),
    lang: "en",
  };
}

export async function listChapters(url) {
  host.log("info", `listChapters:${url}`);
  const id = mangaIdFromUrl(url);
  if (!id) fail("Identifiant MangaDex manquant");

  const chapters = [];
  let offset = 0;
  const limit = 500;
  for (;;) {
    const params = [
      langParams(),
      qp("order[chapter]", "desc"),
      qp("limit", String(limit)),
      qp("offset", String(offset)),
      contentRatingParams(),
      qp("includeEmptyPages", "0"),
      qp("includeFuturePublishAt", "0"),
      qp("includeExternalUrl", "0"),
    ].join("&");
    const response = await host.fetch(`${API}/manga/${id}/feed?${params}`);
    if (response.status !== 200) fail(`Chapitres introuvables (${response.status})`);
    const body = parseJson(response.text, "listChapters");
    if (body.result !== "ok" || !Array.isArray(body.data)) fail("Réponse MangaDex inattendue");

    for (const entry of body.data) {
      const attrs = entry.attributes ?? {};
      if (attrs.externalUrl) continue;
      const number = Number(attrs.chapter);
      if (!Number.isFinite(number)) continue;
      const lang = attrs.translatedLanguage || "?";
      const label = attrs.title ? `${attrs.chapter} — ${attrs.title} [${lang}]` : `${attrs.chapter} [${lang}]`;
      chapters.push({
        number,
        title: label,
        url: `${SITE}/chapter/${entry.id}`,
      });
    }

    offset += body.data.length;
    if (body.data.length < limit || offset >= (body.total ?? offset)) break;
    if (offset > 10000) break;
  }

  if (chapters.length === 0) fail("Aucun chapitre lisible (hors liens externes)");
  return chapters;
}

export async function getPageUrls(chapterUrl) {
  host.log("info", `getPageUrls:${chapterUrl}`);
  const id = chapterIdFromUrl(chapterUrl);
  if (!id) fail("Identifiant de chapitre MangaDex manquant");
  const response = await host.fetch(`${API}/at-home/server/${id}`);
  if (response.status !== 200) fail(`Chapitre introuvable (${response.status})`);
  const body = parseJson(response.text, "getPageUrls");
  if (body.result !== "ok" || !body.baseUrl || !body.chapter?.hash) {
    fail("Serveur d'images MangaDex indisponible");
  }
  const files = body.chapter.data;
  if (!Array.isArray(files) || files.length === 0) fail("Aucune planche dans le chapitre");
  return files.map((file) => `${body.baseUrl}/data/${body.chapter.hash}/${file}`);
}

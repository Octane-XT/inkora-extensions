/**
 * Inkora — SushiScan (VF), API v1.
 * HTML Themesia / `ts_reader.run`. Usage personnel uniquement.
 * `host` est lu à l'appel : ne pas le capturer au chargement du module.
 */

const BASE = "https://sushiscan.net";

function fail(message) {
  host.log("error", message);
  throw new Error(message);
}

function absolute(href) {
  if (!href) return null;
  const value = String(href).trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return BASE + value;
  return `${BASE}/${value.replace(/^\.\//, "")}`;
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, "–")
    .replace(/&rsquo;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function mapType(raw) {
  const value = String(raw ?? "").toLowerCase();
  if (value.includes("webtoon") || value.includes("manhwa") || value.includes("manhua")) {
    return "WEBTOON";
  }
  return "MANGA";
}

function mapStatus(raw) {
  const value = String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (value.includes("cours") || value.includes("ongoing")) return "EN_COURS";
  if (value.includes("termin") || value.includes("complet") || value.includes("fini")) {
    return "TERMINEE";
  }
  return "INCONNUE";
}

function chapterNumber(raw) {
  const match = String(raw ?? "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return NaN;
  return Number(match[1]);
}

function infoValue(root, label) {
  for (const row of host.html.select(root, "table.infotable tr")) {
    const cells = host.html.select(row, "td");
    if (cells.length < 2) continue;
    if (host.html.text(cells[0]).toLowerCase() === label.toLowerCase()) {
      return host.html.text(cells[1]);
    }
  }
  return "";
}

function extractTsReader(html) {
  const marker = "ts_reader.run(";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  let i = start + marker.length;
  while (i < html.length && html[i] !== "{") i += 1;
  if (html[i] !== "{") return null;
  let depth = 0;
  let end = i;
  for (; end < html.length; end += 1) {
    const ch = html[end];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }
  try {
    return JSON.parse(html.slice(i, end));
  } catch {
    return null;
  }
}

function genreSlug(href) {
  const match = String(href || "").match(/\/genres\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

function readCards(html, withChapter) {
  const cards = host.html.select(html, ".listupd .bsx");
  const results = [];
  for (const card of cards) {
    const link = host.html.select(card, "a")[0];
    if (!link) continue;
    const href = absolute(host.html.attr(link, "href"));
    if (!href || !href.includes("/catalogue/")) continue;
    const title =
      decodeEntities(host.html.text(host.html.select(card, ".tt")[0])) ||
      decodeEntities(host.html.attr(link, "title"));
    if (!title) continue;
    const cover = host.html.attr(host.html.select(card, "img")[0], "src");
    const chapter = withChapter
      ? decodeEntities(host.html.text(host.html.select(card, ".epxs")[0]))
      : "";
    results.push({
      title,
      url: href.endsWith("/") ? href : `${href}/`,
      coverUrl: cover ? absolute(String(cover).split("?")[0]) : null,
      lang: "fr",
      subtitle: chapter || null,
    });
  }
  return results;
}

function genreFacets(html) {
  const seen = new Set();
  const facets = [];
  for (const link of host.html.select(html, "a")) {
    const slug = genreSlug(host.html.attr(link, "href"));
    if (!slug || seen.has(slug)) continue;
    const name = decodeEntities(host.html.text(link));
    if (!name) continue;
    seen.add(slug);
    facets.push({ id: slug, name });
  }
  return facets;
}

function pageNumber(spec) {
  const value = Number(spec?.page);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

function browseUrl(kind, genre, page) {
  if (kind === "home") return page <= 1 ? `${BASE}/` : `${BASE}/page/${page}/`;
  if (genre) {
    const base = `${BASE}/genres/${encodeURIComponent(genre)}/`;
    return page <= 1 ? base : `${base}page/${page}/`;
  }
  return page <= 1 ? `${BASE}/catalogue/` : `${BASE}/catalogue/?page=${page}`;
}

function hasNextPage(html, page) {
  const next = page + 1;
  for (const link of host.html.select(html, "a")) {
    const href = host.html.attr(link, "href") || "";
    const classes = (host.html.attr(link, "class") || "").split(/\s+/);
    if ((classes.includes("r") || classes.includes("next")) && href && href !== "#") return true;
    if (href.includes(`/page/${next}`) || href.includes(`page=${next}`)) return true;
  }
  return false;
}

export async function browse(spec) {
  const kind = String(spec?.kind || "");
  const page = pageNumber(spec);
  host.log("info", `browse:${kind}:${page}`);
  if (kind === "home") {
    const response = await host.fetch(browseUrl(kind, "", page));
    if (response.status !== 200) fail(`Accueil introuvable (${response.status})`);
    return {
      items: readCards(response.text, true),
      facets: page === 1 ? genreFacets(response.text) : [],
      hasMore: hasNextPage(response.text, page),
    };
  }
  if (kind === "catalogue") {
    const genre = String(spec?.genre || "").trim();
    const response = await host.fetch(browseUrl(kind, genre, page));
    if (response.status !== 200) fail(`Catalogue introuvable (${response.status})`);
    return {
      items: readCards(response.text, false),
      facets: [],
      hasMore: hasNextPage(response.text, page),
    };
  }
  fail("Section SushiScan inconnue");
}

export async function search(query) {
  const q = String(query ?? "").trim();
  host.log("info", `search:${q}`);
  const url = q
    ? `${BASE}/?s=${encodeURIComponent(q)}`
    : `${BASE}/catalogue/`;
  const response = await host.fetch(url);
  if (response.status !== 200) fail(`Recherche interrompue (${response.status})`);

  const cards = host.html.select(response.text, ".listupd .bsx");
  const results = [];
  const needle = q.toLowerCase();
  for (const card of cards) {
    const link = host.html.select(card, "a")[0];
    if (!link) continue;
    const href = absolute(host.html.attr(link, "href"));
    if (!href || !href.includes("/catalogue/")) continue;
    const title =
      decodeEntities(host.html.text(host.html.select(card, ".tt")[0])) ||
      decodeEntities(host.html.attr(link, "title"));
    if (!title) continue;
    if (needle && !title.toLowerCase().includes(needle)) continue;
    const cover = host.html.attr(host.html.select(card, "img")[0], "src");
    results.push({
      title,
      url: href.endsWith("/") ? href : `${href}/`,
      coverUrl: cover ? absolute(cover.split("?")[0]) : null,
      lang: "fr",
    });
  }
  return results;
}

export async function getSeries(url) {
  host.log("info", `getSeries:${url}`);
  const response = await host.fetch(url);
  if (response.status !== 200) fail(`Fiche introuvable (${response.status})`);

  const titleNode = host.html.select(response.text, "h1.entry-title")[0];
  if (!titleNode) fail("Titre de série manquant");
  const title = decodeEntities(host.html.text(titleNode));
  const cover = host.html.attr(
    host.html.select(response.text, ".thumb img, .seriestucontl img")[0],
    "src",
  );
  const description = decodeEntities(
    host.html.text(host.html.select(response.text, '[itemprop="description"]')[0]),
  );
  const type = mapType(infoValue(response.text, "Type"));
  const pubStatus = mapStatus(infoValue(response.text, "Statut"));

  return {
    title,
    altTitles: host.html
      .select(response.text, ".seriestualt")
      .map((node) => decodeEntities(host.html.text(node)))
      .filter(Boolean),
    url,
    coverUrl: cover ? absolute(cover.split("?")[0]) : null,
    description,
    type,
    pubStatus,
    lang: "fr",
  };
}

export async function listChapters(url) {
  host.log("info", `listChapters:${url}`);
  const response = await host.fetch(url);
  if (response.status !== 200) fail(`Chapitres introuvables (${response.status})`);

  const items = host.html.select(response.text, "#chapterlist li");
  const chapters = [];
  for (const item of items) {
    const link = host.html.select(item, "a")[0];
    if (!link) continue;
    const chapterUrl = absolute(host.html.attr(link, "href"));
    if (!chapterUrl) continue;
    const label =
      decodeEntities(host.html.text(host.html.select(item, ".chapternum")[0])) ||
      decodeEntities(host.html.text(link));
    const rawNum = host.html.attr(item, "data-num") || label;
    const number = chapterNumber(rawNum);
    if (!Number.isFinite(number)) continue;
    chapters.push({
      number,
      title: label || `Chapitre ${number}`,
      url: chapterUrl.endsWith("/") ? chapterUrl : `${chapterUrl}/`,
    });
  }
  if (chapters.length === 0) fail("Aucun chapitre détecté");
  return chapters;
}

export async function getPageUrls(chapterUrl) {
  host.log("info", `getPageUrls:${chapterUrl}`);
  const response = await host.fetch(chapterUrl);
  if (response.status !== 200) fail(`Chapitre introuvable (${response.status})`);

  const payload = extractTsReader(response.text);
  const images = payload?.sources?.[0]?.images;
  if (!Array.isArray(images) || images.length === 0) {
    fail("Aucune planche dans le chapitre");
  }
  return images.map((src) => {
    const pageUrl = absolute(src);
    if (!pageUrl) fail("Planche sans adresse");
    return pageUrl;
  });
}

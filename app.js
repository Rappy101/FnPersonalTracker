const API = "https://fortnite-api.com";
const ACCOUNT_STORE = "dropTicket.account";

const RARITY = {
  common: ["#bebebe", "#646464"],
  uncommon: ["#87e339", "#1b6a10"],
  rare: ["#37d1ff", "#143e98"],
  epic: ["#e95eff", "#4b1a8c"],
  legendary: ["#f4a447", "#7a2f12"],
  mythic: ["#ffe36b", "#9a6a00"],
  transcendent: ["#ff7a6b", "#7a1622"],
  exotic: ["#7af4ea", "#0b5a6e"],
  icon: ["#5cf2f3", "#004c71"]
};
const FALLBACK_COLORS = ["#5a7bff", "#21236b"];

function hexColor(value) {
  const clean = String(value || "").replace(/[^0-9a-f]/gi, "");
  return clean.length >= 6 ? `#${clean.slice(0, 6)}` : "";
}

function itemColors(item) {
  const series = item?.series?.colors;
  if (Array.isArray(series) && series.length >= 3) {
    const a = hexColor(series[0]);
    const b = hexColor(series[2]);
    if (a && b) return [a, b];
  }
  return RARITY[item?.rarity?.value] || FALLBACK_COLORS;
}

function tileColors(colors) {
  if (!colors) return null;
  const a = hexColor(colors.color1);
  const b = hexColor(colors.color3 || colors.color2);
  return a && b ? [a, b] : null;
}

const WINDOWS = { lifetime: "Lifetime", season: "This season" };
const BUCKETS = ["Outfits", "Back bling", "Pickaxes", "Emotes", "Gliders", "Wraps", "Kicks", "Side kicks", "Instruments", "Jam tracks", "Cars", "LEGO", "Other"];
const COSMETIC_PAGE = 150;

const $ = (sel, root = document) => root.querySelector(sel);

let account = readAccount();
let showForm = !account;
let draft = account
  ? { ...account.query }
  : { name: "", timeWindow: "lifetime" };
let ticketError = "";
let busy = false;
let vbuck = "https://fortnite-api.com/images/vbuck.png";
let shopIds = new Set();
let shopState = "loading";
let shopBucket = "all";
let leakMode = "out";
let leakItems = [];
let leakNote = "";
let cosItems = [];
let cosBucket = "all";
let cosShow = COSMETIC_PAGE;
let cosLoadStarted = false;

function readAccount() {
  try {
    const saved = JSON.parse(localStorage.getItem(ACCOUNT_STORE) || "null");
    if (saved?.v === 2 && saved.data?.accountId) return saved;
    const name = String(saved?.query?.name || saved?.data?.displayName || "").trim();
    if (name) {
      draft = {
        name,
        timeWindow: saved.query?.timeWindow === "season" ? "season" : "lifetime"
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeAccount(next) {
  account = next;
  if (next) localStorage.setItem(ACCOUNT_STORE, JSON.stringify(next));
  else localStorage.removeItem(ACCOUNT_STORE);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function pickImage(images, album) {
  if (typeof album === "string" && album) return album;
  if (!images) return "";
  return images.icon || images.featured || images.large || images.wide || images.small || images.smallIcon || "";
}

function humanize(id) {
  return String(id || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function bucketFor(category, typeLabel, typeValue) {
  if (category === "tracks") return "Jam tracks";
  if (category === "cars") return "Cars";
  if (category === "instruments") return "Instruments";
  if (category === "lego") return "LEGO";
  const type = (typeLabel || "").toLowerCase();
  const value = (typeValue || "").toLowerCase();
  if (value === "sidekick" || type === "sidekick") return "Side kicks";
  if (type.includes("outfit")) return "Outfits";
  if (type.includes("back")) return "Back bling";
  if (type.includes("pickaxe") || type.includes("harvest")) return "Pickaxes";
  if (type.includes("emote") || type.includes("toy") || type.includes("emoji")) return "Emotes";
  if (type.includes("glider")) return "Gliders";
  if (type.includes("wrap")) return "Wraps";
  if (value === "shoe" || type.includes("shoe")) return "Kicks";
  if (type.includes("jam") || type.includes("track")) return "Jam tracks";
  if (type.includes("lego")) return "LEGO";
  return "Other";
}

function num(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString();
}

function kdFmt(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(2);
}

function dayUTC(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date)} UTC`;
}

function explain(err) {
  if (err instanceof TypeError) return "Can't reach Fortnite-API. Check your connection and try again.";
  return err.message || "Request failed.";
}

function explainStats(err) {
  if (err.cors || location.protocol === "file:") {
    return "Stats didn't load. Open this tracker from its website link, not as a saved file on your computer.";
  }
  if (err.code === "NOT_FOUND") return "No Epic account with that display name.";
  if (err.status === 429) return "Too many lookups. Wait a minute and try again.";
  if (err instanceof TypeError) return "Can't reach the stats proxy. Check your connection.";
  return err.message || "Lookup failed.";
}

function statsProxyBase() {
  if (location.protocol === "file:") return null;
  return "/api/osirion";
}

async function osirionGet(path) {
  const base = statsProxyBase();
  if (!base) {
    const error = new Error("Stats proxy unavailable.");
    error.cors = true;
    throw error;
  }
  const res = await fetch(`${base}${path}`, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(typeof body.errorMessage === "string" ? body.errorMessage : `Request failed (${res.status})`);
    error.status = res.status;
    error.code = body.errorCode;
    throw error;
  }
  if (body.success === false) {
    const error = new Error(body.errorMessage || "Lookup failed.");
    error.code = body.errorCode;
    throw error;
  }
  return body;
}

function trackerProfile(name, section) {
  const base = `https://tracker.gg/fortnite/profile/ign/${encodeURIComponent(name)}`;
  return section ? `${base}/${section}` : base;
}

function pickInputBlock(groupedStats) {
  if (!groupedStats || typeof groupedStats !== "object") return null;
  return groupedStats.keyboardmouse || groupedStats.gamepad || groupedStats.touch
    || groupedStats[Object.keys(groupedStats)[0]];
}

function modeBlock(block) {
  if (!block) return null;
  const wins = Number(block.placetop1) || 0;
  const matches = Number(block.matchesplayed) || 0;
  const kills = Number(block.kills) || 0;
  const deaths = Math.max(0, matches - wins);
  return {
    wins,
    matches,
    kills,
    kd: deaths ? kills / deaths : kills,
    winRate: matches ? (wins / matches) * 100 : 0
  };
}

function overallFromGrouped(groupedStats) {
  const totals = { wins: 0, matches: 0, kills: 0 };
  for (const input of Object.values(groupedStats || {})) {
    if (!input || typeof input !== "object") continue;
    for (const block of Object.values(input)) {
      if (!block || typeof block !== "object") continue;
      totals.wins += Number(block.placetop1) || 0;
      totals.matches += Number(block.matchesplayed) || 0;
      totals.kills += Number(block.kills) || 0;
    }
  }
  const deaths = Math.max(0, totals.matches - totals.wins);
  totals.kd = deaths ? totals.kills / deaths : totals.kills;
  totals.winRate = totals.matches ? (totals.wins / totals.matches) * 100 : 0;
  return totals;
}

function latestSeasonLevel(seasonLevels) {
  if (!Array.isArray(seasonLevels) || !seasonLevels.length) return null;
  return [...seasonLevels].sort((a, b) => Number(b.season) - Number(a.season))[0];
}

async function fetchPlayerStats(name, timeWindow) {
  const lookup = await osirionGet(`/v1/accounts/lookup-by-display-name?displayName=${encodeURIComponent(name)}`);
  const accountId = lookup.accountId || lookup.accounts?.[0]?.accountId;
  if (!accountId) throw new Error("No account id in the response.");
  const stats = await osirionGet(`/v1/stats/account?accountId=${encodeURIComponent(accountId)}&timeframe=${encodeURIComponent(timeWindow)}`);
  const displayName = lookup.accountDetails?.epic || lookup.accounts?.[0]?.accountDetails?.epic || name;
  return {
    accountId,
    displayName,
    stats,
    overall: overallFromGrouped(stats.groupedStats),
    pass: latestSeasonLevel(stats.seasonLevels),
    modes: (() => {
      const input = pickInputBlock(stats.groupedStats);
      if (!input) return null;
      return {
        solo: modeBlock(input.solo),
        duo: modeBlock(input.duo),
        squad: modeBlock(input.squad),
        ltm: modeBlock(input.other)
      };
    })()
  };
}

async function getJson(url, key) {
  const headers = {};
  if (key) headers.Authorization = key;
  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body.error === "string" ? body.error : `Request failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return body;
}

function passStub(pass) {
  if (!pass?.level) return "—";
  return pass.season ? `S${pass.season} · ${num(pass.level)}` : num(pass.level);
}

function stubHtml(overall, pass) {
  const wins = overall ? num(overall.wins) : "—";
  const kd = overall ? kdFmt(overall.kd) : "—";
  const level = passStub(pass);
  return `
    <div class="stamp"><span>Wins</span><strong>${esc(wins)}</strong></div>
    <div class="stamp"><span>K/D</span><strong>${esc(kd)}</strong></div>
    <div class="stamp"><span>Pass</span><strong>${esc(level)}</strong></div>
  `;
}

function modeHtml(modes) {
  if (!modes) return "";
  const rows = [
    ["Solo", modes.solo],
    ["Duo", modes.duo],
    ["Squad", modes.squad],
    ["Other", modes.ltm]
  ].filter(([, block]) => block?.matches);
  if (!rows.length) return "";
  return `<ul class="modes">${rows.map(([label, block]) => `
    <li>
      <span>${label}</span>
      <strong>${esc(num(block.wins))} <small>wins</small></strong>
      <em>${esc(kdFmt(block.kd))} kd</em>
    </li>`).join("")}</ul>`;
}

function renderTicket() {
  const root = $("#ticket");
  const data = account?.data;
  const overall = data?.overall;
  const pass = data?.pass;
  const displayName = data?.displayName || draft.name;
  const savedLine = account && !showForm
    ? [
        overall?.matches != null ? `${num(overall.matches)} matches` : "",
        overall?.winRate != null ? `${Number(overall.winRate).toFixed(1)}% wins` : "",
        overall?.kills != null ? `${num(overall.kills)} kills` : "",
        account.savedAt ? `Updated ${dayUTC(account.savedAt)}` : ""
      ].filter(Boolean).join(" · ")
    : "Enter your Epic display name. Stats stay in this browser.";

  const form = `
    <form class="form-grid" id="lookup-form">
      <label>Epic display name
        <input id="account-name" name="name" required maxlength="64" autocomplete="nickname" value="${esc(draft.name)}">
      </label>
      <label>Stats window
        <select name="timeWindow">
          ${Object.entries(WINDOWS).map(([value, label]) => `<option value="${value}" ${draft.timeWindow === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
      <div class="actions">
        <button class="btn btn-primary" type="submit">Look up and save</button>
        ${account ? `<button class="btn btn-ghost" id="cancel-form" type="button">Back</button>` : ""}
      </div>
    </form>`;

  const tracker = displayName
    ? `<a class="btn btn-ghost" href="${esc(trackerProfile(displayName, "overview"))}" target="_blank" rel="noopener noreferrer">Tracker.gg</a>`
    : "";

  const actions = `
    <div class="actions">
      <button class="btn btn-primary" id="refresh" type="button">Refresh stats</button>
      ${tracker}
      <button class="btn btn-ghost" id="another" type="button">Look up another</button>
      <button class="btn btn-ghost" id="forget" type="button">Forget account</button>
    </div>
    ${modeHtml(data?.modes)}`;

  const query = account?.query || draft;
  root.innerHTML = `
    <div class="ticket-main">
      <p class="kicker">${account && !showForm ? `Epic · ${esc(WINDOWS[query.timeWindow] || "Lifetime")}` : "Player lookup"}</p>
      <h3 class="ticket-name">${account && !showForm ? esc(displayName) : "Find your player"}</h3>
      <p class="lede">${esc(savedLine)}</p>
      ${ticketError ? `<p class="alert" role="alert">${esc(ticketError)}</p>` : ""}
      ${showForm ? form : actions}
    </div>
    <div class="ticket-stub">${stubHtml(overall, pass)}</div>
  `;

  $("#lookup-form")?.addEventListener("submit", onSubmit);
  $("#cancel-form")?.addEventListener("click", () => {
    showForm = false;
    ticketError = "";
    renderTicket();
  });
  $("#refresh")?.addEventListener("click", refreshAccount);
  $("#another")?.addEventListener("click", () => {
    draft = { ...account.query };
    showForm = true;
    ticketError = "";
    renderTicket();
    $("#account-name")?.focus();
  });
  $("#forget")?.addEventListener("click", () => {
    writeAccount(null);
    draft = { name: "", timeWindow: draft.timeWindow };
    showForm = true;
    ticketError = "";
    renderTicket();
  });
}

async function onSubmit(event) {
  event.preventDefault();
  if (busy) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  draft = {
    name: String(data.get("name") || "").trim(),
    timeWindow: String(data.get("timeWindow") || "lifetime")
  };
  if (!draft.name) return;
  busy = true;
  const button = form.querySelector("[type=submit]");
  button.disabled = true;
  button.textContent = "Looking up…";
  try {
    const player = await fetchPlayerStats(draft.name, draft.timeWindow);
    writeAccount({
      v: 2,
      savedAt: new Date().toISOString(),
      query: draft,
      data: player
    });
    showForm = false;
    ticketError = "";
    renderTicket();
  } catch (err) {
    ticketError = explainStats(err);
    renderTicket();
  } finally {
    busy = false;
  }
}

async function refreshAccount() {
  if (busy || !account) return;
  busy = true;
  const button = $("#refresh");
  if (button) {
    button.disabled = true;
    button.textContent = "Refreshing…";
  }
  try {
    const windowName = account.query?.timeWindow || "lifetime";
    const name = account.query?.name || account.data?.displayName;
    const player = await fetchPlayerStats(name, windowName);
    writeAccount({
      ...account,
      savedAt: new Date().toISOString(),
      query: { ...account.query, name: player.displayName || name },
      data: player
    });
    ticketError = "";
    renderTicket();
  } catch (err) {
    ticketError = explainStats(err);
    renderTicket();
  } finally {
    busy = false;
  }
}

function priceHtml(price) {
  if (!price) return `<span class="free">Free</span>`;
  const icon = safeUrl(vbuck);
  const img = icon ? `<img class="vbuck" alt="" src="${esc(icon)}" width="14" height="14">` : "";
  return `${img}<span>${esc(Number(price).toLocaleString())}</span>`;
}

const cardStore = new Map();
let cardSeq = 0;

function keep(card) {
  card.key = `c${cardSeq++}`;
  cardStore.set(card.key, card);
  return card;
}

function timeLeft(iso, short) {
  const ms = new Date(iso).getTime() - Date.now();
  if (!(ms > 0) || ms > 90 * 86400000) return "";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (short) return days > 0 ? `${days}d` : hours > 0 ? `${hours}h` : `${minutes}m`;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function cardHtml(card, index) {
  const src = safeUrl(card.image);
  const [c1, c2] = card.colors || FALLBACK_COLORS;
  const flag = card.flag
    ? `<span class="flag ${card.flagHot ? "flag-hot" : ""}">${esc(card.flag)}</span>`
    : "";
  const left = card.outDate ? timeLeft(card.outDate, true) : "";
  const timer = left
    ? `<span class="timer" data-out="${esc(card.outDate)}" title="Leaves the shop in ${esc(timeLeft(card.outDate))}">${esc(left)}</span>`
    : "";
  const cover = card.cover ? " art-cover" : "";
  return `<article class="card" tabindex="0" role="button" aria-label="${esc(card.name)}, open preview" data-key="${esc(card.key || "")}" style="--c1:${c1};--c2:${c2}" data-name="${esc(card.search)}" data-bucket="${esc(card.bucket)}" data-unreleased="${card.unreleased ? "true" : "false"}">
    <div class="art${cover}">
      ${flag}
      ${timer}
      ${src ? `<img alt="${esc(card.name)}" src="${esc(src)}" loading="${index < 6 ? "eager" : "lazy"}" decoding="async" fetchpriority="${index < 6 ? "high" : "low"}">` : `<span class="art-miss">No image</span>`}
    </div>
    <div class="plate">
      <p class="name" title="${esc(card.name)}">${esc(card.name)}</p>
      <p class="meta">${esc(card.meta)}</p>
      ${card.price != null ? `<p class="price">${priceHtml(card.price)}</p>` : ""}
    </div>
  </article>`;
}

function bindImages(root) {
  root.querySelectorAll("img").forEach((img) => {
    img.addEventListener("error", () => {
      if (img.classList.contains("vbuck")) {
        img.remove();
        return;
      }
      const miss = document.createElement("span");
      miss.className = "art-miss";
      miss.textContent = "No image";
      if (img.parentElement?.classList.contains("art")) img.replaceWith(miss);
      else img.remove();
    }, { once: true });
  });
}

function normalizeShop(entries) {
  const cards = [];
  for (const entry of entries) {
    const pieces = [];
    for (const item of entry.brItems || []) {
      pieces.push({
        id: item.id,
        name: item.name,
        image: pickImage(item.images),
        rarity: item.rarity?.value || "",
        colors: itemColors(item),
        type: item.type?.displayValue || "Item",
        typeValue: item.type?.value || "",
        category: "br",
        raw: item
      });
    }
    for (const item of entry.instruments || []) {
      pieces.push({
        id: item.id,
        name: item.name,
        image: pickImage(item.images),
        rarity: item.rarity?.value || "",
        colors: itemColors(item),
        type: item.type?.displayValue || "Instrument",
        typeValue: item.type?.value || "",
        category: "instruments",
        raw: item
      });
    }
    for (const item of entry.cars || []) {
      pieces.push({
        id: item.id,
        name: item.name,
        image: pickImage(item.images),
        rarity: item.rarity?.value || "",
        colors: itemColors(item),
        type: item.type?.displayValue || "Car",
        typeValue: item.type?.value || "",
        category: "cars",
        raw: item
      });
    }
    for (const item of entry.tracks || []) {
      pieces.push({
        id: item.id,
        name: item.title,
        image: item.albumArt,
        rarity: "",
        type: "Jam track",
        artist: item.artist,
        category: "tracks",
        raw: item
      });
    }
    const named = pieces.filter((piece) => piece.name);
    if (!named.length) continue;
    const names = [...new Set(named.map((piece) => piece.name))];
    const primary = named.find((piece) => piece.image) || named[0];
    const title = names.length <= 2 ? names.join(" + ") : `${names[0]} +${names.length - 1}`;
    cards.push(keep({
      pieces: named,
      inDate: entry.inDate || "",
      outDate: entry.outDate || "",
      regularPrice: entry.regularPrice ?? null,
      bundleName: entry.bundle?.name || "",
      name: title,
      search: names.join(" ").toLowerCase(),
      image: primary.image,
      rarity: primary.rarity,
      colors: tileColors(entry.colors) || primary.colors || FALLBACK_COLORS,
      cover: primary.category === "tracks",
      bucket: bucketFor(primary.category, primary.type, primary.typeValue),
      meta: [names.length > 1 ? `${primary.type} bundle` : primary.type, primary.artist || ""].filter(Boolean).join(" · "),
      price: entry.finalPrice ?? entry.regularPrice ?? null,
      section: (entry.layout?.name || "Shop").trim() || "Shop",
      index: Number.isFinite(entry.layout?.index) ? entry.layout.index : 999,
      sort: entry.sortPriority ?? 0,
      ids: named.map((piece) => piece.id).filter(Boolean)
    }));
  }
  return cards;
}

function renderShop(cards, dateLabel) {
  const counts = new Map();
  for (const card of cards) counts.set(card.bucket, (counts.get(card.bucket) || 0) + 1);
  const chips = [`<button type="button" class="chip" data-bucket="all" aria-pressed="${shopBucket === "all" ? "true" : "false"}">All <span>${cards.length}</span></button>`];
  for (const name of BUCKETS) {
    if (!counts.get(name)) continue;
    chips.push(`<button type="button" class="chip" data-bucket="${esc(name)}" aria-pressed="${shopBucket === name ? "true" : "false"}">${esc(name)} <span>${counts.get(name)}</span></button>`);
  }
  $("#shop-chips").innerHTML = chips.join("");
  $("#shop-meta").textContent = [dateLabel, `${cards.length} offers`].filter(Boolean).join(" · ");

  const groups = new Map();
  for (const card of cards) {
    if (!groups.has(card.section)) groups.set(card.section, { index: card.index, items: [] });
    const group = groups.get(card.section);
    group.index = Math.min(group.index, card.index);
    group.items.push(card);
  }
  const ordered = [...groups.entries()].sort((a, b) => a[1].index - b[1].index || a[0].localeCompare(b[0]));
  let cardIndex = 0;
  const html = ordered.map(([section, group]) => {
    group.items.sort((a, b) => b.sort - a.sort);
    return `<section class="shelf">
      <h3 class="shelf-title">${esc(section)} <span>${group.items.length}</span></h3>
      <div class="grid">${group.items.map((card) => cardHtml(card, cardIndex++)).join("")}</div>
    </section>`;
  }).join("");
  const root = $("#shop-root");
  root.innerHTML = html || `<p class="status">Shop came back empty.</p>`;
  bindImages(root);
  applyShopFilter();
}

function applyShopFilter() {
  const query = $("#shop-search").value.trim().toLowerCase();
  const root = $("#shop-root");
  for (const card of root.querySelectorAll(".card")) {
    const bucketOk = shopBucket === "all" || card.dataset.bucket === shopBucket;
    const nameOk = !query || card.dataset.name.includes(query);
    card.hidden = !(bucketOk && nameOk);
  }
  for (const shelf of root.querySelectorAll(".shelf")) {
    shelf.hidden = !shelf.querySelector(".card:not([hidden])");
  }
  const any = root.querySelector(".card:not([hidden])");
  $("#shop-empty").hidden = Boolean(any) || !root.querySelector(".card");
}

function normalizeLeaks(data) {
  const items = data?.items || {};
  const out = [];
  const push = (raw, category, name, typeLabel, cosmeticId) => {
    const id = raw.id || cosmeticId || name || "";
    const fallback = !name;
    const label = name || humanize(cosmeticId || id);
    out.push(keep({
      id,
      cosmeticId: cosmeticId || "",
      name: label,
      fallback,
      image: pickImage(raw.images),
      rarity: raw.rarity?.value || "",
      colors: itemColors(raw),
      bucket: bucketFor(category, typeLabel, raw.type?.value),
      meta: [typeLabel, raw.added ? `Added ${dayUTC(raw.added)}` : ""].filter(Boolean).join(" · "),
      added: raw.added || "",
      leak: true,
      pieces: [{
        id: category === "lego" && cosmeticId ? cosmeticId : id,
        name: label,
        image: pickImage(raw.images),
        rarity: raw.rarity?.value || "",
        colors: itemColors(raw),
        type: typeLabel,
        category: category === "lego" && cosmeticId ? "lego" : category,
        raw
      }],
      search: ""
    }));
    out[out.length - 1].search = out[out.length - 1].name.toLowerCase();
  };

  for (const raw of items.br || []) push(raw, "br", raw.name, raw.type?.displayValue || "Item");
  for (const raw of items.cars || []) push(raw, "cars", raw.name, raw.type?.displayValue || "Car");
  for (const raw of items.instruments || []) push(raw, "instruments", raw.name, raw.type?.displayValue || "Instrument");
  for (const raw of items.legoKits || []) push(raw, "lego", raw.name, "LEGO kit");
  for (const raw of items.lego || []) push(raw, "lego", raw.name, "LEGO", raw.cosmeticId);

  out.sort((a, b) => {
    if (a.fallback !== b.fallback) return a.fallback ? 1 : -1;
    return String(b.added).localeCompare(String(a.added));
  });
  return out;
}

function isUnreleased(item) {
  if (shopState !== "ready") return false;
  if (shopIds.has(item.id)) return false;
  if (item.cosmeticId && shopIds.has(item.cosmeticId)) return false;
  return true;
}

function renderLeaks() {
  const root = $("#leak-root");
  if (shopState === "failed") {
    leakMode = "all";
    $("#leak-chips .chip[data-mode='out']")?.setAttribute("aria-pressed", "false");
    $("#leak-chips .chip[data-mode='all']")?.setAttribute("aria-pressed", "true");
  }
  const note = shopState === "failed"
    ? `${leakNote} Shop didn't load, so the unreleased check is off.`.trim()
    : leakNote;
  if (note) $("#leak-meta").textContent = note;
  if (!leakItems.length) {
    root.innerHTML = `<p class="status">${esc(note || "No new cosmetics in this response.")}</p>`;
    $("#leak-out-count").textContent = "";
    $("#leak-all-count").textContent = "";
    return;
  }
  const prepared = leakItems.map((item) => {
    const unreleased = isUnreleased(item);
    return {
      ...item,
      unreleased,
      flag: shopState === "ready" ? (unreleased ? "Unreleased" : "In shop") : "",
      flagHot: unreleased
    };
  });
  const outCount = prepared.filter((item) => item.unreleased).length;
  $("#leak-out-count").textContent = shopState === "ready" ? String(outCount) : "";
  $("#leak-all-count").textContent = String(prepared.length);
  root.innerHTML = prepared.map((item, index) => cardHtml(item, index)).join("");
  bindImages(root);
  applyLeakFilter();
}

function applyLeakFilter() {
  const query = $("#leak-search").value.trim().toLowerCase();
  const root = $("#leak-root");
  let visible = 0;
  for (const card of root.querySelectorAll(".card")) {
    const modeOk = leakMode === "all" || shopState !== "ready" || card.dataset.unreleased === "true";
    const nameOk = !query || card.dataset.name.includes(query);
    const show = modeOk && nameOk;
    card.hidden = !show;
    if (show) visible += 1;
  }
  const empty = $("#leak-empty");
  if (!root.querySelector(".card")) {
    empty.hidden = true;
    return;
  }
  empty.hidden = visible > 0;
  if (!visible) {
    empty.textContent = leakMode === "out" && !query
      ? "Everything new is already in the shop."
      : "Nothing matches that filter.";
  }
}

function buildLabel(build) {
  const match = String(build || "").match(/Release-([0-9.]+)/);
  return match ? `Release ${match[1]}` : "";
}

function renderNews(data) {
  const root = $("#news-root");
  const groups = [
    ["Battle Royale", data?.br, "motds"],
    ["Save the World", data?.stw, "messages"],
    ["Creative", data?.creative, "motds"]
  ];
  const html = groups.map(([label, block, key]) => {
    if (!block) return "";
    const posts = block[key] || block.motds || block.messages || [];
    if (!posts.length) return "";
    const cards = posts.map((post) => {
      const img = safeUrl(post.image || post.tileImage || "");
      return `<article class="poster">
        ${img ? `<img alt="" src="${esc(img)}">` : ""}
        <div class="copy">
          <h3>${esc(post.title || "Update")}</h3>
          ${post.body ? `<p>${esc(post.body)}</p>` : ""}
        </div>
      </article>`;
    }).join("");
    return `<div class="news-group">
      <p class="eyebrow">${esc(label)}${block.date ? `<span>${esc(dayUTC(block.date))}</span>` : ""}</p>
      <div class="news-stack">${cards}</div>
    </div>`;
  }).join("");
  root.innerHTML = html || `<p class="status">No news in this response.</p>`;
  bindImages(root);
}

async function loadShop() {
  $("#shop-root").innerHTML = `<p class="status">Loading shop…</p>`;
  try {
    const body = await getJson(`${API}/v2/shop?language=en`);
    vbuck = body.data?.vbuckIcon || vbuck;
    const cards = normalizeShop(body.data?.entries || []);
    shopIds = new Set(cards.flatMap((card) => card.ids));
    shopState = "ready";
    renderShop(cards, body.data?.date ? dayUTC(body.data.date) : "");
  } catch (err) {
    shopState = "failed";
    $("#shop-meta").textContent = "Shop didn't load.";
    $("#shop-root").innerHTML = `<p class="status">${esc(explain(err))} <button class="btn btn-dark" id="shop-retry" type="button">Try again</button></p>`;
    $("#shop-retry")?.addEventListener("click", () => {
      shopState = "loading";
      loadShop();
    });
  }
  if (leakItems.length) renderLeaks();
}

async function loadNews() {
  $("#news-root").innerHTML = `<p class="status">Loading news…</p>`;
  try {
    const body = await getJson(`${API}/v2/news?language=en`);
    renderNews(body.data);
  } catch (err) {
    $("#news-root").innerHTML = `<p class="status">${esc(explain(err))} <button class="btn btn-dark" id="news-retry" type="button">Try again</button></p>`;
    $("#news-retry")?.addEventListener("click", loadNews);
  }
}

function normalizeCosmeticCatalog(items) {
  const out = [];
  for (const raw of items) {
    if (!raw?.id && !raw?.name) continue;
    const typeLabel = raw.type?.displayValue || "Item";
    out.push(keep({
      id: raw.id,
      name: raw.name,
      image: pickImage(raw.images),
      rarity: raw.rarity?.value || "",
      colors: itemColors(raw),
      bucket: bucketFor("br", typeLabel, raw.type?.value),
      meta: [typeLabel, raw.added ? `Added ${dayUTC(raw.added)}` : ""].filter(Boolean).join(" · "),
      added: raw.added || "",
      catalog: true,
      pieces: [{
        id: raw.id,
        name: raw.name,
        image: pickImage(raw.images),
        rarity: raw.rarity?.value || "",
        colors: itemColors(raw),
        type: typeLabel,
        typeValue: raw.type?.value || "",
        category: "br",
        raw
      }],
      search: String(raw.name || "").toLowerCase()
    }));
  }
  out.sort((a, b) => {
    const tb = Date.parse(b.added) || 0;
    const ta = Date.parse(a.added) || 0;
    if (tb !== ta) return tb - ta;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return out;
}

function filteredCosmetics() {
  const query = $("#cos-search")?.value.trim().toLowerCase() || "";
  return cosItems.filter((item) => {
    const bucketOk = cosBucket === "all" || item.bucket === cosBucket;
    const nameOk = !query || item.search.includes(query);
    return bucketOk && nameOk;
  });
}

function renderCosmetics() {
  const root = $("#cos-root");
  if (!cosItems.length) {
    root.innerHTML = `<p class="status">No cosmetics in this response.</p>`;
    $("#cos-chips").innerHTML = "";
    $("#cos-meta").textContent = "";
    return;
  }
  const counts = new Map();
  for (const item of cosItems) counts.set(item.bucket, (counts.get(item.bucket) || 0) + 1);
  const chips = [`<button type="button" class="chip" data-bucket="all" aria-pressed="${cosBucket === "all" ? "true" : "false"}">All <span>${cosItems.length}</span></button>`];
  for (const name of BUCKETS) {
    if (!counts.get(name)) continue;
    chips.push(`<button type="button" class="chip" data-bucket="${esc(name)}" aria-pressed="${cosBucket === name ? "true" : "false"}">${esc(name)} <span>${counts.get(name)}</span></button>`);
  }
  $("#cos-chips").innerHTML = chips.join("");
  applyCosmeticsFilter(false);
}

function applyCosmeticsFilter(resetShow = true) {
  const root = $("#cos-root");
  if (!cosItems.length) return;
  if (resetShow) cosShow = COSMETIC_PAGE;
  const filtered = filteredCosmetics();
  const slice = filtered.slice(0, cosShow);
  const meta = $("#cos-meta");
  const query = $("#cos-search")?.value.trim() || "";
  if (meta) {
    const parts = [`${cosItems.length.toLocaleString()} in catalog`];
    if (query || cosBucket !== "all") parts.push(`${filtered.length.toLocaleString()} matches`);
    if (filtered.length > slice.length) parts.push(`showing ${slice.length.toLocaleString()}`);
    meta.textContent = parts.join(" · ");
  }
  let html = slice.map((item, index) => cardHtml(item, index)).join("");
  if (filtered.length > slice.length) {
    const next = Math.min(COSMETIC_PAGE, filtered.length - slice.length);
    html += `<p class="cos-more-wrap"><button class="btn btn-dark" id="cos-more" type="button">Show ${next.toLocaleString()} more</button></p>`;
  }
  root.innerHTML = html || `<p class="status">${query || cosBucket !== "all" ? "Nothing matches that filter." : "Pick a type or search by name."}</p>`;
  bindImages(root);
  const empty = $("#cos-empty");
  if (empty) {
    const filteredOut = (query || cosBucket !== "all") && !slice.length;
    empty.hidden = !filteredOut;
    empty.textContent = filteredOut ? "Nothing matches that filter." : "Narrow your search or pick a type.";
  }
  $("#cos-more")?.addEventListener("click", () => {
    cosShow += COSMETIC_PAGE;
    applyCosmeticsFilter(false);
  });
}

function ensureCosmeticsLoad() {
  if (cosLoadStarted) return;
  cosLoadStarted = true;
  loadCosmetics();
}

async function loadCosmetics() {
  $("#cos-root").innerHTML = `<p class="status">Loading catalog…</p>`;
  try {
    const body = await getJson(`${API}/v2/cosmetics/br?language=en`);
    const list = Array.isArray(body.data) ? body.data : Object.values(body.data || {});
    cosItems = normalizeCosmeticCatalog(list);
    renderCosmetics();
  } catch (err) {
    cosItems = [];
    $("#cos-meta").textContent = "Catalog didn't load.";
    $("#cos-root").innerHTML = `<p class="status">${esc(explain(err))} <button class="btn btn-dark" id="cos-retry" type="button">Try again</button></p>`;
    $("#cos-retry")?.addEventListener("click", () => {
      cosLoadStarted = true;
      loadCosmetics();
    });
  }
}

async function loadLeaks() {
  $("#leak-root").innerHTML = `<p class="status">Loading new cosmetics…</p>`;
  try {
    const body = await getJson(`${API}/v2/cosmetics/new?language=en`);
    leakItems = normalizeLeaks(body.data);
    leakNote = [
      body.data?.date ? dayUTC(body.data.date) : "",
      buildLabel(body.data?.build)
    ].filter(Boolean).join(" · ");
    if (shopState !== "loading") renderLeaks();
  } catch (err) {
    leakItems = [];
    $("#leak-root").innerHTML = `<p class="status">${esc(explain(err))} <button class="btn btn-dark" id="leak-retry" type="button">Try again</button></p>`;
    $("#leak-retry")?.addEventListener("click", loadLeaks);
  }
}

const detailCache = new Map();
const missingVideos = new Set();
let ggIds = null;
let ggIdsPromise = null;
let viewer = null;

function loadGgIds() {
  if (window.GG_IDS) {
    ggIds = window.GG_IDS;
    return Promise.resolve(ggIds);
  }
  if (!ggIdsPromise) {
    ggIdsPromise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "gg-ids.js";
      script.onload = () => {
        ggIds = window.GG_IDS || {};
        resolve(ggIds);
      };
      script.onerror = () => {
        ggIds = {};
        resolve(ggIds);
      };
      document.head.appendChild(script);
    });
  }
  return ggIdsPromise;
}

function clipSrc(id, file) {
  const ggId = ggIds?.[id];
  if (!ggId || missingVideos.has(`${id}:${file}`)) return "";
  return `https://fnggcdn.com/items/${ggId}/${file}.mp4`;
}

function viewerMedia(piece, images) {
  const legoPiece = piece.category === "lego";
  const showLego = Boolean(images.lego) && !legoPiece;
  let main = "";
  let mainKey = "";
  if (legoPiece && clipSrc(piece.id, "lego")) {
    main = clipSrc(piece.id, "lego");
    mainKey = `${piece.id}:lego`;
  } else if (clipSrc(piece.id, "video")) {
    main = clipSrc(piece.id, "video");
    mainKey = `${piece.id}:video`;
  }
  return {
    main,
    mainKey,
    lego: showLego ? clipSrc(piece.id, "lego") : "",
    legoKey: `${piece.id}:lego`,
    showLego
  };
}

function fetchDetails(id) {
  if (!detailCache.has(id)) {
    const url = `${API}/v2/cosmetics/br/${encodeURIComponent(id)}?language=en&responseFlags=4`;
    detailCache.set(id, getJson(url).then((body) => body.data || null).catch(() => {
      detailCache.delete(id);
      return null;
    }));
  }
  return detailCache.get(id);
}

function shopRuns(history) {
  const days = [...new Set((history || []).map((iso) => String(iso).slice(0, 10)))].sort();
  let runs = 0;
  let prev = 0;
  for (const day of days) {
    const time = Date.parse(`${day}T00:00:00Z`);
    if (!prev || time - prev > 86400000) runs += 1;
    prev = time;
  }
  return { days, runs };
}

function daysAgo(iso) {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const days = Math.floor((Date.now() - time) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days.toLocaleString()} days ago`;
}

function viewerData() {
  const piece = viewer.card.pieces?.[viewer.pieceIndex] || viewer.card.pieces?.[0] || {};
  const details = viewer.details || {};
  const raw = { ...(piece.raw || {}), ...details };
  const images = raw.images || {};
  return { piece, raw, images };
}

function styleGroups(raw) {
  return (raw.variants || []).filter((group) => !/emote/i.test(`${group.channel} ${group.type}`)).map((group) => ({
    label: group.type && group.type.toUpperCase() !== "STYLE" ? group.type : "Style",
    channel: group.channel || "",
    options: (group.options || []).filter((option) => option.image).map((option, index) => ({
      name: option.name || "Style",
      image: option.image,
      tag: option.tag || "",
      pick: index + 1
    }))
  })).filter((group) => group.options.length);
}

function isSidekick(piece, raw) {
  return raw.type?.value === "sidekick" || /^Companion_/i.test(piece.id || "");
}

function styleIndexes(groups, picks, groupIndex, pick) {
  const indexes = groups.map((group, index) => {
    const chosen = Number(picks?.[index]) || 1;
    return chosen >= 1 && chosen <= group.options.length ? chosen : 1;
  });
  if (groupIndex != null) indexes[groupIndex] = pick;
  return indexes;
}

function sidekickFiles(groups, indexes) {
  let outfit = groups.findIndex((group) => /outfit/i.test(group.channel));
  if (outfit < 0) outfit = 0;
  const option = groups[outfit]?.options[(indexes[outfit] || 1) - 1];
  const stage = Number(String(option?.tag || "").match(/(\d+)$/)?.[1]);
  if (!stage || stage <= 1) return ["video"];
  return [`video-${stage}-1`, `video-${stage}`];
}

function styleFiles(groups, indexes, sidekick) {
  if (sidekick) return sidekickFiles(groups, indexes);
  if (!indexes.length || indexes.every((n) => n === 1)) return ["video"];
  const files = [`video-${indexes.join("-")}`];
  const trimmed = [...indexes];
  while (trimmed.length > 1 && trimmed[trimmed.length - 1] === 1) trimmed.pop();
  const short = `video-${trimmed.join("-")}`;
  if (short !== files[0]) files.push(short);
  return files;
}

function styleClip(id, groups, indexes, sidekick) {
  for (const file of styleFiles(groups, indexes, sidekick)) {
    const src = clipSrc(id, file);
    if (src) return { src, key: `${id}:${file}`, file };
  }
  return { src: "", key: "", file: "" };
}

function styleImage(groups, indexes) {
  let image = "";
  indexes.forEach((pick, index) => {
    const option = groups[index]?.options[pick - 1];
    if (!option?.image) return;
    if (!image || pick !== 1) image = option.image;
  });
  return image;
}

function viewerTabs(piece, raw, images) {
  const media = viewerMedia(piece, images);
  const tabs = [];
  if (media.main) tabs.push({ id: "video", label: "Video" });
  if (media.showLego) tabs.push({ id: "lego", label: "LEGO" });
  const groups = styleGroups(raw);
  const styleCount = groups.reduce((sum, group) => sum + group.options.length, 0);
  if (styleCount > 1) tabs.push({ id: "styles", label: `Styles ${styleCount}` });
  if (!media.main && !media.lego) tabs.unshift({ id: "image", label: "Image" });
  if (!tabs.length) tabs.push({ id: "image", label: "Image" });
  return { tabs, groups, media };
}

function renderViewer() {
  if (!viewer) return;
  const { card } = viewer;
  const { piece, raw, images } = viewerData();
  const { tabs, groups, media } = viewerTabs(piece, raw, images);
  const stylePick = viewer.tab === "styles"
    ? styleClip(piece.id, groups, styleIndexes(groups, viewer.picks), isSidekick(piece, raw))
    : { src: "", key: "", file: "" };
  if (viewer.preferVideo && ggIds) {
    if (tabs.some((tab) => tab.id === "video")) viewer.tab = "video";
    else if (media.lego) viewer.tab = "lego";
    viewer.preferVideo = false;
  }
  if (!tabs.some((tab) => tab.id === viewer.tab)) {
    viewer.tab = (tabs.find((tab) => tab.id === "lego") || tabs[0])?.id || "image";
  }
  const [c1, c2] = piece.colors || card.colors || FALLBACK_COLORS;
  const dialog = $("#viewer");
  dialog.style.setProperty("--c1", c1);
  dialog.style.setProperty("--c2", c2);

  const stage = $("#viewer-stage");
  const clip = viewer.tab === "video" ? media.main : viewer.tab === "lego" ? media.lego : stylePick.src;
  const clipKey = viewer.tab === "lego" ? media.legoKey : viewer.tab === "styles" ? stylePick.key : media.mainKey;
  stage.classList.toggle("is-video", Boolean(clip));
  const name = viewer.details?.name || piece.name || card.name;
  const styleFallback = viewer.tab === "styles" ? safeUrl(styleImage(groups, styleIndexes(groups, viewer.picks))) : "";
  if (clip) {
    if (viewer.stageKey !== `video|${clip}`) {
      stage.innerHTML = `<video class="item-video" src="${esc(clip)}" ${styleFallback ? `poster="${esc(styleFallback)}"` : ""} muted loop autoplay playsinline></video>`;
      const video = stage.querySelector("video");
      video.addEventListener("error", () => {
        if (clipKey) missingVideos.add(clipKey);
        if (!viewer) return;
        viewer.preferVideo = false;
        viewer.stageKey = "";
        renderViewer();
      }, { once: true });
    }
    viewer.stageKey = `video|${clip}`;
  } else {
    let src = "";
    if (viewer.tab === "lego") src = images.lego?.large || images.lego?.wide || images.lego?.small;
    else if (viewer.tab === "styles") src = styleImage(groups, styleIndexes(groups, viewer.picks));
    else if (piece.category === "tracks") src = raw.albumArt || piece.image;
    else if (piece.category === "lego") src = piece.image;
    else src = images.featured || images.large || images.icon || images.wide || piece.image;
    const url = safeUrl(src);
    if (viewer.stageKey !== `img|${url}`) {
      stage.innerHTML = url
        ? `<img class="${piece.category === "tracks" ? "cover" : ""}" src="${esc(url)}" alt="${esc(name)}${viewer.tab === "lego" ? " LEGO style" : ""}">`
        : `<span class="art-miss">No image</span>`;
      bindImages(stage);
    }
    viewer.stageKey = `img|${url}`;
  }

  $("#viewer-tabs").innerHTML = tabs.length > 1
    ? tabs.map((tab) => `<button type="button" class="chip" data-tab="${tab.id}" aria-pressed="${viewer.tab === tab.id ? "true" : "false"}">${esc(tab.label)}</button>`).join("")
    : "";

  const stylesRoot = $("#viewer-styles");
  if (viewer.tab === "styles") {
    let shown = 0;
    const rows = [];
    const keys = [];
    for (const [groupIndex, group] of groups.entries()) {
      const swatches = group.options.map((option) => {
        if (shown >= 40) return "";
        shown += 1;
        const image = safeUrl(option.image);
        if (!image) return "";
        keys.push(image);
        return `<button type="button" class="swatch" data-group="${groupIndex}" data-pick="${option.pick}" title="${esc(option.name)}"><img src="${esc(image)}" alt="${esc(option.name)}" loading="lazy"></button>`;
      }).join("");
      if (!swatches) continue;
      const label = groups.length > 1 ? `<span class="style-label">${esc(group.label)}</span>` : "";
      rows.push(`<div class="style-row">${label}${swatches}</div>`);
    }
    const styleKey = keys.join("|");
    if (viewer.styleKey !== styleKey) {
      stylesRoot.innerHTML = rows.join("");
      bindImages(stylesRoot);
      viewer.styleKey = styleKey;
    }
    for (const button of stylesRoot.querySelectorAll("[data-pick]")) {
      const on = (Number(viewer.picks?.[button.dataset.group]) || 1) === Number(button.dataset.pick);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    }
  } else if (stylesRoot.innerHTML) {
    stylesRoot.innerHTML = "";
    viewer.styleKey = "";
  }

  const facts = [];
  if (card.outDate && !card.leak) {
    const left = timeLeft(card.outDate);
    facts.push(["Leaves in", left ? `<strong data-out-full="${esc(card.outDate)}">${esc(left)}</strong> <small>${esc(dayUTC(card.outDate))}</small>` : "Leaving soon"]);
  }
  if (card.inDate && !card.leak) facts.push(["In shop since", esc(dayUTC(card.inDate))]);
  if (card.leak) facts.push(["Status", card.unreleased || isUnreleased(card) ? "Not released yet" : "In today's shop"]);

  const history = viewer.details?.shopHistory;
  if (Array.isArray(history) && history.length) {
    const { days, runs } = shopRuns(history);
    const cutoff = (!card.leak && card.inDate ? card.inDate : new Date().toISOString()).slice(0, 10);
    const past = days.filter((day) => day < cutoff);
    if (past.length) facts.push([card.leak ? "Last seen" : "Previous visit", `${esc(daysAgo(`${past[past.length - 1]}T00:00:00Z`))} <small>${esc(dayUTC(`${past[past.length - 1]}T00:00:00Z`))}</small>`]);
    facts.push(["First seen", esc(dayUTC(`${days[0]}T00:00:00Z`))]);
    facts.push(["Shop visits", `${runs.toLocaleString()} <small>${days.length.toLocaleString()} days total</small>`]);
  } else if (viewer.loading) {
    facts.push(["Shop history", `<span class="muted">Loading…</span>`]);
  } else if (piece.category === "br" && !card.leak && !card.catalog) {
    facts.push(["Shop history", "First time in the shop"]);
  } else if (card.catalog && !viewer.loading && !(Array.isArray(history) && history.length)) {
    facts.push(["Shop history", "Not in the item shop yet"]);
  }
  if (raw.added) facts.push(["Added to files", esc(dayUTC(raw.added))]);
  if (raw.set?.value) facts.push(["Set", esc(raw.set.value)]);
  if (raw.introduction?.text) facts.push(["Introduced", esc(raw.introduction.text.replace(/^Introduced in /, "").replace(/\.$/, ""))]);
  if (piece.category === "tracks") {
    if (raw.artist) facts.push(["Artist", esc(raw.artist)]);
    if (raw.releaseYear) facts.push(["Year", esc(raw.releaseYear)]);
    if (raw.bpm) facts.push(["BPM", esc(raw.bpm)]);
  }

  const priceLine = card.price != null && !card.leak
    ? `<p class="viewer-price">${priceHtml(card.price)}${card.regularPrice && card.regularPrice > card.price ? `<s>${esc(Number(card.regularPrice).toLocaleString())}</s>` : ""}</p>`
    : "";

  const bundle = (card.pieces || []).length > 1
    ? `<div class="viewer-bundle">
        <p class="eyebrow">${esc(card.bundleName || "In this bundle")}</p>
        <div class="bundle-list">${card.pieces.map((part, index) => {
          const url = safeUrl(part.image);
          return `<button type="button" class="bundle-item" data-piece="${index}" aria-pressed="${index === viewer.pieceIndex ? "true" : "false"}" style="--c1:${(part.colors || FALLBACK_COLORS)[0]};--c2:${(part.colors || FALLBACK_COLORS)[1]}">
            ${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : ""}
            <span>${esc(part.name)}</span>
          </button>`;
        }).join("")}</div>
      </div>`
    : "";

  $("#viewer-info").innerHTML = `
    <p class="kicker">${esc([piece.type, raw.rarity?.displayValue, raw.series?.value].filter(Boolean).join(" · ") || "Item")}</p>
    <h2 id="viewer-name">${esc(name)}</h2>
    ${raw.description ? `<p class="viewer-desc">${esc(raw.description)}</p>` : ""}
    ${priceLine}
    <dl class="viewer-facts">${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`).join("")}</dl>
    ${bundle}
  `;
  bindImages($("#viewer-info"));
}

async function loadViewerDetails() {
  if (!viewer) return;
  const { piece } = viewerData();
  const target = viewer;
  const id = piece.category === "br" || piece.category === "lego" ? piece.id : "";
  if (!id) {
    viewer.details = null;
    viewer.loading = false;
    renderViewer();
    return;
  }
  viewer.loading = true;
  renderViewer();
  const details = await fetchDetails(id);
  if (viewer !== target) return;
  viewer.details = details;
  viewer.loading = false;
  renderViewer();
}

function openViewer(key) {
  const card = cardStore.get(key);
  if (!card) return;
  viewer = { card, pieceIndex: 0, tab: "image", picks: [], details: null, loading: false, preferVideo: true };
  const dialog = $("#viewer");
  if (!dialog.open) dialog.showModal();
  const opened = viewer;
  loadGgIds().then(() => {
    if (viewer === opened) renderViewer();
  });
  loadViewerDetails();
}

function closeViewer() {
  const dialog = $("#viewer");
  if (dialog.open) dialog.close();
}

function onCardOpen(event) {
  const card = event.target.closest(".card[data-key]");
  if (!card) return;
  if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openViewer(card.dataset.key);
}

function resetLabel() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const ms = Math.max(0, next - now.getTime());
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `Shop resets in ${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function tickClock() {
  const clock = $("#reset-clock");
  if (clock) clock.textContent = resetLabel();
  for (const badge of document.querySelectorAll(".timer[data-out]")) {
    const left = timeLeft(badge.dataset.out, true);
    if (left) badge.textContent = left;
    else badge.remove();
  }
  for (const full of document.querySelectorAll("[data-out-full]")) {
    full.textContent = timeLeft(full.dataset.outFull) || "Leaving now";
  }
}

function watchSections() {
  const links = [...document.querySelectorAll("nav a")];
  const sections = ["account", "shop", "cosmetics", "leaks", "news"].map((id) => document.getElementById(id));
  let queued = false;
  const update = () => {
    queued = false;
    const line = window.innerHeight * 0.35;
    let current = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= line) current = section;
    }
    for (const link of links) {
      if (link.getAttribute("href") === `#${current.id}`) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };
  window.addEventListener("scroll", () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }, { passive: true });
  window.addEventListener("resize", update);
  update();
}

$("#shop-chips").addEventListener("click", (event) => {
  const button = event.target.closest(".chip");
  if (!button) return;
  shopBucket = button.dataset.bucket || "all";
  for (const chip of $("#shop-chips").querySelectorAll(".chip")) {
    chip.setAttribute("aria-pressed", chip === button ? "true" : "false");
  }
  applyShopFilter();
});

let shopFilterFrame = 0;
$("#shop-search").addEventListener("input", () => {
  cancelAnimationFrame(shopFilterFrame);
  shopFilterFrame = requestAnimationFrame(applyShopFilter);
});

$("#leak-chips").addEventListener("click", (event) => {
  const button = event.target.closest(".chip");
  if (!button) return;
  leakMode = button.dataset.mode || "all";
  for (const chip of $("#leak-chips").querySelectorAll(".chip")) {
    chip.setAttribute("aria-pressed", chip === button ? "true" : "false");
  }
  applyLeakFilter();
});

let leakFilterFrame = 0;
$("#leak-search").addEventListener("input", () => {
  cancelAnimationFrame(leakFilterFrame);
  leakFilterFrame = requestAnimationFrame(applyLeakFilter);
});

$("#cos-chips")?.addEventListener("click", (event) => {
  const button = event.target.closest(".chip");
  if (!button) return;
  cosBucket = button.dataset.bucket || "all";
  for (const chip of $("#cos-chips").querySelectorAll(".chip")) {
    chip.setAttribute("aria-pressed", chip === button ? "true" : "false");
  }
  applyCosmeticsFilter();
});

let cosFilterFrame = 0;
$("#cos-search")?.addEventListener("input", () => {
  cancelAnimationFrame(cosFilterFrame);
  cosFilterFrame = requestAnimationFrame(() => applyCosmeticsFilter());
});

for (const root of [$("#shop-root"), $("#cos-root"), $("#leak-root")]) {
  if (!root) continue;
  root.addEventListener("click", onCardOpen);
  root.addEventListener("keydown", onCardOpen);
}

$("#viewer-close").addEventListener("click", closeViewer);

$("#viewer").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeViewer();
});

$("#viewer").addEventListener("close", () => {
  viewer = null;
  $("#viewer-stage").innerHTML = "";
});

$("#viewer-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-tab]");
  if (!button || !viewer) return;
  viewer.tab = button.dataset.tab;
  viewer.preferVideo = false;
  renderViewer();
});

$("#viewer-styles").addEventListener("click", (event) => {
  const button = event.target.closest("[data-pick]");
  if (!button || !viewer) return;
  const group = Number(button.dataset.group) || 0;
  if (!viewer.picks) viewer.picks = [];
  viewer.picks[group] = Number(button.dataset.pick) || 1;
  renderViewer();
});

$("#viewer-info").addEventListener("click", (event) => {
  const button = event.target.closest("[data-piece]");
  if (!button || !viewer) return;
  viewer.pieceIndex = Number(button.dataset.piece) || 0;
  viewer.tab = "image";
  viewer.preferVideo = true;
  viewer.picks = [];
  viewer.details = null;
  loadViewerDetails();
});

renderTicket();
tickClock();
setInterval(tickClock, 30000);
watchSections();
const cosSection = document.getElementById("cosmetics");
if (cosSection && "IntersectionObserver" in window) {
  const cosObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      ensureCosmeticsLoad();
      cosObserver.disconnect();
    }
  }, { rootMargin: "200px" });
  cosObserver.observe(cosSection);
} else {
  ensureCosmeticsLoad();
}
window.addEventListener("hashchange", () => {
  if (location.hash === "#cosmetics") ensureCosmeticsLoad();
});
if (location.hash === "#cosmetics") ensureCosmeticsLoad();
loadShop();
loadLeaks();
loadNews();

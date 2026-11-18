(() => {
  "use strict";

  const CFG = window.GALLERY_CONFIG || {};
  const DEMO = !CFG.apiKey || !CFG.rootFolderId;
  const ROOT = DEMO ? "demo-root" : CFG.rootFolderId;
  const API = "https://www.googleapis.com/drive/v3/files";
  const FOLDER = "application/vnd.google-apps.folder";

  const $ = (id) => document.getElementById(id);
  const el = {
    hero: $("hero"), crumbs: $("crumbs"), toolbar: $("toolbar"),
    albumTitle: $("albumTitle"), albumMeta: $("albumMeta"), zipBtn: $("zipBtn"),
    folders: $("folders"), photos: $("photos"), status: $("status"), sort: $("sort"),
    lb: $("lightbox"), lbImg: $("lbImg"), lbName: $("lbName"), lbMeta: $("lbMeta"),
    lbCount: $("lbCount"), lbDownload: $("lbDownload"), lbClose: $("lbClose"),
    lbPrev: $("lbPrev"), lbNext: $("lbNext"), lbStage: $("lbStage"), lbSpinner: $("lbSpinner"),
    toast: $("toast"),
  };

  // Textos de la marca
  if (CFG.title) { $("brandTitle").textContent = CFG.title; $("heroTitle").textContent = CFG.title; document.title = `${CFG.title} · Galería`; }
  if (CFG.subtitle) $("heroSub").textContent = CFG.subtitle;

  // Orden recordado
  try { const s = localStorage.getItem("sort"); if (s) el.sort.value = s; } catch {}

  /* ---------------- Datos: Google Drive ---------------- */

  const cache = new Map();

  async function driveList(folderId) {
    const files = [];
    let pageToken = "";
    do {
      const p = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false and (mimeType = '${FOLDER}' or mimeType contains 'image/')`,
        key: CFG.apiKey,
        pageSize: "1000",
        orderBy: "folder,name_natural",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        fields: "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,size,thumbnailLink,imageMediaMetadata(width,height,time,rotation))",
      });
      if (pageToken) p.set("pageToken", pageToken);
      const r = await fetch(`${API}?${p}`);
      if (!r.ok) throw await apiError(r);
      const j = await r.json();
      files.push(...j.files);
      pageToken = j.nextPageToken || "";
    } while (pageToken);
    return files;
  }

  async function driveGet(id) {
    const p = new URLSearchParams({ key: CFG.apiKey, supportsAllDrives: "true", fields: "id,name,parents,createdTime,modifiedTime" });
    const r = await fetch(`${API}/${id}?${p}`);
    if (!r.ok) throw await apiError(r);
    return r.json();
  }

  async function apiError(r) {
    let msg = `Error ${r.status}`;
    try { const j = await r.json(); msg = j.error?.message || msg; } catch {}
    if (r.status === 404) msg = "No se encontró la carpeta. Revisa que esté compartida como «Cualquier persona con el enlace».";
    if (r.status === 403) msg = "Google rechazó la consulta (API key inválida o Drive API no habilitada).";
    return new Error(msg);
  }

  async function loadFolder(id) {
    if (cache.has(id)) return cache.get(id);
    const p = (async () => {
      const raw = DEMO ? await demoList(id) : await driveList(id);
      const folders = raw.filter((f) => f.mimeType === FOLDER);
      const photos = raw.filter((f) => f.mimeType !== FOLDER).map(normalizePhoto);
      return { folders, photos };
    })();
    cache.set(id, p);
    p.catch(() => cache.delete(id));
    return p;
  }

  async function loadMeta(id) {
    if (id === ROOT) return { id, name: CFG.title || "Inicio", parents: [] };
    return DEMO ? demoGet(id) : driveGet(id);
  }

  // Ruta desde la raíz hasta la carpeta actual
  async function pathTo(id) {
    const chain = [];
    let cur = id;
    for (let i = 0; i < 12 && cur && cur !== ROOT; i++) {
      const m = await loadMeta(cur);
      chain.unshift(m);
      cur = m.parents?.[0];
    }
    return chain;
  }

  function normalizePhoto(f) {
    const m = f.imageMediaMetadata || {};
    let w = m.width, h = m.height;
    if (m.rotation === 1 || m.rotation === 3) [w, h] = [h, w];
    return {
      id: f.id, name: f.name, size: Number(f.size) || 0, w, h,
      date: parseExif(m.time) || new Date(f.createdTime),
      thumb: f.thumbUrl || thumbUrl(f, 800),
      full: f.fullUrl || thumbUrl(f, 2048),
      fallback: f.thumbUrl ? null : `https://drive.google.com/thumbnail?id=${f.id}&sz=w1000`,
      download: f.downloadUrl || `${API}/${f.id}?alt=media&key=${CFG.apiKey}`,
    };
  }

  function thumbUrl(f, size) {
    if (f.thumbnailLink) return f.thumbnailLink.replace(/=s\d+$/, `=s${size}`);
    return `https://lh3.googleusercontent.com/d/${f.id}=w${size}`;
  }

  function parseExif(t) {
    if (!t) return null;
    const m = t.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const d = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return isNaN(d) ? null : d;
  }

  /* ---------------- Formato ---------------- */

  const fmtDate = (d) => d.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
  const fmtSize = (b) => (!b ? "" : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function sortItems(arr, dateOf) {
    const mode = el.sort.value;
    const a = [...arr];
    if (mode === "name") a.sort((x, y) => x.name.localeCompare(y.name, "es", { numeric: true }));
    else a.sort((x, y) => (mode === "new" ? 1 : -1) * (dateOf(y) - dateOf(x)));
    return a;
  }

  /* ---------------- Render ---------------- */

  let renderToken = 0;
  let current = { photos: [] };

  async function render() {
    const token = ++renderToken;
    const id = location.hash.match(/^#\/f\/([\w-]+)/)?.[1] || ROOT;
    const isRoot = id === ROOT;

    el.hero.hidden = !isRoot;
    el.folders.innerHTML = Array.from({ length: isRoot ? 6 : 3 }, () => '<div class="skeleton"></div>').join("");
    el.photos.innerHTML = "";
    el.status.innerHTML = "";
    el.toolbar.hidden = true;
    el.crumbs.innerHTML = "";

    try {
      const [data, chain] = await Promise.all([loadFolder(id), isRoot ? [] : pathTo(id)]);
      if (token !== renderToken) return;

      // Migas de pan
      if (!isRoot) {
        el.crumbs.innerHTML = [`<a href="#/">Inicio</a>`]
          .concat(chain.map((c, i) => i === chain.length - 1
            ? `<span class="current">${esc(c.name)}</span>`
            : `<a href="#/f/${c.id}">${esc(c.name)}</a>`))
          .join('<span class="sep">›</span>');
      }

      const here = chain[chain.length - 1];
      const folderDate = (f) => new Date(f.createdTime);
      const folders = sortItems(data.folders, folderDate);
      const photos = sortItems(data.photos, (p) => p.date);
      current = { id, name: here?.name || CFG.title || "galeria", photos };

      // Barra del álbum
      if (!isRoot || photos.length) {
        el.toolbar.hidden = false;
        el.albumTitle.textContent = isRoot ? "Fotos" : here.name;
        const bits = [];
        if (folders.length) bits.push(plural(folders.length, "álbum", "álbumes"));
        if (photos.length) bits.push(plural(photos.length, "foto", "fotos"));
        if (here?.createdTime) bits.push(fmtDate(new Date(here.createdTime)));
        el.albumMeta.textContent = bits.join(" · ");
        el.zipBtn.hidden = photos.length < 2;
      }

      renderFolders(folders, token);
      renderPhotos(photos);

      if (!folders.length && !photos.length) el.status.textContent = "Este álbum todavía no tiene fotos.";
      if (DEMO && isRoot) el.status.innerHTML = '<div class="demo-banner">Modo demo: fotos de ejemplo. Al conectar tu Google Drive aparecerán tus álbumes reales.</div>';
    } catch (e) {
      if (token !== renderToken) return;
      el.folders.innerHTML = "";
      el.status.innerHTML = `<p class="err">No se pudo cargar la galería.</p><p>${esc(e.message)}</p>`;
    }
  }

  function renderFolders(folders, token) {
    el.folders.innerHTML = folders.map((f) => `
      <a class="album" href="#/f/${f.id}" data-id="${f.id}">
        <div class="album-cover">
          <div class="placeholder"><img src="assets/escudo.png" alt=""></div>
          <span class="album-badge" hidden></span>
        </div>
        <div class="album-body">
          <h3 class="album-name">${esc(f.name)}</h3>
          <div class="album-date">${fmtDate(new Date(f.createdTime))}</div>
        </div>
      </a>`).join("");

    // Portada y cantidad de cada álbum (en segundo plano)
    folders.forEach(async (f) => {
      try {
        const d = await loadFolder(f.id);
        if (token !== renderToken) return;
        const card = el.folders.querySelector(`[data-id="${f.id}"]`);
        if (!card) return;
        const badge = card.querySelector(".album-badge");
        const parts = [];
        if (d.folders.length) parts.push(plural(d.folders.length, "álbum", "álbumes"));
        if (d.photos.length) parts.push(plural(d.photos.length, "foto", "fotos"));
        if (parts.length) { badge.textContent = parts.join(" · "); badge.hidden = false; }
        const cover = d.photos[0] || (await firstPhotoDeep(d.folders));
        if (cover && token === renderToken) {
          const img = new Image();
          img.alt = "";
          img.onload = () => card.querySelector(".placeholder")?.replaceWith(img);
          img.onerror = () => { if (cover.fallback && img.src !== cover.fallback) img.src = cover.fallback; };
          img.src = cover.thumb;
        }
      } catch {}
    });
  }

  async function firstPhotoDeep(folders) {
    for (const sf of folders.slice(0, 3)) {
      const d = await loadFolder(sf.id);
      if (d.photos[0]) return d.photos[0];
    }
    return null;
  }

  function renderPhotos(photos) {
    el.photos.innerHTML = photos.map((p, i) => `
      <figure class="photo" data-i="${i}" ${p.w && p.h ? `style="aspect-ratio:${p.w}/${p.h}"` : ""}>
        <img src="${esc(p.thumb)}" alt="${esc(p.name)}" loading="lazy" ${p.w ? `width="${p.w}" height="${p.h}"` : ""}>
        <figcaption class="photo-overlay">
          <span>${fmtDate(p.date)}</span>
          <button class="dl-mini" data-dl="${i}" aria-label="Descargar ${esc(p.name)}">
            <svg viewBox="0 0 24 24"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16"/></svg>
          </button>
        </figcaption>
      </figure>`).join("");

    el.photos.querySelectorAll("img").forEach((img, i) => {
      const done = () => { img.classList.add("loaded"); img.parentElement.style.aspectRatio = ""; };
      if (img.complete && img.naturalWidth) done();
      img.addEventListener("load", done);
      img.addEventListener("error", () => {
        const fb = photos[i].fallback;
        if (fb && img.src !== fb) img.src = fb;
      });
    });
  }

  el.photos.addEventListener("click", (e) => {
    const dl = e.target.closest("[data-dl]");
    if (dl) { e.stopPropagation(); downloadPhoto(current.photos[+dl.dataset.dl]); return; }
    const fig = e.target.closest(".photo");
    if (fig) openLightbox(+fig.dataset.i);
  });

  el.sort.addEventListener("change", () => {
    try { localStorage.setItem("sort", el.sort.value); } catch {}
    render();
  });

  /* ---------------- Visor ---------------- */

  let lbIndex = 0;

  function openLightbox(i) {
    el.lb.hidden = false;
    document.body.style.overflow = "hidden";
    showPhoto(i);
    el.lbClose.focus();
  }

  function closeLightbox() {
    el.lb.hidden = true;
    document.body.style.overflow = "";
    el.lbImg.removeAttribute("src");
  }

  function showPhoto(i) {
    const list = current.photos;
    if (!list.length) return;
    lbIndex = Math.max(0, Math.min(list.length - 1, i));
    const p = list[lbIndex];
    el.lbSpinner.hidden = false;
    el.lbImg.style.opacity = "0.25";
    el.lbImg.onload = () => { el.lbSpinner.hidden = true; el.lbImg.style.opacity = "1"; };
    el.lbImg.onerror = () => { if (p.fallback && el.lbImg.src !== p.fallback) el.lbImg.src = p.fallback; else el.lbSpinner.hidden = true; };
    el.lbImg.src = p.full;
    el.lbImg.alt = p.name;
    el.lbName.textContent = p.name;
    el.lbMeta.textContent = [fmtDate(p.date), p.w && p.h ? `${p.w}×${p.h}` : "", fmtSize(p.size)].filter(Boolean).join(" · ");
    el.lbCount.textContent = `${lbIndex + 1} / ${list.length}`;
    el.lbPrev.disabled = lbIndex === 0;
    el.lbNext.disabled = lbIndex === list.length - 1;
    // Precarga de la siguiente
    const next = list[lbIndex + 1];
    if (next) new Image().src = next.full;
  }

  el.lbClose.addEventListener("click", closeLightbox);
  el.lbPrev.addEventListener("click", () => showPhoto(lbIndex - 1));
  el.lbNext.addEventListener("click", () => showPhoto(lbIndex + 1));
  el.lbDownload.addEventListener("click", (e) => { e.preventDefault(); downloadPhoto(current.photos[lbIndex]); });
  el.lbStage.addEventListener("click", (e) => { if (e.target === el.lbStage) closeLightbox(); });

  document.addEventListener("keydown", (e) => {
    if (el.lb.hidden) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") showPhoto(lbIndex - 1);
    else if (e.key === "ArrowRight") showPhoto(lbIndex + 1);
  });

  let touchX = null;
  el.lbStage.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  el.lbStage.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) showPhoto(lbIndex + (dx < 0 ? 1 : -1));
  });

  /* ---------------- Descargas ---------------- */

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function fetchBlob(p) {
    const r = await fetch(p.download);
    if (!r.ok) throw new Error(`Error ${r.status}`);
    return r.blob();
  }

  async function downloadPhoto(p) {
    if (!p) return;
    toast(`Descargando ${p.name}…`);
    try {
      saveBlob(await fetchBlob(p), p.name);
      toast(null);
    } catch {
      // Respaldo: descarga directa de Drive
      if (!DEMO) window.open(`https://drive.google.com/uc?export=download&id=${p.id}`, "_blank");
      toast(null);
    }
  }

  el.zipBtn.addEventListener("click", async () => {
    if (!window.JSZip) return toast("No se pudo preparar el .zip", 3000);
    const list = current.photos;
    const label = el.zipBtn.querySelector("span");
    el.zipBtn.disabled = true;
    const zip = new JSZip();
    const used = new Set();
    let done = 0, failed = 0;
    const queue = [...list];
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift();
        try {
          let name = p.name;
          for (let n = 2; used.has(name); n++) name = p.name.replace(/(\.\w+)?$/, ` (${n})$1`);
          used.add(name);
          zip.file(name, await fetchBlob(p));
        } catch { failed++; }
        label.textContent = `Preparando ${++done}/${list.length}`;
      }
    };
    try {
      await Promise.all(Array.from({ length: 4 }, worker));
      label.textContent = "Comprimiendo…";
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      saveBlob(blob, `${current.name.replace(/[\\/:*?"<>|]/g, "_")}.zip`);
      if (failed) toast(`${failed} foto(s) no se pudieron incluir`, 4000);
    } catch {
      toast("No se pudo crear el .zip", 3000);
    } finally {
      el.zipBtn.disabled = false;
      label.textContent = "Descargar álbum";
    }
  });

  let toastTimer;
  function toast(msg, ms) {
    clearTimeout(toastTimer);
    if (!msg) { el.toast.hidden = true; return; }
    el.toast.textContent = msg;
    el.toast.hidden = false;
    if (ms) toastTimer = setTimeout(() => (el.toast.hidden = true), ms);
  }

  /* ---------------- Modo demo ---------------- */

  const DEMO_TREE = {
    "demo-root": [
      { id: "d-fecha8", name: "Fecha 8 vs Los Toros", createdTime: "2026-11-09T18:00:00Z", photos: [[1011, 3, 2], [1025, 2, 3], [1035, 3, 2], [1043, 3, 2], [1050, 2, 3], [1062, 3, 2], [1069, 3, 2], [1074, 2, 3]] },
      { id: "d-entren", name: "Entrenamientos", createdTime: "2026-10-22T18:00:00Z", sub: ["d-entren-oct", "d-entren-nov"] },
      { id: "d-camiseta", name: "Presentación camiseta 2026", createdTime: "2026-03-14T18:00:00Z", photos: [[1005, 2, 3], [1012, 3, 2], [1027, 2, 3], [1039, 3, 2], [1045, 3, 2], [1059, 2, 3]] },
      { id: "d-cena", name: "Cena de fin de año", createdTime: "2025-12-18T18:00:00Z", photos: [[1015, 3, 2], [1016, 3, 2], [1018, 3, 2], [1019, 2, 3], [1020, 3, 2]] },
    ],
    "d-entren": [
      { id: "d-entren-nov", name: "Noviembre", createdTime: "2026-11-02T18:00:00Z", photos: [[1036, 3, 2], [1037, 2, 3], [1038, 3, 2], [1040, 3, 2]] },
      { id: "d-entren-oct", name: "Octubre", createdTime: "2026-10-05T18:00:00Z", photos: [[1041, 3, 2], [1042, 2, 3], [1044, 3, 2]] },
    ],
  };
  const DEMO_INDEX = {};
  Object.entries(DEMO_TREE).forEach(([parent, kids]) => kids.forEach((k) => (DEMO_INDEX[k.id] = { ...k, parents: [parent] })));

  async function demoList(id) {
    await new Promise((r) => setTimeout(r, 250));
    const out = (DEMO_TREE[id] || []).map((f) => ({ id: f.id, name: f.name, createdTime: f.createdTime, mimeType: FOLDER }));
    const node = DEMO_INDEX[id];
    (node?.photos || []).forEach(([pid, rw, rh], i) => {
      const w = rw * 600, h = rh * 600;
      const t = new Date(new Date(node.createdTime).getTime() + i * 7 * 60000);
      out.push({
        id: `${id}-${pid}`, name: `IMG_${String(4200 + pid).padStart(4, "0")}.jpg`, mimeType: "image/jpeg",
        createdTime: t.toISOString(), size: String(2.4e6 + (pid % 7) * 3e5), imageMediaMetadata: { width: w, height: h },
        thumbUrl: `https://picsum.photos/id/${pid}/${rw * 300}/${rh * 300}`,
        fullUrl: `https://picsum.photos/id/${pid}/${w}/${h}`,
        downloadUrl: `https://picsum.photos/id/${pid}/${w}/${h}`,
      });
    });
    return out;
  }

  async function demoGet(id) {
    const n = DEMO_INDEX[id];
    if (!n) throw new Error("Álbum no encontrado.");
    return { id, name: n.name, parents: n.parents, createdTime: n.createdTime };
  }

  window.addEventListener("hashchange", () => { closeLightbox(); render(); window.scrollTo(0, 0); });
  render();
})();

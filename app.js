(() => {
  "use strict";

  const CFG = window.GALLERY_CONFIG || {};
  const DEMO = !CFG.apiKey || !CFG.rootFolderId;
  const ROOT = DEMO ? "demo-root" : CFG.rootFolderId;
  const API = "https://www.googleapis.com/drive/v3/files";
  const FOLDER = "application/vnd.google-apps.folder";
  const SHORTCUT = "application/vnd.google-apps.shortcut";
  const parentOf = new Map(); // carpeta -> carpeta desde la que se llegó (sirve para accesos directos)

  const $ = (id) => document.getElementById(id);
  const el = {
    hero: $("hero"), crumbs: $("crumbs"), toolbar: $("toolbar"),
    albumTitle: $("albumTitle"), albumMeta: $("albumMeta"), zipBtn: $("zipBtn"),
    folders: $("folders"), photos: $("photos"), status: $("status"), sort: $("sort"),
    lb: $("lightbox"), lbImg: $("lbImg"), lbName: $("lbName"), lbMeta: $("lbMeta"),
    lbCount: $("lbCount"), lbDownload: $("lbDownload"), lbClose: $("lbClose"),
    lbPrev: $("lbPrev"), lbNext: $("lbNext"), lbStage: $("lbStage"), lbSpinner: $("lbSpinner"),
    toast: $("toast"), selectBtn: $("selectBtn"), selBar: $("selBar"), selCount: $("selCount"),
    selGo: $("selGo"), selCancel: $("selCancel"), toTop: $("toTop"),
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
        q: `'${folderId}' in parents and trashed = false and (mimeType = '${FOLDER}' or mimeType = '${SHORTCUT}' or mimeType contains 'image/')`,
        key: CFG.apiKey,
        pageSize: "1000",
        orderBy: "folder,name_natural",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        fields: "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,size,thumbnailLink,imageMediaMetadata(width,height,time,rotation),shortcutDetails)",
      });
      if (pageToken) p.set("pageToken", pageToken);
      const r = await fetch(`${API}?${p}`);
      if (!r.ok) throw await apiError(r);
      const j = await r.json();
      for (const f of j.files) {
        if (f.mimeType !== SHORTCUT) { files.push(f); continue; }
        // Acceso directo a una carpeta: se trata como carpeta normal
        const t = f.shortcutDetails || {};
        if (t.targetMimeType === FOLDER) files.push({ ...f, id: t.targetId, mimeType: FOLDER });
      }
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
      folders.forEach((f) => parentOf.set(f.id, { id, name: f.name }));
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
      let m;
      try { m = await loadMeta(cur); } catch (e) { if (i === 0) throw e; break; }
      const via = parentOf.get(cur);
      if (via) m = { ...m, name: via.name, parents: [via.id] };
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
    if (selecting) setSelecting(false);
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
        el.selectBtn.hidden = !photos.length;
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
        if (!d.folders.length && !d.photos.length) { card.remove(); return; }
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
    const fig = e.target.closest(".photo");
    if (!fig) return;
    if (selecting) { toggleSel(+fig.dataset.i, fig); return; }
    if (dl) {
      e.stopPropagation();
      // En iPhone se abre la foto y se prepara para "Guardar foto"
      if (CAN_SHARE) openLightbox(+dl.dataset.dl);
      downloadPhoto(current.photos[+dl.dataset.dl]);
      return;
    }
    openLightbox(+fig.dataset.i);
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
    if (!el.lbDownload.classList.contains("busy")) setLbBtn(prepared?.key === p.id ? "Guardar foto" : "Descargar");
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

  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const IS_TOUCH = matchMedia("(pointer: coarse)").matches;
  const CAN_SHARE = IS_IOS && (() => {
    try { return !!navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.jpg", { type: "image/jpeg" })] }); }
    catch { return false; }
  })();
  const MAX_TOUCH = 10;
  const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, "_");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (IS_TOUCH) el.zipBtn.remove();

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

  async function fetchAll(list, onProgress) {
    const out = new Array(list.length);
    let next = 0, done = 0, failed = 0;
    const worker = async () => {
      while (next < list.length) {
        const i = next++;
        try { out[i] = await fetchBlob(list[i]); } catch { failed++; }
        onProgress?.(++done, list.length);
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));
    return { blobs: out, failed };
  }

  // En iPhone se usa el menú "Compartir" (Guardar imagen, WhatsApp, Instagram…).
  // Safari exige que ese menú se abra con un toque directo, así que primero se
  // prepara la foto y después se toca "Guardar".
  let prepared = null; // { key, files }
  const toFile = (blob, name) => new File([blob], name, { type: blob.type || "image/jpeg" });

  async function shareFiles(files) {
    try { await navigator.share({ files }); }
    catch (e) { if (e.name !== "AbortError") files.forEach((f) => saveBlob(f, f.name)); }
  }

  function setLbBtn(text, busy = false) {
    el.lbDownload.querySelector("span").textContent = text;
    el.lbDownload.classList.toggle("busy", busy);
  }

  async function downloadPhoto(p) {
    if (!p) return;
    if (CAN_SHARE) {
      if (prepared?.key === p.id) {
        const files = prepared.files;
        prepared = null;
        setLbBtn("Descargar");
        return shareFiles(files);
      }
      setLbBtn("Preparando…", true);
      try {
        const file = toFile(await fetchBlob(p), p.name);
        prepared = { key: p.id, files: [file] };
        if (current.photos[lbIndex]?.id === p.id) setLbBtn("Guardar foto");
        toast("Lista: tocá «Guardar foto»", 2500);
      } catch {
        setLbBtn("Descargar");
        toast("No se pudo descargar la foto", 3000);
      }
      return;
    }
    toast(`Descargando ${p.name}…`);
    try {
      saveBlob(await fetchBlob(p), p.name);
      toast(null);
    } catch {
      if (!DEMO) window.open(`https://drive.google.com/uc?export=download&id=${p.id}`, "_blank");
      toast(null);
    }
  }

  async function zipAndSave(list, name, setLabel) {
    if (!window.JSZip) return toast("No se pudo preparar el .zip", 3000);
    const { blobs, failed } = await fetchAll(list, (d, t) => setLabel(`Preparando ${d}/${t}`));
    setLabel("Comprimiendo…");
    const zip = new JSZip();
    const used = new Set();
    list.forEach((p, i) => {
      if (!blobs[i]) return;
      let n = p.name;
      for (let k = 2; used.has(n); k++) n = p.name.replace(/(\.\w+)?$/, ` (${k})$1`);
      used.add(n);
      zip.file(n, blobs[i]);
    });
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    saveBlob(blob, `${safeName(name)}.zip`);
    if (failed) toast(`${failed} foto(s) no se pudieron incluir`, 4000);
  }

  el.zipBtn.addEventListener("click", async () => {
    const label = el.zipBtn.querySelector("span");
    el.zipBtn.disabled = true;
    try { await zipAndSave(current.photos, current.name, (t) => (label.textContent = t)); }
    catch { toast("No se pudo crear el .zip", 3000); }
    finally { el.zipBtn.disabled = false; label.textContent = "Descargar álbum"; }
  });

  /* ---------------- Selección de varias fotos ---------------- */

  let selecting = false;
  const selected = new Set();
  const selKey = () => "sel:" + [...selected].sort((a, b) => a - b).join(",");

  function setSelecting(on) {
    selecting = on;
    selected.clear();
    prepared = null;
    document.body.classList.toggle("selecting", on);
    el.photos.querySelectorAll(".photo.sel").forEach((f) => f.classList.remove("sel"));
    el.selectBtn.querySelector("span").textContent = on ? "Cancelar" : "Seleccionar";
    updateSelBar();
  }

  function toggleSel(i, fig) {
    if (selected.has(i)) selected.delete(i);
    else {
      if (IS_TOUCH && selected.size >= MAX_TOUCH) return toast(`Podés elegir hasta ${MAX_TOUCH} fotos por vez`, 2500);
      selected.add(i);
    }
    fig.classList.toggle("sel", selected.has(i));
    prepared = null;
    updateSelBar();
  }

  function updateSelBar() {
    el.selBar.hidden = !selecting;
    el.selCount.textContent = selected.size
      ? plural(selected.size, "foto elegida", "fotos elegidas")
      : IS_TOUCH ? `Tocá las fotos (hasta ${MAX_TOUCH})` : "Hacé clic en las fotos";
    el.selGo.disabled = !selected.size;
    el.selGo.querySelector("span").textContent =
      prepared?.key === selKey() ? `Guardar ${selected.size}` : "Descargar";
  }

  el.selectBtn.addEventListener("click", () => setSelecting(!selecting));
  el.selCancel.addEventListener("click", () => setSelecting(false));

  el.selGo.addEventListener("click", async () => {
    const list = [...selected].sort((a, b) => a - b).map((i) => current.photos[i]);
    if (!list.length) return;
    const label = el.selGo.querySelector("span");

    if (CAN_SHARE && prepared?.key === selKey()) {
      const files = prepared.files;
      prepared = null;
      await shareFiles(files);
      setSelecting(false);
      return;
    }

    el.selGo.disabled = true;
    try {
      if (CAN_SHARE) {
        const { blobs, failed } = await fetchAll(list, (d, t) => (label.textContent = `Preparando ${d}/${t}`));
        const files = list.map((p, i) => blobs[i] && toFile(blobs[i], p.name)).filter(Boolean);
        if (!files.length) throw new Error();
        prepared = { key: selKey(), files };
        toast(failed ? `${failed} no se pudieron bajar. Tocá «Guardar»` : "Listas: tocá «Guardar»", 3000);
        el.selGo.disabled = false;
        updateSelBar();
        return;
      }
      if (IS_TOUCH || list.length === 1) {
        for (let i = 0; i < list.length; i++) {
          label.textContent = `Descargando ${i + 1}/${list.length}`;
          try { saveBlob(await fetchBlob(list[i]), list[i].name); } catch {}
          await sleep(350);
        }
      } else {
        await zipAndSave(list, `${current.name} (selección)`, (t) => (label.textContent = t));
      }
      setSelecting(false);
    } catch {
      toast("No se pudieron descargar las fotos", 3000);
      el.selGo.disabled = false;
      updateSelBar();
    }
  });

  /* ---------------- Volver arriba ---------------- */

  const onScroll = () => el.toTop.classList.toggle("show", window.scrollY > 900);
  window.addEventListener("scroll", onScroll, { passive: true });
  el.toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

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

  window.addEventListener("hashchange", () => { closeLightbox(); setSelecting(false); render(); window.scrollTo(0, 0); });
  render();
})();

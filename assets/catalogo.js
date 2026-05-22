import { collection, getFirestore, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { ARTICULOS_COLLECTION, getFirebaseApp, startAnalytics } from "./firebase-config.js";

const app = getFirebaseApp();
const db = getFirestore(app);

startAnalytics(app);

const grid = document.querySelector("[data-products-grid]");
const source = document.querySelector("[data-products-source]");
const fallbackHtml = grid ? grid.innerHTML : "";

if (grid) {
  onSnapshot(
    collection(db, ARTICULOS_COLLECTION),
    (snapshot) => {
      const articles = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((article) => article.visible !== false)
        .sort(sortArticles);

      if (!articles.length) {
        grid.innerHTML = fallbackHtml;
        window.WhiskerWorks3D?.bindLightbox(grid);
        return;
      }

      grid.innerHTML = articles.map(renderArticle).join("");
      window.WhiskerWorks3D?.bindLightbox(grid);
    },
    (error) => {
      grid.innerHTML = fallbackHtml;
      window.WhiskerWorks3D?.bindLightbox(grid);
    }
  );
}

function sortArticles(a, b) {
  const orderA = Number.isFinite(Number(a.orden)) ? Number(a.orden) : 0;
  const orderB = Number.isFinite(Number(b.orden)) ? Number(b.orden) : 0;

  if (orderA !== orderB) {
    return orderA - orderB;
  }

  const dateA = getMillis(a.createdAt);
  const dateB = getMillis(b.createdAt);
  return dateB - dateA;
}

function getMillis(value) {
  if (!value) {
    return 0;
  }

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.seconds === "number") {
    return value.seconds * 1000;
  }

  return 0;
}

function renderArticle(article) {
  const images = normalizeImages(article.imagenes || article.images || []);
  const galleryClass = images.length > 1 ? "product-gallery" : "product-gallery single";
  const imageMarkup = images.length
    ? images.slice(0, 4).map((image, index) => `
        <img src="${escapeAttr(image.url)}" alt="${escapeAttr(article.nombre || `Articulo ${index + 1}`)}" loading="lazy">
      `).join("")
    : `<img src="assets/logo.png" alt="${escapeAttr(article.nombre || "Articulo")}" loading="lazy">`;

  const detail = article.detalle ? `<p class="product-detail">${escapeHtml(article.detalle)}</p>` : "";
  const category = article.categoria ? `<span class="tag">${escapeHtml(article.categoria)}</span>` : "";
  const colors = Array.isArray(article.colores) && article.colores.length
    ? `<div class="color-list">${article.colores.map((color) => `<span>${escapeHtml(color)}</span>`).join("")}</div>`
    : "";

  return `
    <article class="producto">
      <div class="${galleryClass}">
        ${imageMarkup}
      </div>
      <div class="product-body">
        <h3>${escapeHtml(article.nombre || "Articulo sin nombre")}</h3>
        <p class="product-description">${escapeHtml(article.descripcion || "Impresion 3D personalizada.")}</p>
        ${detail}
        ${colors}
        <div class="product-footer">
          <span class="price">${formatPrice(article)}</span>
          ${category}
        </div>
      </div>
    </article>
  `;
}

function normalizeImages(images) {
  return images
    .map((image) => (typeof image === "string" ? { url: image } : image))
    .filter((image) => image && image.url);
}

function formatPrice(article) {
  if (article.precioTexto) {
    return escapeHtml(article.precioTexto);
  }

  const price = Number(article.precio);
  if (!Number.isFinite(price)) {
    return "Consultar";
  }

  const formatted = new Intl.NumberFormat("es-BO", {
    maximumFractionDigits: price % 1 === 0 ? 0 : 2
  }).format(price);

  return `${formatted} ${escapeHtml(article.moneda || "Bs")}`;
}

function setSource(text) {
  if (source) {
    source.textContent = text;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

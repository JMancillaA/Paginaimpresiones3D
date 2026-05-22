import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import {
  ARTICULOS_COLLECTION,
  getFirebaseApp,
  startAnalytics
} from "./firebase-config.js";

// Usa la misma lista que pongas en las reglas de Firestore.
const ADMIN_EMAILS = ["alf.fredo.96@gmail.com", "cinsaro4@gmail.com","manjoaquin_03@hotmail.com"];
const MAX_IMAGES = 4;
const MAX_ORIGINAL_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_DATA_URL_CHARS = 95 * 1024;
const MAX_TOTAL_IMAGE_DATA_URL_CHARS = MAX_IMAGE_DATA_URL_CHARS * MAX_IMAGES;
const MAX_ARTICLES = 24;
const INITIAL_IMAGE_SIDE = 900;
const IMAGE_OUTPUT_TYPE = "image/jpeg";
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const app = getFirebaseApp();
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

provider.setCustomParameters({ prompt: "select_account" });
startAnalytics(app);
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("No se pudo fijar persistencia local de Auth.", error);
});

let unsubscribeArticles = null;
let articles = [];
let editingId = null;
let previewUrls = [];

const els = {
  authView: document.getElementById("auth-view"),
  adminPanel: document.getElementById("admin-panel"),
  signIn: document.getElementById("google-signin"),
  signOut: document.getElementById("signout"),
  authStatus: document.getElementById("auth-status"),
  adminStatus: document.getElementById("admin-status"),
  userChip: document.getElementById("admin-user"),
  form: document.getElementById("article-form"),
  formTitle: document.getElementById("form-title"),
  editId: document.getElementById("edit-id"),
  nombre: document.getElementById("articulo-nombre"),
  categoria: document.getElementById("articulo-categoria"),
  precio: document.getElementById("articulo-precio"),
  descripcion: document.getElementById("articulo-descripcion"),
  detalle: document.getElementById("articulo-detalle"),
  colores: document.getElementById("articulo-colores"),
  orden: document.getElementById("articulo-orden"),
  visible: document.getElementById("articulo-visible"),
  destacado: document.getElementById("articulo-destacado"),
  imagenes: document.getElementById("articulo-imagenes"),
  preview: document.getElementById("image-preview"),
  saveButton: document.getElementById("save-button"),
  resetButton: document.getElementById("reset-button"),
  articleList: document.getElementById("article-list")
};

els.signIn.addEventListener("click", startGoogleSignIn);

els.signOut.addEventListener("click", async () => {
  await signOut(auth);
});

els.form.addEventListener("submit", saveArticle);
els.resetButton.addEventListener("click", resetForm);
els.imagenes.addEventListener("change", handleImageSelection);
els.articleList.addEventListener("click", handleListAction);

getRedirectResult(auth).catch((error) => {
  setAuthStatus(readableError(error), "error");
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showSignedOut();
    return;
  }

  if (!isAdmin(user)) {
    showSignedOut();
    setAuthStatus(`La cuenta ${user.email} no esta autorizada para administrar articulos.`, "error");
    await signOut(auth);
    return;
  }

  showSignedIn(user);
});

async function startGoogleSignIn() {
  if (location.protocol === "file:") {
    setAuthStatus("Abre admin.html desde http://localhost o desde tu dominio publicado. Firebase Auth no funciona bien desde file://.", "error");
    return;
  }

  els.signIn.disabled = true;
  setAuthStatus("Abriendo acceso con Google...");

  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (shouldTryRedirect(error)) {
      setAuthStatus("El popup no se pudo abrir. Redirigiendo a Google...");
      try {
        await signInWithRedirect(auth, provider);
      } catch (redirectError) {
        setAuthStatus(readableError(redirectError), "error");
      }
      return;
    }

    setAuthStatus(readableError(error), "error");
  } finally {
    els.signIn.disabled = false;
  }
}

function showSignedOut() {
  if (unsubscribeArticles) {
    unsubscribeArticles();
    unsubscribeArticles = null;
  }

  articles = [];
  editingId = null;
  els.authView.hidden = false;
  els.adminPanel.hidden = true;
  els.userChip.innerHTML = "";
  resetForm();
}

function showSignedIn(user) {
  els.authView.hidden = true;
  els.adminPanel.hidden = false;
  els.userChip.innerHTML = `
    <img src="${escapeAttr(user.photoURL || "assets/logo.png")}" alt="">
    <span>${escapeHtml(user.displayName || user.email)}</span>
  `;
  setAdminStatus("Listo para administrar articulos.", "ok");
  subscribeArticles();
}

function subscribeArticles() {
  if (unsubscribeArticles) {
    return;
  }

  unsubscribeArticles = onSnapshot(
    collection(db, ARTICULOS_COLLECTION),
    (snapshot) => {
      articles = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort(sortArticles);
      renderArticles();
    },
    (error) => {
      setAdminStatus(readableError(error), "error");
    }
  );
}

async function saveArticle(event) {
  event.preventDefault();

  const user = auth.currentUser;
  if (!user || !isAdmin(user)) {
    setAdminStatus("Inicia sesion con Google para guardar cambios.", "error");
    return;
  }

  const files = getSelectedFiles();
  const validation = validateFiles(files);
  if (!validation.ok) {
    setAdminStatus(validation.message, "error");
    return;
  }

  if (!editingId && !files.length) {
    setAdminStatus("Agrega al menos una imagen para publicar el articulo.", "error");
    return;
  }

  if (!editingId && articles.length >= MAX_ARTICLES) {
    setAdminStatus(`Limite preventivo alcanzado: maximo ${MAX_ARTICLES} articulos publicados en la nube.`, "error");
    return;
  }

  setBusy(true);

  try {
    const payload = readForm(user);

    if (editingId) {
      const currentArticle = articles.find((article) => article.id === editingId);
      let imagenes = normalizeImages(currentArticle?.imagenes || []);

      if (files.length) {
        setAdminStatus("Comprimiendo nuevas imagenes...");
        imagenes = await prepareImagesForFirestore(files);
      }

      await updateDoc(doc(db, ARTICULOS_COLLECTION, editingId), {
        ...payload,
        imagenes
      });

      setAdminStatus("Articulo actualizado correctamente.", "ok");
    } else {
      const articleRef = doc(collection(db, ARTICULOS_COLLECTION));
      setAdminStatus("Comprimiendo imagenes...");
      const imagenes = await prepareImagesForFirestore(files);

      await setDoc(articleRef, {
        ...payload,
        imagenes,
        createdAt: serverTimestamp(),
        createdBy: user.email
      });

      setAdminStatus("Articulo creado correctamente.", "ok");
    }

    resetForm();
  } catch (error) {
    setAdminStatus(readableError(error), "error");
  } finally {
    setBusy(false);
  }
}

async function handleListAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const article = articles.find((item) => item.id === button.dataset.id);
  if (!article) {
    return;
  }

  if (button.dataset.action === "edit") {
    editArticle(article);
  }

  if (button.dataset.action === "delete") {
    await removeArticle(article);
  }
}

function editArticle(article) {
  editingId = article.id;
  els.editId.value = article.id;
  els.formTitle.textContent = "Editar articulo";
  els.nombre.value = article.nombre || "";
  els.categoria.value = article.categoria || "";
  els.precio.value = typeof article.precio === "number" ? article.precio : "";
  els.descripcion.value = article.descripcion || "";
  els.detalle.value = article.detalle || "";
  els.colores.value = Array.isArray(article.colores) ? article.colores.join(", ") : "";
  els.orden.value = Number.isFinite(Number(article.orden)) ? Number(article.orden) : 0;
  els.visible.checked = article.visible !== false;
  els.destacado.checked = article.destacado === true;
  els.imagenes.value = "";
  els.saveButton.textContent = "Actualizar articulo";
  renderPreview(normalizeImages(article.imagenes || []));
  setAdminStatus("Editando articulo existente. Si eliges imagenes nuevas, reemplazaran las actuales.", "ok");
  els.nombre.focus();
}

async function removeArticle(article) {
  const confirmed = window.confirm(`Eliminar "${article.nombre || "este articulo"}"?`);
  if (!confirmed) {
    return;
  }

  setBusy(true);

  try {
    await deleteDoc(doc(db, ARTICULOS_COLLECTION, article.id));

    if (editingId === article.id) {
      resetForm();
    }

    setAdminStatus("Articulo eliminado.", "ok");
  } catch (error) {
    setAdminStatus(readableError(error), "error");
  } finally {
    setBusy(false);
  }
}

function readForm(user) {
  const price = Number(els.precio.value);

  return {
    nombre: els.nombre.value.trim(),
    slug: slugify(els.nombre.value),
    categoria: els.categoria.value.trim(),
    precio: Number.isFinite(price) ? price : 0,
    moneda: "Bs",
    descripcion: els.descripcion.value.trim(),
    detalle: els.detalle.value.trim(),
    colores: els.colores.value.split(",").map((color) => color.trim()).filter(Boolean),
    orden: Number(els.orden.value || 0),
    visible: els.visible.checked,
    destacado: els.destacado.checked,
    updatedAt: serverTimestamp(),
    updatedBy: user.email
  };
}

async function prepareImagesForFirestore(files) {
  const images = [];

  for (const file of files.slice(0, MAX_IMAGES)) {
    images.push(await compressImage(file));
  }

  const totalSize = images.reduce((sum, image) => sum + image.url.length, 0);
  if (totalSize > MAX_TOTAL_IMAGE_DATA_URL_CHARS) {
    throw new Error("Las imagenes comprimidas superan el limite preventivo del articulo. Usa menos imagenes o fotos mas simples.");
  }

  return images;
}

async function compressImage(file) {
  const image = await loadImage(file);
  let maxSide = INITIAL_IMAGE_SIDE;
  let quality = 0.78;

  for (let attempt = 0; attempt < 12; attempt++) {
    const { canvas, width, height } = drawImageToCanvas(image, maxSide);
    const blob = await canvasToBlob(canvas, IMAGE_OUTPUT_TYPE, quality);
    const dataUrl = await blobToDataUrl(blob);

    if (dataUrl.length <= MAX_IMAGE_DATA_URL_CHARS) {
      return {
        url: dataUrl,
        name: safeFileName(file.name),
        originalName: file.name,
        size: dataUrl.length,
        originalSize: file.size,
        type: IMAGE_OUTPUT_TYPE,
        width,
        height
      };
    }

    if (quality > 0.48) {
      quality -= 0.1;
    } else {
      maxSide = Math.max(520, Math.round(maxSide * 0.82));
      quality = 0.68;
    }
  }

  throw new Error(`No se pudo comprimir ${file.name} por debajo del limite preventivo.`);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`No se pudo leer la imagen ${file.name}.`));
    };

    image.src = objectUrl;
  });
}

function drawImageToCanvas(image, maxSide) {
  const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return { canvas, width, height };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("No se pudo comprimir la imagen."));
      }
    }, type, quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo preparar la imagen comprimida."));
    reader.readAsDataURL(blob);
  });
}

function handleImageSelection() {
  const files = getSelectedFiles();
  const validation = validateFiles(files);

  if (!validation.ok) {
    els.imagenes.value = "";
    renderPreview([]);
    setAdminStatus(validation.message, "error");
    return;
  }

  renderPreview(files.map((file) => ({ url: URL.createObjectURL(file), name: file.name })));
  setAdminStatus("Las imagenes se comprimiran antes de guardarse en Firestore.", "ok");
}

function validateFiles(files) {
  if (files.length > MAX_IMAGES) {
    return { ok: false, message: `Puedes guardar hasta ${MAX_IMAGES} imagenes por articulo.` };
  }

  const invalidType = files.find((file) => !ALLOWED_IMAGE_TYPES.includes(file.type));
  if (invalidType) {
    return { ok: false, message: "Selecciona imagenes JPG, PNG o WebP." };
  }

  const oversized = files.find((file) => file.size > MAX_ORIGINAL_IMAGE_BYTES);
  if (oversized) {
    return { ok: false, message: "Cada imagen original debe pesar 8 MB o menos." };
  }

  return { ok: true, message: "" };
}

function getSelectedFiles() {
  return Array.from(els.imagenes.files || []);
}

function renderArticles() {
  if (!articles.length) {
    els.articleList.innerHTML = `
      <div class="empty-state">
        <strong>No hay articulos todavia.</strong>
        <p>Crea el primero desde el formulario.</p>
      </div>
    `;
    return;
  }

  els.articleList.innerHTML = articles.map((article) => {
    const images = normalizeImages(article.imagenes || []);
    const thumb = images[0]?.url || "assets/logo.png";
    const visibility = article.visible === false ? "Oculto" : "Visible";
    const category = article.categoria || "Sin categoria";

    return `
      <article class="article-row">
        <img class="article-thumb" src="${escapeAttr(thumb)}" alt="${escapeAttr(article.nombre || "Articulo")}" loading="lazy">
        <div class="article-main">
          <h3>${escapeHtml(article.nombre || "Articulo sin nombre")}</h3>
          <div class="article-meta">
            <span>${formatPrice(article)}</span>
            <span>${escapeHtml(category)}</span>
            <span>${visibility}</span>
            <span>${images.length}/${MAX_IMAGES} imagenes</span>
          </div>
          <div class="card-actions">
            <button class="small-button" type="button" data-action="edit" data-id="${escapeAttr(article.id)}">Editar</button>
            <button class="small-button danger" type="button" data-action="delete" data-id="${escapeAttr(article.id)}">Eliminar</button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderPreview(images) {
  clearPreviewUrls();

  previewUrls = images
    .map((image) => image.url)
    .filter((url) => url && url.startsWith("blob:"));

  if (!images.length) {
    els.preview.innerHTML = "";
    return;
  }

  els.preview.innerHTML = images.slice(0, MAX_IMAGES).map((image, index) => `
    <img src="${escapeAttr(image.url)}" alt="${escapeAttr(image.name || `Imagen ${index + 1}`)}">
  `).join("");
}

function resetForm() {
  if (!els.form) {
    return;
  }

  editingId = null;
  els.form.reset();
  els.editId.value = "";
  els.orden.value = "0";
  els.visible.checked = true;
  els.destacado.checked = false;
  els.formTitle.textContent = "Nuevo articulo";
  els.saveButton.textContent = "Guardar articulo";
  renderPreview([]);
}

function setBusy(isBusy) {
  els.saveButton.disabled = isBusy;
  els.resetButton.disabled = isBusy;
  els.signOut.disabled = isBusy;
  els.articleList.querySelectorAll("button").forEach((button) => {
    button.disabled = isBusy;
  });
}

function setAuthStatus(message, type = "") {
  els.authStatus.textContent = message;
  els.authStatus.className = `status-line ${type}`.trim();
}

function setAdminStatus(message, type = "") {
  els.adminStatus.textContent = message;
  els.adminStatus.className = `status-line ${type}`.trim();
}

function isAdmin(user) {
  return Boolean(user && (!ADMIN_EMAILS.length || ADMIN_EMAILS.includes(user.email)));
}

function sortArticles(a, b) {
  const orderA = Number.isFinite(Number(a.orden)) ? Number(a.orden) : 0;
  const orderB = Number.isFinite(Number(b.orden)) ? Number(b.orden) : 0;

  if (orderA !== orderB) {
    return orderA - orderB;
  }

  return getMillis(b.createdAt) - getMillis(a.createdAt);
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

function normalizeImages(images) {
  return images
    .map((image) => (typeof image === "string" ? { url: image } : image))
    .filter((image) => image && image.url);
}

function formatPrice(article) {
  const price = Number(article.precio);
  if (!Number.isFinite(price)) {
    return "Consultar";
  }

  const formatted = new Intl.NumberFormat("es-BO", {
    maximumFractionDigits: price % 1 === 0 ? 0 : 2
  }).format(price);

  return `${formatted} ${article.moneda || "Bs"}`;
}

function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "articulo";
}

function safeFileName(value) {
  return slugify(value.replace(/\.[^.]+$/, "")) + getExtension(value);
}

function getExtension(value) {
  const match = String(value).toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : ".jpg";
}

function clearPreviewUrls() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
}

function readableError(error) {
  if (!error) {
    return "Ocurrio un error inesperado.";
  }

  if (error.code === "auth/operation-not-allowed") {
    return "El proveedor Google no esta habilitado en Firebase Authentication.";
  }

  if (error.code === "permission-denied") {
    return "Firebase rechazo la operacion. Revisa las reglas de Firestore y los correos administradores.";
  }

  if (error.code === "auth/unauthorized-domain") {
    return `Este dominio no esta autorizado en Firebase Authentication: ${location.hostname}. Agregalo en Authentication > Settings > Authorized domains.`;
  }

  if (error.code === "auth/popup-blocked") {
    return "El navegador bloqueo la ventana de Google. Permite popups para este sitio o usa el acceso por redireccion.";
  }

  if (error.code === "auth/popup-closed-by-user") {
    return "Se cerro la ventana de Google antes de iniciar sesion.";
  }

  if (error.code === "auth/network-request-failed") {
    return "No se pudo conectar con Firebase. Revisa la conexion a internet e intenta de nuevo.";
  }

  return error.message || "Ocurrio un error inesperado.";
}

function shouldTryRedirect(error) {
  return [
    "auth/popup-blocked",
    "auth/popup-closed-by-user",
    "auth/cancelled-popup-request"
  ].includes(error?.code);
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

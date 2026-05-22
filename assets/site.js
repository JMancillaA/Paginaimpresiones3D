(() => {
  function bindLightbox(root = document) {
    const overlay = document.getElementById("lightbox-overlay");
    const lightboxImg = document.getElementById("lightbox-img");

    if (!overlay || !lightboxImg) {
      return;
    }

    root.querySelectorAll(".producto img, [data-lightbox]").forEach((img) => {
      if (img.dataset.lightboxBound === "true") {
        return;
      }

      img.dataset.lightboxBound = "true";
      img.addEventListener("click", () => {
        lightboxImg.src = img.currentSrc || img.src;
        lightboxImg.alt = img.alt || "Imagen ampliada";
        overlay.hidden = false;
      });
    });
  }

  function closeLightbox() {
    const overlay = document.getElementById("lightbox-overlay");
    const lightboxImg = document.getElementById("lightbox-img");

    if (!overlay || !lightboxImg) {
      return;
    }

    overlay.hidden = true;
    lightboxImg.removeAttribute("src");
  }

  document.addEventListener("DOMContentLoaded", () => {
    const overlay = document.getElementById("lightbox-overlay");
    const closeButton = document.querySelector(".lightbox-close");

    bindLightbox();

    if (closeButton) {
      closeButton.addEventListener("click", closeLightbox);
    }

    if (overlay) {
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          closeLightbox();
        }
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeLightbox();
      }
    });
  });

  window.WhiskerWorks3D = {
    bindLightbox
  };
})();

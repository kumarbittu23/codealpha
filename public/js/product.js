(() => {
  const detail = document.getElementById("product-detail");
  const errorBox = document.getElementById("product-error");
  const productId = new URLSearchParams(window.location.search).get("id");
  if (!productId || !/^\d+$/.test(productId)) {
    detail.innerHTML = "";
    Store.showNotice(errorBox, "That product could not be found.");
    return;
  }

  function renderReviews(reviews) {
    if (!reviews.length) return '<p class="empty-message">No reviews yet. Be the first to share your experience after delivery.</p>';
    return reviews.map((review) => `
      <article class="product-review">
        <div class="review-heading"><strong>${Store.escapeHtml(review.reviewerName)}</strong><span class="review-stars" aria-label="${review.rating} out of 5 stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</span></div>
        <p>${Store.escapeHtml(review.body)}</p>
        ${review.hasImage ? `<img class="review-photo" src="/api/reviews/${review.id}/image" alt="Customer photo for ${Store.escapeHtml(review.reviewerName)}'s review" loading="lazy">` : ""}
        <time>${new Date(review.createdAt + " UTC").toLocaleDateString(undefined, { dateStyle: "medium" })}</time>
      </article>`).join("");
  }

  function renderRatingBreakdown(breakdown = { total: 0, fiveStar: 0, moderate: 0, bad: 0 }) {
    const groups = [
      { key: "fiveStar", label: "5-star rating" },
      { key: "moderate", label: "Moderate · 3–4 stars" },
      { key: "bad", label: "Bad · 1–2 stars" }
    ];
    return `<div class="rating-breakdown" aria-label="Customer rating breakdown">
      <p class="rating-breakdown-title">How shoppers rated this item <span>${breakdown.total} review${breakdown.total === 1 ? "" : "s"}</span></p>
      ${groups.map((group) => {
        const count = breakdown[group.key] || 0;
        const percent = breakdown.total ? Math.round(count / breakdown.total * 100) : 0;
        return `<div class="rating-breakdown-row"><span>${group.label}</span><span class="rating-bar" role="img" aria-label="${percent}%"><span style="width:${percent}%"></span></span><strong>${count}</strong><small>${percent}%</small></div>`;
      }).join("")}
    </div>`;
  }

  function prepareReviewImage(file) {
    if (!file) return Promise.resolve(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return Promise.reject(new Error("Choose a JPEG, PNG, or WebP image."));
    }
    if (file.size > 5 * 1024 * 1024) {
      return Promise.reject(new Error("Choose an image smaller than 5 MB. It will be resized before upload."));
    }
    return new Promise((resolve, reject) => {
      const source = new Image();
      const objectUrl = URL.createObjectURL(file);
      source.onload = async () => {
        URL.revokeObjectURL(objectUrl);
        const scale = Math.min(1, 1280 / Math.max(source.naturalWidth, source.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) return reject(new Error("This browser could not prepare the image. Try another file."));
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        try {
          for (const quality of [0.86, 0.76, 0.66, 0.56, 0.46]) {
            const blob = await new Promise((done) => canvas.toBlob(done, "image/jpeg", quality));
            if (blob && blob.size <= 700 * 1024) {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(new Error("Could not read the resized image."));
              reader.readAsDataURL(blob);
              return;
            }
          }
          reject(new Error("This image cannot be reduced below 700 KB. Choose a smaller image."));
        } catch (error) {
          reject(error);
        }
      };
      source.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not open that image. Choose a valid image file."));
      };
      source.src = objectUrl;
    });
  }

  function renderProduct(product, user, inWishlist) {
    const stars = product.reviewCount
      ? `<span class="review-stars" aria-label="${Number(product.averageRating).toFixed(1)} out of 5 stars">${"★".repeat(Math.round(product.averageRating))}${"☆".repeat(5 - Math.round(product.averageRating))}</span><span>${Number(product.averageRating).toFixed(1)} · ${product.reviewCount} review${product.reviewCount === 1 ? "" : "s"}</span>`
      : '<span class="review-summary-empty">No reviews yet</span>';
    document.title = `${product.name} — Corner Store`;
    const productImages = (product.productImages || (product.additionalImageUrls || []).map((imageUrl) => ({
      imageUrl, modelProfile: "general", viewLabel: "Other view"
    }))).filter((image) => image && typeof image.imageUrl === "string");
    const galleryImages = [
      { imageUrl: product.imageUrl, viewLabel: "Main product image" },
      ...productImages
    ].filter((image, index, images) => image.imageUrl && images.findIndex((candidate) => candidate.imageUrl === image.imageUrl) === index);
    const profileLabels = {
      "male-slim": "Men · Slim", "male-average": "Men · Average", "male-athletic": "Men · Athletic", "male-plus": "Men · Plus",
      "female-petite": "Women · Petite", "female-average": "Women · Average", "female-curvy": "Women · Curvy", "female-plus": "Women · Plus",
      "kids-2-4": "Kids · Ages 2–4", "kids-5-8": "Kids · Ages 5–8", "kids-9-12": "Kids · Ages 9–12", "kids-13-16": "Kids · Ages 13–16"
    };
    const availableProfiles = [...new Set(productImages
      .filter((image) => image.modelProfile !== "general" && profileLabels[image.modelProfile])
      .map((image) => image.modelProfile))];
    const showModelPreview = product.categoryPath?.split("/").includes("clothing") && availableProfiles.length > 0;
    detail.innerHTML = `
      <div class="detail-gallery">
        <div class="detail-image"><img id="detail-main-image" src="${Store.escapeHtml(galleryImages[0].imageUrl)}" alt="${Store.escapeHtml(product.name)}"></div>
        ${galleryImages.length > 1 ? `<div class="detail-thumbnails" aria-label="More product views">${galleryImages.map((image, index) =>
          `<button class="detail-thumbnail${index === 0 ? " active" : ""}" type="button" data-gallery-image="${index}" aria-label="${Store.escapeHtml(image.viewLabel || `View product image ${index + 1}`)}" aria-pressed="${index === 0}"><img src="${Store.escapeHtml(image.imageUrl)}" alt="" loading="lazy"></button>`
        ).join("")}</div>` : ""}
        ${showModelPreview ? `<section class="model-preview" aria-labelledby="model-preview-title">
          <p class="eyebrow">Seller model photos</p><h2 id="model-preview-title">See an example on a model</h2>
          <label for="model-profile-select">Choose a model profile</label>
          <select id="model-profile-select">${availableProfiles.map((profile) => `<option value="${profile}">${profileLabels[profile]}</option>`).join("")}</select>
          <div class="detail-thumbnails model-preview-thumbnails" id="model-preview-thumbnails" aria-label="Seller photos matching the selected profile"></div>
          <p class="field-hint">These are seller-provided example photos, not a generated image of you or a fit guarantee. No customer photos are uploaded.</p>
        </section>` : ""}
      </div>
      <div class="detail-copy">
        <p class="eyebrow">${product.categoryPath ? `<a href="/category/${product.categoryPath}/">${Store.escapeHtml(product.categoryPathLabel)}</a>` : Store.escapeHtml(product.category)}</p>
        <h1>${Store.escapeHtml(product.name)}</h1>
        <div class="detail-rating">${stars}</div>
        <p class="detail-price">${Store.formatMoney(product.pricePaise)}</p>
        <p class="detail-description">${Store.escapeHtml(product.description)}</p>
        <p class="seller-note">Sold by ${Store.escapeHtml(product.sellerName || "Corner Store")}</p>
        <p class="stock-note">${product.stock > 0 ? "✳ In stock and ready to ship" : "Currently sold out"}</p>
        <div class="detail-actions">
          <button class="button button-dark detail-add" id="add-to-bag" type="button" ${product.stock === 0 ? "disabled" : ""}>Add to bag <span aria-hidden="true">↗</span></button>
          ${user ? `<button class="button button-outline" id="wishlist-toggle" type="button" aria-pressed="${inWishlist}">${inWishlist ? "♥ Saved" : "♡ Save"}</button>` : '<a class="button button-outline" href="/account.html">Sign in to save</a>'}
        </div>
        <div class="detail-perks"><p>♡ Carefully chosen, made to last</p><p>↗ Free shipping on orders over ₹1,499</p></div>
      </div>
      <section class="product-reviews" id="reviews">
        <div class="reviews-heading"><div><p class="eyebrow">Customer notes</p><h2>Reviews <span>(${product.reviewCount})</span></h2></div>${product.reviewCount ? `<strong class="reviews-average">${Number(product.averageRating).toFixed(1)} <span class="review-stars">★</span></strong>` : ""}</div>
        ${renderRatingBreakdown(product.ratingBreakdown)}
        <div class="review-list">${renderReviews(product.reviews)}</div>
        <div class="review-form-wrap">
          <h3>Share your experience</h3>
          ${user ? `<p class="field-hint">Only customers with a delivered order can review this product.</p>
            <form id="review-form" class="review-form">
              <label>Your rating<select name="rating" required><option value="5">5 — Loved it</option><option value="4">4 — Very good</option><option value="3">3 — Good</option><option value="2">2 — Could be better</option><option value="1">1 — Not for me</option></select></label>
              <label>Your review<textarea name="body" minlength="10" maxlength="1500" rows="4" placeholder="What should other shoppers know?" required></textarea></label>
              <label>Add a photo (optional)<input name="reviewImage" type="file" accept="image/jpeg,image/png,image/webp"><span class="field-hint">JPEG, PNG, or WebP. Images are resized; maximum uploaded size is 700 KB.</span></label>
              <div class="review-photo-preview hidden" id="review-photo-preview"></div>
              <button class="button button-dark" type="submit">Submit review</button>
            </form>` : '<p class="field-hint"><a class="text-button" href="/account.html">Sign in</a> to write a verified-purchase review after delivery.</p>'}
        </div>
      </section>`;

    function showGalleryImage(imageIndex) {
      const image = galleryImages[imageIndex];
      if (!image) return;
      detail.querySelector("#detail-main-image").src = image.imageUrl;
      detail.querySelectorAll("[data-gallery-image]").forEach((thumbnail) => {
        const selected = Number(thumbnail.dataset.galleryImage) === imageIndex;
        thumbnail.classList.toggle("active", selected);
        thumbnail.setAttribute("aria-pressed", String(selected));
      });
      detail.querySelectorAll("[data-profile-image]").forEach((thumbnail) => {
        const selected = Number(thumbnail.dataset.profileImage) === imageIndex;
        thumbnail.classList.toggle("active", selected);
        thumbnail.setAttribute("aria-pressed", String(selected));
      });
    }

    detail.querySelectorAll("[data-gallery-image]").forEach((button) => {
      button.addEventListener("click", () => {
        showGalleryImage(Number(button.dataset.galleryImage));
      });
    });
    const profileSelect = document.getElementById("model-profile-select");
    if (profileSelect) {
      const previewThumbnails = document.getElementById("model-preview-thumbnails");
      function renderProfileImages(profile) {
        const matchingImages = productImages.filter((image) => image.modelProfile === profile);
        previewThumbnails.innerHTML = matchingImages.map((image, index) => {
          const galleryIndex = galleryImages.findIndex((galleryImage) => galleryImage.imageUrl === image.imageUrl);
          return `<button class="detail-thumbnail${index === 0 ? " active" : ""}" type="button" data-profile-image="${galleryIndex}" aria-label="${Store.escapeHtml(image.viewLabel)}" aria-pressed="${index === 0}"><img src="${Store.escapeHtml(image.imageUrl)}" alt="" loading="lazy"><span>${Store.escapeHtml(image.viewLabel)}</span></button>`;
        }).join("");
        if (matchingImages.length) showGalleryImage(galleryImages.findIndex((image) => image.imageUrl === matchingImages[0].imageUrl));
      }
      profileSelect.addEventListener("change", () => renderProfileImages(profileSelect.value));
      previewThumbnails.addEventListener("click", (event) => {
        const button = event.target.closest("[data-profile-image]");
        if (!button) return;
        showGalleryImage(Number(button.dataset.profileImage));
        previewThumbnails.querySelectorAll("[data-profile-image]").forEach((thumbnail) => {
          const selected = thumbnail === button;
          thumbnail.classList.toggle("active", selected);
          thumbnail.setAttribute("aria-pressed", String(selected));
        });
      });
      renderProfileImages(profileSelect.value);
    }

    document.getElementById("add-to-bag").addEventListener("click", (event) => {
      const cart = Store.getCart();
      const existing = cart.find((item) => item.id === product.id);
      if (existing) existing.quantity = Math.min(20, existing.quantity + 1);
      else cart.push({ id: product.id, quantity: 1 });
      Store.saveCart(cart);
      const button = event.currentTarget;
      button.innerHTML = "Added to your bag <span aria-hidden=\"true\">✓</span>";
      setTimeout(() => {
        if (button.isConnected) button.innerHTML = "Add to bag <span aria-hidden=\"true\">↗</span>";
      }, 1300);
    });

    const wishlistButton = document.getElementById("wishlist-toggle");
    if (wishlistButton) {
      wishlistButton.addEventListener("click", async () => {
        wishlistButton.disabled = true;
        try {
          if (wishlistButton.getAttribute("aria-pressed") === "true") {
            await Store.apiRequest(`/api/wishlist/${product.id}`, { method: "DELETE" });
            wishlistButton.setAttribute("aria-pressed", "false");
            wishlistButton.textContent = "♡ Save";
          } else {
            await Store.apiRequest(`/api/wishlist/${product.id}`, { method: "POST", body: JSON.stringify({}) });
            wishlistButton.setAttribute("aria-pressed", "true");
            wishlistButton.textContent = "♥ Saved";
          }
        } catch (error) {
          Store.showNotice(errorBox, error.message);
        } finally {
          wishlistButton.disabled = false;
        }
      });
    }

    const reviewForm = document.getElementById("review-form");
    if (reviewForm) {
      const imageInput = reviewForm.elements.reviewImage;
      const preview = document.getElementById("review-photo-preview");
      let imageData = null;
      imageInput.addEventListener("change", async () => {
        imageData = null;
        preview.classList.add("hidden");
        preview.innerHTML = "";
        if (!imageInput.files[0]) return;
        imageInput.disabled = true;
        try {
          imageData = await prepareReviewImage(imageInput.files[0]);
          preview.innerHTML = `<img src="${imageData}" alt="Preview of your review photo"><button class="text-button" id="remove-review-photo" type="button">Remove photo</button>`;
          preview.classList.remove("hidden");
        } catch (error) {
          imageInput.value = "";
          Store.showNotice(errorBox, error.message);
        } finally {
          imageInput.disabled = false;
        }
      });
      preview.addEventListener("click", (event) => {
        if (event.target.id !== "remove-review-photo") return;
        imageData = null;
        imageInput.value = "";
        preview.classList.add("hidden");
        preview.innerHTML = "";
      });
      reviewForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = reviewForm.querySelector("button[type=submit]");
        button.disabled = true;
        try {
          const values = new FormData(reviewForm);
          await Store.apiRequest(`/api/products/${product.id}/reviews`, {
            method: "POST",
            body: JSON.stringify({ rating: Number(values.get("rating")), body: values.get("body"), imageData })
          });
          Store.showNotice(errorBox, "Thank you. Your review has been published.", "success");
          const updated = await Store.apiRequest(`/api/products/${product.id}`);
          const session = await Store.getSession();
          const saved = await Store.apiRequest("/api/wishlist");
          renderProduct(updated, session.user, saved.some((item) => item.id === product.id));
        } catch (error) {
          Store.showNotice(errorBox, error.message);
          button.disabled = false;
        }
      });
    }
  }

  async function loadProduct() {
    try {
      const [product, session] = await Promise.all([
        Store.apiRequest(`/api/products/${productId}`),
        Store.getSession()
      ]);
      const saved = session.user ? await Store.apiRequest("/api/wishlist") : [];
      renderProduct(product, session.user, saved.some((item) => item.id === product.id));
    } catch (error) {
      detail.innerHTML = "";
      Store.showNotice(errorBox, error.message);
    }
  }

  loadProduct();
})();

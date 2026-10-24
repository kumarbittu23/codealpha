(() => {
  const productGrid = document.getElementById("product-grid");
  const categoryList = document.getElementById("category-list");
  const searchInput = document.getElementById("search-input");
  const searchSuggestions = document.getElementById("search-suggestions");
  const emptyMessage = document.getElementById("empty-message");
  const sortSelect = document.getElementById("sort-products");
  const minPriceInput = document.getElementById("min-price");
  const maxPriceInput = document.getElementById("max-price");
  const pagination = document.getElementById("product-pagination");
  const categoryNavigation = document.getElementById("category-navigation");
  const categoryHeading = document.getElementById("category-heading");
  const categoryDescription = document.getElementById("category-description");
  const categoryBanner = document.getElementById("category-banner");
  const categoryBreadcrumbs = document.getElementById("category-breadcrumbs");
  const subcategoryList = document.getElementById("subcategory-list");
  const isCategoryPage = location.pathname.startsWith("/category/");
  const requestedCategoryPath = isCategoryPage
    ? decodeURIComponent(location.pathname.slice("/category/".length).replace(/\/+$/, ""))
    : "";
  let selectedCategoryId = null;
  let categoryTree = [];
  let selectedCategoryNode = null;
  let currentPage = 1;
  let searchTimer;
  let suggestionTimer;
  let suggestionSequence = 0;
  let signedIn = false;
  const wishlistIds = new Set();
  let scannerStream = null;
  let scannerTimer = null;

  function productCard(product) {
    const outOfStock = product.stock === 0;
    return `
      <article class="product-card">
        <a class="product-image-link" href="/product.html?id=${product.id}" aria-label="View ${Store.escapeHtml(product.name)}">
          <div class="product-image"><img src="${Store.escapeHtml(product.imageUrl)}" alt="${Store.escapeHtml(product.name)}" loading="lazy">
          <button class="wishlist-card-toggle${wishlistIds.has(product.id) ? " is-saved" : ""}" type="button" data-wishlist-id="${product.id}" aria-label="${wishlistIds.has(product.id) ? "Remove from" : "Add to"} wishlist" aria-pressed="${wishlistIds.has(product.id)}">♥</button>
          ${product.bestseller ? `<span class="product-tag sales-tag">Bestseller · ${product.unitsSold} ordered</span>` : product.sellingFast ? `<span class="product-tag sales-tag">Selling fast · ${product.recentUnitsSold} in 30d</span>` : product.featured ? '<span class="product-tag">A favorite</span>' : ""}${outOfStock ? '<span class="product-tag sold-out">Sold out</span>' : ""}</div>
        </a>
        <div class="product-card-info"><div><p class="product-category">${Store.escapeHtml(product.categoryPathLabel || product.category)}</p><a class="product-name" href="/product.html?id=${product.id}">${Store.escapeHtml(product.name)}</a><p class="product-rating">${product.reviewCount ? `★ ${Number(product.averageRating).toFixed(1)} · ${product.reviewCount} reviews` : "New"} · ${Store.escapeHtml(product.sellerName)}</p></div><span class="product-price">${Store.formatMoney(product.pricePaise)}</span></div>
        <button class="quick-add" type="button" data-product-id="${product.id}" ${outOfStock ? "disabled" : ""}>${outOfStock ? "Sold out" : "Add to bag"} <span aria-hidden="true">+</span></button>
      </article>`;
  }

  function renderCategories(categories) {
    if (isCategoryPage) return;
    function findCategory(id, nodes = categoryTree) {
      for (const category of nodes) {
        if (category.id === Number(id)) return category;
        const found = findCategory(id, category.children || []);
        if (found) return found;
      }
      return null;
    }
    const current = selectedCategoryId ? findCategory(selectedCategoryId) : null;
    const choices = current?.children?.length ? current.children : current ? [current] : categoryTree;
    categoryList.innerHTML = `<button class="category-chip${selectedCategoryId === null ? " selected" : ""}" type="button" data-category-id="">Everything</button>
      ${choices.map((category) => `<button class="category-chip${category.id === selectedCategoryId ? " selected" : ""}" type="button" data-category-id="${category.id}">${Store.escapeHtml(category.name)}</button>`).join("")}`;
  }

  function renderCategoryLinks() {
    if (categoryNavigation) {
      categoryNavigation.innerHTML = categoryTree.map((category) =>
        `<a href="/category/${category.path.join("/")}/">${Store.escapeHtml(category.name)}</a>`
      ).join("");
    }
    if (!isCategoryPage || !selectedCategoryNode) return;
    const ancestors = [];
    function findPath(nodes, path = []) {
      for (const node of nodes) {
        const next = [...path, node];
        if (node.id === selectedCategoryNode.id) return next;
        const match = findPath(node.children || [], next);
        if (match) return match;
      }
      return null;
    }
    ancestors.push(...(findPath(categoryTree) || []));
    if (categoryHeading) categoryHeading.textContent = selectedCategoryNode.name;
    if (categoryDescription) categoryDescription.textContent = selectedCategoryNode.description || `Shop products in ${selectedCategoryNode.name}.`;
    if (categoryBanner && selectedCategoryNode.imageUrl) {
      categoryBanner.src = selectedCategoryNode.imageUrl;
      categoryBanner.alt = selectedCategoryNode.name;
      categoryBanner.classList.remove("hidden");
    }
    if (categoryBreadcrumbs) categoryBreadcrumbs.innerHTML = `<a href="/">Home</a>${ancestors.map((category) =>
      `<span aria-hidden="true">/</span><a href="/category/${category.path.join("/")}/">${Store.escapeHtml(category.name)}</a>`
    ).join("")}`;
    if (subcategoryList) {
      subcategoryList.innerHTML = selectedCategoryNode.children.length
        ? selectedCategoryNode.children.map((child) =>
          `<a class="category-chip" href="/category/${child.path.join("/")}/">${Store.escapeHtml(child.name)} <span aria-hidden="true">↗</span></a>`
        ).join("")
        : "";
    }
  }

  async function loadProducts() {
    productGrid.innerHTML = '<p class="loading-message">Gathering the good stuff…</p>';
    emptyMessage.classList.add("hidden");
    const parameters = new URLSearchParams();
    if (isCategoryPage) parameters.set("categoryPath", requestedCategoryPath);
    if (selectedCategoryId !== null) parameters.set("categoryId", String(selectedCategoryId));
    if (searchInput.value.trim()) parameters.set("search", searchInput.value.trim());
    if (sortSelect.value) parameters.set("sort", sortSelect.value);
    if (minPriceInput.value) parameters.set("minPrice", String(Math.round(Number(minPriceInput.value) * 100)));
    if (maxPriceInput.value) parameters.set("maxPrice", String(Math.round(Number(maxPriceInput.value) * 100)));
    parameters.set("page", String(currentPage));
    try {
      const result = await Store.apiRequest("/api/products?" + parameters.toString());
      productGrid.innerHTML = result.products.map(productCard).join("");
      emptyMessage.classList.toggle("hidden", result.products.length !== 0);
      renderCategories(result.categories);
      pagination.innerHTML = result.pagination.pages > 1
        ? `<button class="category-chip" type="button" data-page="${currentPage - 1}" ${currentPage <= 1 ? "disabled" : ""}>← Previous</button><span>Page ${currentPage} of ${result.pagination.pages}</span><button class="category-chip" type="button" data-page="${currentPage + 1}" ${currentPage >= result.pagination.pages ? "disabled" : ""}>Next →</button>`
        : "";
    } catch (error) {
      productGrid.innerHTML = `<p class="notice notice-error">${Store.escapeHtml(error.message)}</p>`;
    }
  }

  function hideSuggestions() {
    if (!searchSuggestions) return;
    searchSuggestions.classList.add("hidden");
    searchSuggestions.innerHTML = "";
    searchInput.setAttribute("aria-expanded", "false");
  }

  async function stopBarcodeScanner() {
    clearInterval(scannerTimer);
    scannerTimer = null;
    if (scannerStream) scannerStream.getTracks().forEach((track) => track.stop());
    scannerStream = null;
    const video = document.getElementById("barcode-video");
    if (video) video.srcObject = null;
    document.getElementById("barcode-scanner")?.classList.add("hidden");
  }

  async function startBarcodeScanner() {
    const panel = document.getElementById("barcode-scanner");
    const video = document.getElementById("barcode-video");
    const status = document.getElementById("barcode-status");
    if (!panel || !video || !status) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      Store.showNotice(document.getElementById("shop-notice"), "Camera access is unavailable. Type the product name or barcode into search.");
      return;
    }
    if (!("BarcodeDetector" in window)) {
      Store.showNotice(document.getElementById("shop-notice"), "Barcode scanning is not supported in this browser. Search by product name or enter its SKU/barcode.");
      return;
    }
    try {
      await stopBarcodeScanner();
      const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"] });
      panel.classList.remove("hidden");
      status.textContent = "Allow camera access, then point it at a product barcode.";
      scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      video.srcObject = scannerStream;
      await video.play();
      scannerTimer = setInterval(async () => {
        if (!video.videoWidth || !scannerStream) return;
        try {
          const detected = await detector.detect(video);
          if (!detected.length) return;
          const value = detected[0].rawValue.trim();
          await stopBarcodeScanner();
          try {
            const url = new URL(value);
            const id = url.searchParams.get("id");
            if (id && /^\d+$/.test(id) && url.pathname.endsWith("/product.html")) {
              window.location.href = `/product.html?id=${encodeURIComponent(id)}`;
              return;
            }
          } catch {}
          searchInput.value = value;
          searchInput.dispatchEvent(new Event("input", { bubbles: true }));
          searchInput.focus();
          document.getElementById("shop").scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (error) {
          console.error("Barcode detection failed.", error);
          status.textContent = "Could not read that barcode. Try holding the camera steady.";
        }
      }, 300);
    } catch (error) {
      await stopBarcodeScanner();
      const message = error.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access in your browser settings or search by typing."
        : "Could not start the camera. Check camera access and try again.";
      Store.showNotice(document.getElementById("shop-notice"), message);
    }
  }

  function startVoiceSearch() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      Store.showNotice(document.getElementById("shop-notice"), "Voice search is not supported in this browser. Try Chrome or Edge, or type your search.");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => Store.showNotice(document.getElementById("shop-notice"), "Listening… say a product name.", "success");
    recognition.onresult = (event) => {
      searchInput.value = event.results[0][0].transcript.trim();
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput.focus();
    };
    recognition.onerror = (event) => {
      const message = event.error === "not-allowed"
        ? "Microphone permission was denied. Allow microphone access in your browser settings."
        : `Voice search could not start (${event.error}). Please type your search instead.`;
      Store.showNotice(document.getElementById("shop-notice"), message);
    };
    recognition.start();
  }

  async function loadSuggestions(query) {
    const sequence = ++suggestionSequence;
    try {
      const parameters = new URLSearchParams({ search: query, limit: "5", sort: "bestsellers", suggestions: "true" });
      const result = await Store.apiRequest(`/api/products?${parameters}`);
      if (sequence !== suggestionSequence || searchInput.value.trim() !== query) return;
      const suggestionMarkup = (product) => `
        <a class="search-suggestion" role="option" href="/product.html?id=${product.id}">
          <span><strong>${Store.escapeHtml(product.name)}</strong><small>${Store.escapeHtml(product.categoryPathLabel || product.category)}</small></span>
          <span class="search-suggestion-price">${Store.formatMoney(product.pricePaise)}</span>
        </a>`;
      const exactMatches = result.products.slice(0, 5);
      const relatedProducts = (result.relatedProducts || []).slice(0, 4);
      if (!exactMatches.length && !relatedProducts.length) {
        searchSuggestions.innerHTML = '<p class="search-suggestion-empty">No matching products yet.</p>';
      } else {
        searchSuggestions.innerHTML = `${exactMatches.length
          ? `<p class="search-suggestion-heading">Matching products</p>${exactMatches.map(suggestionMarkup).join("")}`
          : ""}${relatedProducts.length
          ? `<p class="search-suggestion-heading">Similar products</p>${relatedProducts.map(suggestionMarkup).join("")}`
          : ""}`;
      }
      searchSuggestions.classList.remove("hidden");
      searchInput.setAttribute("aria-expanded", "true");
    } catch (error) {
      if (sequence === suggestionSequence) {
        console.error("Could not load search suggestions.", error);
        hideSuggestions();
      }
    }
  }

  categoryList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category-id]");
    if (!button) return;
    selectedCategoryId = button.dataset.categoryId ? Number(button.dataset.categoryId) : null;
    currentPage = 1;
    renderCategories();
    loadProducts();
  });
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    clearTimeout(suggestionTimer);
    const query = searchInput.value.trim();
    if (query.length >= 2) suggestionTimer = setTimeout(() => loadSuggestions(query), 160);
    else hideSuggestions();
    searchTimer = setTimeout(() => { currentPage = 1; loadProducts(); }, 240);
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideSuggestions();
    if (event.key === "Enter") {
      hideSuggestions();
      currentPage = 1;
      loadProducts();
      document.getElementById("shop").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-container")) hideSuggestions();
  });
  document.querySelectorAll("[data-sort-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      sortSelect.value = button.dataset.sortPreset;
      currentPage = 1;
      loadProducts();
      document.getElementById("shop").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.getElementById("voice-search")?.addEventListener("click", startVoiceSearch);
    document.getElementById("barcode-search")?.addEventListener("click", startBarcodeScanner);
    document.getElementById("barcode-close")?.addEventListener("click", stopBarcodeScanner);
    window.addEventListener("pagehide", stopBarcodeScanner);
  });
  [sortSelect, minPriceInput, maxPriceInput].forEach((control) => control.addEventListener("change", () => {
    currentPage = 1;
    loadProducts();
  }));
  pagination.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (!button || button.disabled) return;
    currentPage = Number(button.dataset.page);
    loadProducts();
  });
  productGrid.addEventListener("click", async (event) => {
    const wishlistButton = event.target.closest("[data-wishlist-id]");
    if (wishlistButton) {
      if (!signedIn) {
        window.location.href = "/account.html";
        return;
      }
      wishlistButton.disabled = true;
      const productId = Number(wishlistButton.dataset.wishlistId);
      try {
        if (wishlistIds.has(productId)) {
          await Store.apiRequest(`/api/wishlist/${productId}`, { method: "DELETE" });
          wishlistIds.delete(productId);
        } else {
          await Store.apiRequest(`/api/wishlist/${productId}`, { method: "POST", body: JSON.stringify({}) });
          wishlistIds.add(productId);
        }
        wishlistButton.classList.toggle("is-saved", wishlistIds.has(productId));
        wishlistButton.setAttribute("aria-pressed", String(wishlistIds.has(productId)));
        wishlistButton.setAttribute("aria-label", `${wishlistIds.has(productId) ? "Remove from" : "Add to"} wishlist`);
      } catch (error) {
        Store.showNotice(document.getElementById("shop-notice"), error.message);
      } finally {
        wishlistButton.disabled = false;
      }
      return;
    }
    const button = event.target.closest("[data-product-id]");
    if (!button) return;
    button.disabled = true;
    try {
      const product = await Store.apiRequest(`/api/products/${button.dataset.productId}`);
      const cart = Store.getCart();
      const existing = cart.find((item) => item.id === product.id);
      if (existing) existing.quantity = Math.min(20, existing.quantity + 1);
      else cart.push({ id: product.id, quantity: 1 });
      Store.saveCart(cart);
      button.innerHTML = "Added <span aria-hidden=\"true\">✓</span>";
      setTimeout(() => {
        if (button.isConnected) {
          button.innerHTML = "Add to bag <span aria-hidden=\"true\">+</span>";
          button.disabled = false;
        }
      }, 1100);
    } catch (error) {
      button.textContent = error.message;
      setTimeout(() => { if (button.isConnected) button.disabled = false; }, 1500);
    }
  });

  async function start() {
    try {
      categoryTree = await Store.apiRequest("/api/categories");
      if (isCategoryPage) {
        const parts = requestedCategoryPath.split("/").filter(Boolean);
        let siblings = categoryTree;
        for (const part of parts) {
          selectedCategoryNode = siblings.find((category) => category.slug === part);
          if (!selectedCategoryNode) break;
          siblings = selectedCategoryNode.children;
        }
        if (!selectedCategoryNode || selectedCategoryNode.path.join("/") !== requestedCategoryPath) {
          window.location.replace("/");
          return;
        }
      }
      renderCategoryLinks();
      const session = await Store.getSession();
      signedIn = Boolean(session.user);
      if (signedIn) {
        const wishlist = await Store.apiRequest("/api/wishlist");
        wishlist.forEach((product) => wishlistIds.add(product.id));
      }
    } catch (error) {
      console.error("Could not load wishlist state.", error);
    }
    loadProducts();
  }
  start();
})();

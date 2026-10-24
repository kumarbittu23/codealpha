(() => {
  const root = document.getElementById("admin-view");
  const notice = document.getElementById("admin-notice");
  let products = [];
  let orders = [];
  let sellers = [];
  let reviews = [];
  let returnRequests = [];
  let commissionBasisPoints = 1000;
  let categories = [];

  function flattenCategories(items, prefix = []) {
    return items.flatMap((category) => {
      const path = [...prefix, category.name];
      return [{ ...category, pathLabel: path.join(" / ") }, ...flattenCategories(category.children || [], path)];
    });
  }

  function findCategoryPath(id, items = categories, parents = []) {
    for (const category of items) {
      const path = [...parents, category];
      if (category.id === Number(id)) return path;
      const found = findCategoryPath(id, category.children || [], path);
      if (found) return found;
    }
    return null;
  }

  function categorySelectMarkup(selectedId = null) {
    const selectedPath = selectedId ? findCategoryPath(selectedId) || [] : [];
    let siblings = categories.filter((category) => category.active);
    let level = 0;
    const selects = [];
    while (siblings.length) {
      const selected = selectedPath[level]?.id || "";
      selects.push(`<label>${level === 0 ? "Main category" : `Subcategory · level ${level + 1}`}
        <select data-category-level="${level}" required>
          <option value="">Choose ${level === 0 ? "a category" : "a subcategory"}</option>
          ${siblings.filter((category) => category.active).map((category) => `<option value="${category.id}" ${category.id === selected ? "selected" : ""}>${Store.escapeHtml(category.name)}</option>`).join("")}
        </select></label>`);
      const current = siblings.find((category) => category.id === Number(selected));
      if (!current) break;
      siblings = (current.children || []).filter((category) => category.active);
      level += 1;
    }
    const leaf = selectedPath.at(-1);
    const hasChildren = leaf?.children?.some((category) => category.active);
    return `${selects.join("")}<input type="hidden" name="categoryId" value="${leaf && !hasChildren ? leaf.id : ""}">`;
  }

  function renderCategoryManagement() {
    const categoryRows = flattenCategories(categories);
    const parentOptions = categoryRows.map((category) => `<option value="${category.id}">${Store.escapeHtml(category.pathLabel)}</option>`).join("");
    return `
      <form class="admin-product-form" id="category-form">
        <input type="hidden" name="id">
        <label>Category name<input name="name" minlength="2" maxlength="80" required></label>
        <label>URL slug<input name="slug" maxlength="80" placeholder="Created from the name if empty"></label>
        <label>Parent category<select name="parentId"><option value="">Main category (no parent)</option>${parentOptions}</select></label>
        <label>Display order<input name="displayOrder" type="number" min="0" max="100000" step="1" value="0" required></label>
        <label>Description<input name="description" maxlength="500"></label>
        <label>Category image URL (HTTPS)<input name="imageUrl" type="url" maxlength="500"></label>
        <div class="admin-form-actions"><button class="button button-dark" type="submit" id="category-submit">Add category</button><button class="text-button hidden" type="button" id="category-edit-cancel">Cancel edit</button></div>
      </form>
      ${categoryRows.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Category path</th><th>Slug</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        ${categoryRows.map((category) => `<tr><td>${Store.escapeHtml(category.pathLabel)}</td><td>${Store.escapeHtml(category.slug)}</td><td>${category.active ? "Active" : "Inactive"}</td>
        <td class="admin-row-actions"><button class="text-button" type="button" data-edit-category="${category.id}">Edit</button>
        <button class="text-button" type="button" data-category-active="${category.id}" data-active="${category.active ? "false" : "true"}">${category.active ? "Deactivate" : "Activate"}</button>
        <button class="text-button admin-delete" type="button" data-delete-category="${category.id}">Delete</button></td></tr>`).join("")}
      </tbody></table></div>` : '<p class="empty-admin">No categories configured.</p>'}`;
  }

  function setProductCategory(categoryId) {
    const container = document.getElementById("product-category-selectors");
    if (!container) return;
    container.innerHTML = categorySelectMarkup(categoryId);
    const leaf = findCategoryPath(categoryId)?.at(-1);
    const hidden = container.querySelector('[name="categoryId"]');
    if (leaf && !leaf.children?.some((category) => category.active)) hidden.value = String(leaf.id);
  }

  function renderLogin() {
    root.innerHTML = `
      <section class="account-card admin-login">
        <p class="eyebrow">Store team</p>
        <h1>Admin sign in<span>.</span></h1>
        <p class="account-intro">Sign in with the administrator account created for this store.</p>
        <form id="admin-login-form" class="checkout-form">
          <label>Email address<input name="email" type="email" autocomplete="username" maxlength="254" required></label>
          <label>Password<input name="password" type="password" autocomplete="current-password" maxlength="128" required></label>
          <button class="button button-dark full-button" type="submit">Sign in to the back office <span aria-hidden="true">↗</span></button>
        </form>
        <p class="admin-login-help">No admin account yet? Create one from the project terminal. See the README.</p>
      </section>`;
  }

  function renderProductRows() {
    if (products.length === 0) return '<p class="empty-admin">No products yet. Add your first product above.</p>';
    return `<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>Product</th><th>Price</th><th>In stock</th><th>Featured</th><th>Actions</th></tr></thead>
      <tbody>${products.map((product) => `
        <tr>
          <td><div class="admin-product"><img src="${Store.escapeHtml(product.imageUrl)}" alt=""><div><strong>${Store.escapeHtml(product.name)}</strong><span>${Store.escapeHtml(product.categoryPathLabel || product.category)}</span></div></div></td>
          <td>${Store.formatMoney(product.pricePaise)}</td><td>${product.stock}</td><td>${product.featured ? "Yes" : "No"}</td>
          <td class="admin-row-actions"><button class="text-button" type="button" data-edit-product="${product.id}">Edit</button><button class="text-button admin-delete" type="button" data-delete-product="${product.id}">Delete</button></td>
        </tr>`).join("")}
      </tbody>
    </table></div>`;
  }

  function statusOptions(order) {
    const nextStatuses = {
      pending_payment: ["cancelled"],
      placed: ["processing", "cancelled"],
      processing: ["shipped", "cancelled"],
      shipped: ["delivered"],
      delivered: [],
      cancelled: []
    };
    const choices = nextStatuses[order.status] || [];
    const statusLabel = order.status === "pending_payment" ? "Awaiting payment" : order.status;
    if (!choices.length) return `<span class="order-status">${Store.escapeHtml(statusLabel)}</span>`;
    return `<select class="order-status-select" aria-label="New status for order ${order.id}" data-order-status="${order.id}">
      <option value="">${Store.escapeHtml(statusLabel)}</option>
      ${choices.map((status) => `<option value="${status}">${status[0].toUpperCase()}${status.slice(1)}</option>`).join("")}
    </select><button class="text-button" type="button" data-update-order="${order.id}">Update</button>`;
  }

  function renderOrderRows() {
    if (orders.length === 0) return '<p class="empty-admin">There are no orders yet.</p>';
    return `<div class="admin-orders">${orders.map((order) => `
      <article class="admin-order-card">
        <div class="admin-order-top">
          <div><p class="product-category">Order #${order.id} · ${new Date(order.createdAt + " UTC").toLocaleDateString(undefined, { dateStyle: "medium" })}</p><strong>${Store.escapeHtml(order.customerName)}</strong><a href="mailto:${encodeURIComponent(order.customerEmail)}" class="admin-customer-email">${Store.escapeHtml(order.customerEmail)}</a></div>
          <div class="admin-order-controls">${statusOptions(order)}<strong>${Store.formatMoney(order.totalPaise)}</strong></div>
        </div>
        <p class="admin-payment-info">Payment: ${Store.escapeHtml(order.paymentMethod === "razorpay" ? "Razorpay online" : "Cash on delivery")} · ${Store.escapeHtml(order.paymentStatus)}</p>
        <ul class="admin-order-items">${order.items.map((item) => `<li>${Store.escapeHtml(item.productName)} <span>× ${item.quantity} · ${Store.formatMoney(item.pricePaise)}</span></li>`).join("")}</ul>
        <p class="admin-address"><strong>Deliver to:</strong> ${Store.escapeHtml(order.shippingName)} — ${Store.escapeHtml(order.shippingAddress)}</p>
        ${order.trackingCode ? `<p class="admin-payment-info">Tracking: ${Store.escapeHtml(order.trackingCarrier || "Carrier")} · ${Store.escapeHtml(order.trackingCode)}</p>` : ""}
        ${order.status === "processing" || order.status === "shipped" ? `<div class="tracking-fields"><input aria-label="Order ${order.id} carrier" data-carrier="${order.id}" placeholder="Courier name" value="${Store.escapeHtml(order.trackingCarrier || "")}"><input aria-label="Order ${order.id} tracking code" data-tracking="${order.id}" placeholder="Tracking/AWB number" value="${Store.escapeHtml(order.trackingCode || "")}"></div>` : ""}
        ${order.couponCode ? `<p class="admin-payment-info">Coupon: ${Store.escapeHtml(order.couponCode)} · Discount ${Store.formatMoney(order.discountPaise)}</p>` : ""}
      </article>`).join("")}</div>`;
  }

  function renderSellers() {
    return `<div class="admin-orders">${sellers.map((seller) => `
      <article class="admin-order-card">
        <div class="admin-order-top">
          <div><p class="product-category">${seller.platformOwned ? "Platform catalog" : `Seller #${seller.id} · ${new Date(seller.createdAt + " UTC").toLocaleDateString(undefined, { dateStyle: "medium" })}`}</p>
            <strong>${Store.escapeHtml(seller.storeName)}</strong>
            <span class="admin-customer-email">${Store.escapeHtml(seller.ownerName)} · ${Store.escapeHtml(seller.ownerEmail)} · +91 ${Store.escapeHtml(seller.phone)}</span>
            ${seller.gstin ? `<span class="admin-customer-email">GSTIN: ${Store.escapeHtml(seller.gstin)}</span>` : ""}
          </div>
          <div class="admin-order-controls"><span class="order-status">${Store.escapeHtml(seller.status)}</span>
            ${!seller.platformOwned && seller.status === "pending" ? `<button class="text-button" type="button" data-seller-status="${seller.id}" data-status="active">Approve</button><button class="text-button admin-delete" type="button" data-seller-status="${seller.id}" data-status="rejected">Reject</button>` : ""}
            ${!seller.platformOwned && seller.status === "active" ? `<button class="text-button admin-delete" type="button" data-seller-status="${seller.id}" data-status="suspended">Suspend</button>` : ""}
            ${!seller.platformOwned && seller.status === "suspended" ? `<button class="text-button" type="button" data-seller-status="${seller.id}" data-status="active">Reactivate</button>` : ""}
          </div>
        </div>
        ${!seller.platformOwned ? `<div class="seller-payout-row"><span>Ready for manual payout: <strong>${Store.formatMoney(seller.pendingPaise)}</strong></span>
          <button class="button button-dark" type="button" data-seller-payout="${seller.id}" ${seller.pendingPaise < 1 || seller.status !== "active" ? "disabled" : ""}>Record bank transfer</button></div>` : ""}
      </article>`).join("") || '<p class="empty-admin">No seller applications yet.</p>'}</div>`;
  }

  function renderReviews() {
    if (!reviews.length) return '<p class="empty-admin">No product reviews yet.</p>';
    return `<div class="admin-orders">${reviews.map((review) => `<article class="admin-order-card review-admin-card">
      <div><p class="product-category">${Store.escapeHtml(review.productName)} · ${"★".repeat(review.rating)}</p>
      <strong>${Store.escapeHtml(review.reviewerName)}</strong><p class="admin-note">${Store.escapeHtml(review.body)}</p>
      ${review.hasImage ? `<img class="admin-review-image" src="/api/admin/reviews/${review.id}/image" alt="Customer photo for ${Store.escapeHtml(review.productName)}" loading="lazy">` : ""}</div>
      <span class="order-status">${Store.escapeHtml(review.status)}</span>
      <button class="text-button" type="button" data-review-status="${review.id}" data-status="${review.status === "approved" ? "hidden" : "approved"}">${review.status === "approved" ? "Hide review" : "Approve review"}</button>
    </article>`).join("")}</div>`;
  }

  function renderReturns() {
    if (!returnRequests.length) return '<p class="empty-admin">No customer return requests.</p>';
    return `<div class="admin-orders">${returnRequests.map((request) => `<article class="admin-order-card">
      <div class="admin-order-top"><div><p class="product-category">Return request · Order #${request.orderId} · ${new Date(request.createdAt + " UTC").toLocaleDateString(undefined, { dateStyle: "medium" })}</p>
      <strong>${Store.escapeHtml(request.customerName)} · ${Store.escapeHtml(request.customerEmail)}</strong><p class="admin-note">${Store.escapeHtml(request.reason)}</p></div>
      <div class="admin-order-controls"><span class="order-status">${Store.escapeHtml(request.status)}</span>
      ${request.status === "pending" ? `<button class="text-button" type="button" data-return-status="${request.id}" data-status="approved">Approve</button><button class="text-button admin-delete" type="button" data-return-status="${request.id}" data-status="rejected">Reject</button>` : ""}
      ${request.status === "approved" ? `<button class="text-button" type="button" data-return-status="${request.id}" data-status="refunded">Mark external refund complete</button>` : ""}</div>
      </div><p class="admin-payment-info">Order total ${Store.formatMoney(request.totalPaise)} · ${Store.escapeHtml(request.paymentMethod === "razorpay" ? "Online payment" : "Cash on delivery")}. Process any refund through the payment provider or bank before marking it complete.</p>
    </article>`).join("")}</div>`;
  }

  function renderDashboard(user) {
    const revenue = orders.filter((order) => order.paymentStatus === "paid").reduce((sum, order) => sum + order.totalPaise, 0);
    const lowStock = products.filter((product) => product.stock <= 5).length;
    root.innerHTML = `
      <div class="admin-heading"><div><p class="eyebrow">Store administration</p><h1 class="page-title">Good morning, ${Store.escapeHtml(user.name.split(" ")[0])}<span>.</span></h1><p class="account-intro">Products, inventory, and customer orders in one place.</p></div><button class="text-button" id="admin-sign-out" type="button">Sign out ↗</button></div>
      <section class="admin-stats">
        <article><span>Orders</span><strong>${orders.length}</strong></article>
        <article><span>Payments collected</span><strong>${Store.formatMoney(revenue)}</strong></article>
        <article><span>Products</span><strong>${products.length}</strong></article>
        <article><span>Low stock · 5 or fewer</span><strong>${lowStock}</strong></article>
      </section>
      <section class="admin-section">
        <div class="admin-section-heading"><div><p class="eyebrow">Marketplace</p><h2>Seller applications &amp; payouts</h2></div></div>
        <form class="commission-form" id="commission-form"><label>Marketplace commission (%)
          <input name="percent" type="number" min="0" max="50" step="0.01" value="${(commissionBasisPoints / 100).toFixed(2)}" required>
        </label><button class="button button-dark" type="submit">Save commission</button></form>
        <p class="admin-note">Commission is locked into each new order. Payouts are manual: transfer the shown amount through your bank first, then record its UTR/reference here. Seller bank details are collected outside this demo.</p>
        ${renderSellers()}
      </section>
      <section class="admin-section">
        <div class="admin-section-heading"><div><p class="eyebrow">Promotions</p><h2>Coupons</h2></div></div>
        <form class="commission-form" id="coupon-form">
          <label>Coupon code<input name="code" maxlength="32" pattern="[A-Za-z0-9_-]{3,32}" required></label>
          <label>Discount (%)<input name="percent" type="number" min="0.01" max="100" step="0.01" required></label>
          <label>Minimum order (₹)<input name="minimum" type="number" min="0" step="0.01" value="0" required></label>
          <label>Max discount (₹)<input name="maximum" type="number" min="0.01" step="0.01"></label>
          <label>Use limit<input name="limit" type="number" min="1" step="1"></label>
          <label>Expires<input name="expires" type="date"></label>
          <button class="button button-dark" type="submit">Create coupon</button>
        </form>
        <div id="coupon-list"></div>
      </section>
      <section class="admin-section">
        <div class="admin-section-heading"><div><p class="eyebrow">Catalog</p><h2>Manage products</h2></div></div>
        <form id="product-form" class="admin-product-form">
          <input type="hidden" name="id">
          <label>Product name<input name="name" minlength="2" maxlength="120" required></label>
          <label>SKU / barcode<input name="sku" maxlength="40" pattern="[A-Za-z0-9_-]{2,40}" placeholder="Optional unique code"></label>
          <div class="admin-description-field" id="product-category-selectors">${categorySelectMarkup()}</div>
          <label>Price (INR)<input name="price" type="number" min="0.01" max="1000000" step="0.01" required></label>
          <label>Stock<input name="stock" type="number" min="0" max="1000000" step="1" required></label>
          <label class="admin-image-field">Image URL (HTTPS)<input name="imageUrl" type="url" maxlength="500" placeholder="https://…" required></label>
          <label class="admin-description-field">Other product images (up to 8)<textarea name="productImages" maxlength="5000" rows="4" placeholder="general | Back view | https://example.com/back-view.jpg"></textarea><span class="field-hint">One per line: profile | view angle | HTTPS image URL. Profiles: general, male-slim/average/athletic/plus, female-petite/average/curvy/plus, kids-2-4/5-8/9-12/13-16. Use seller-provided model photos; do not upload customer photos.</span></label>
          <label class="admin-description-field">Description<textarea name="description" minlength="10" maxlength="2000" rows="3" required></textarea></label>
          <label class="admin-featured-field"><input name="featured" type="checkbox"> Feature this product</label>
          <div class="admin-form-actions"><button class="button button-dark" type="submit" id="product-submit">Add product</button><button class="text-button hidden" type="button" id="cancel-edit">Cancel edit</button></div>
        </form>
        <div id="product-list">${renderProductRows()}</div>
      </section>
      <section class="admin-section">
        <div class="admin-section-heading"><div><p class="eyebrow">Catalog structure</p><h2>Categories and subcategories</h2></div></div>
        <p class="admin-note">Products are assigned to an active leaf category. Categories with products or subcategories cannot be deleted; deactivate them or safely reassign their products first.</p>
        <div id="category-management">${renderCategoryManagement()}</div>
      </section>
      <section class="admin-section">
        <div class="admin-section-heading"><div><p class="eyebrow">Trust &amp; safety</p><h2>Product reviews</h2></div></div>
        ${renderReviews()}
      </section>
      <section class="admin-section">
        <div class="admin-section-heading"><div><p class="eyebrow">After-sales</p><h2>Return requests</h2></div></div>
        <p class="admin-note">Approve or reject a request after reviewing it. Refunds are processed externally; only mark refunded after you have completed the transfer/refund.</p>
        ${renderReturns()}
      </section>
      <section class="admin-section">
        <div class="admin-section-heading"><div><p class="eyebrow">Fulfillment</p><h2>Customer orders</h2></div></div>
        <p class="admin-note">Move orders through processing, shipped, and delivered. Cancelling an unshipped order returns its items to inventory. Before cancelling a pending online payment, check its status in Razorpay first.</p>
        <div id="order-list">${renderOrderRows()}</div>
      </section>`;

    document.getElementById("admin-sign-out").addEventListener("click", async () => {
      try {
        await Store.apiRequest("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
        renderLogin();
      } catch (error) {
        Store.showNotice(notice, error.message);
      }
    });
  }

  function clearProductForm() {
    const form = document.getElementById("product-form");
    form.reset();
    form.elements.id.value = "";
    setProductCategory(null);
    document.getElementById("product-submit").textContent = "Add product";
    document.getElementById("cancel-edit").classList.add("hidden");
  }

  async function loadDashboard(user) {
    const data = await Store.apiRequest("/api/admin/overview");
    products = data.products;
    categories = data.categories;
    orders = data.orders;
    sellers = data.sellers;
    reviews = data.reviews;
    returnRequests = data.returnRequests;
    commissionBasisPoints = data.commissionBasisPoints;
    renderDashboard(user);
    await loadCoupons();
  }

  async function loadCoupons() {
    const coupons = await Store.apiRequest("/api/admin/coupons");
    const list = document.getElementById("coupon-list");
    if (!list) return;
    list.innerHTML = coupons.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Code</th><th>Discount</th><th>Uses</th><th>Expires</th><th>State</th><th>Action</th></tr></thead><tbody>
      ${coupons.map((coupon) => `<tr><td>${Store.escapeHtml(coupon.code)}</td><td>${(coupon.discountBasisPoints / 100).toFixed(2)}%</td>
      <td>${coupon.usageCount}${coupon.usageLimit ? ` / ${coupon.usageLimit}` : ""}</td><td>${Store.escapeHtml(coupon.expiresAt || "Never")}</td>
      <td>${coupon.active ? "Active" : "Disabled"}</td><td><button class="text-button" type="button" data-coupon-toggle="${coupon.id}" data-active="${coupon.active ? "false" : "true"}">${coupon.active ? "Disable" : "Enable"}</button></td></tr>`).join("")}
    </tbody></table></div>` : '<p class="empty-admin">No coupons created yet.</p>';
  }

  root.addEventListener("submit", async (event) => {
    if (event.target.id === "admin-login-form") {
      event.preventDefault();
      const form = event.target;
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        const result = await Store.apiRequest("/api/admin/login", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
        });
        await loadDashboard(result.user);
      } catch (error) {
        Store.showNotice(notice, error.message);
        button.disabled = false;
      }
      return;
    }
    if (event.target.id === "commission-form") {
      event.preventDefault();
      const form = event.target;
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        const result = await Store.apiRequest("/api/admin/settings/commission", {
          method: "PATCH",
          body: JSON.stringify({ percent: Number(new FormData(form).get("percent")) })
        });
        commissionBasisPoints = result.commissionBasisPoints;
        Store.showNotice(notice, "New seller commission saved. Existing orders are unchanged.", "success");
        await reloadFromCurrentUser();
      } catch (error) {
        Store.showNotice(notice, error.message);
        button.disabled = false;
      }
      return;
    }
    if (event.target.id === "coupon-form") {
      event.preventDefault();
      const form = event.target;
      const data = new FormData(form);
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        await Store.apiRequest("/api/admin/coupons", {
          method: "POST",
          body: JSON.stringify({
            code: data.get("code"),
            percent: Number(data.get("percent")),
            minOrderPaise: Math.round(Number(data.get("minimum")) * 100),
            maxDiscountPaise: data.get("maximum") ? Math.round(Number(data.get("maximum")) * 100) : null,
            usageLimit: data.get("limit") ? Number(data.get("limit")) : null,
            expiresAt: data.get("expires") || null
          })
        });
        form.reset();
        Store.showNotice(notice, "Coupon created.", "success");
        await loadCoupons();
      } catch (error) {
        Store.showNotice(notice, error.message);
      } finally {
        button.disabled = false;
      }
      return;
    }
    if (event.target.id === "category-form") {
      event.preventDefault();
      const form = event.target;
      const data = new FormData(form);
      const id = form.elements.id.value;
      const button = document.getElementById("category-submit");
      button.disabled = true;
      try {
        const body = {
          name: data.get("name"),
          slug: data.get("slug"),
          parentId: data.get("parentId") ? Number(data.get("parentId")) : null,
          description: data.get("description"),
          imageUrl: data.get("imageUrl"),
          displayOrder: Number(data.get("displayOrder"))
        };
        await Store.apiRequest(id ? `/api/admin/categories/${id}` : "/api/admin/categories", {
          method: id ? "PATCH" : "POST",
          body: JSON.stringify(body)
        });
        Store.showNotice(notice, id ? "Category updated." : "Category created.", "success");
        await reloadFromCurrentUser();
      } catch (error) {
        Store.showNotice(notice, error.message);
        button.disabled = false;
      }
      return;
    }
    if (event.target.id !== "product-form") return;
    event.preventDefault();
    const form = event.target;
    const button = document.getElementById("product-submit");
    const productId = form.elements.id.value;
    button.disabled = true;
    try {
      const data = new FormData(form);
      const body = {
        name: data.get("name"),
        sku: data.get("sku"),
        categoryId: Number(data.get("categoryId")),
        description: data.get("description"),
        imageUrl: data.get("imageUrl"),
        productImages: data.get("productImages"),
        pricePaise: Math.round(Number(data.get("price")) * 100),
        stock: Number(data.get("stock")),
        featured: data.get("featured") === "on"
      };
      await Store.apiRequest(productId ? `/api/admin/products/${productId}` : "/api/admin/products", {
        method: productId ? "PUT" : "POST",
        body: JSON.stringify(body)
      });
      Store.showNotice(notice, productId ? "Product updated." : "Product added to the catalog.", "success");
      await reloadFromCurrentUser();
    } catch (error) {
      Store.showNotice(notice, error.message);
      button.disabled = false;
    }
  });

  root.addEventListener("click", async (event) => {
    if (event.target.id === "cancel-edit") {
      clearProductForm();
      return;
    }
    if (event.target.id === "category-edit-cancel") {
      const form = document.getElementById("category-form");
      form.reset();
      form.elements.id.value = "";
      form.elements.displayOrder.value = "0";
      document.getElementById("category-submit").textContent = "Add category";
      event.target.classList.add("hidden");
      return;
    }
    const editButton = event.target.closest("[data-edit-product]");
    if (editButton) {
      const product = products.find((item) => item.id === Number(editButton.dataset.editProduct));
      if (!product) return;
      const form = document.getElementById("product-form");
      form.elements.id.value = String(product.id);
      form.elements.name.value = product.name;
      form.elements.sku.value = product.sku || "";
      setProductCategory(product.categoryId);
      form.elements.description.value = product.description;
      form.elements.imageUrl.value = product.imageUrl;
      form.elements.productImages.value = (product.productImages || (product.additionalImageUrls || []).map((imageUrl) => ({ imageUrl, modelProfile: "general", viewLabel: "Other view" })))
        .map((image) => `${image.modelProfile || "general"} | ${image.viewLabel || "Other view"} | ${image.imageUrl}`).join("\n");
      form.elements.price.value = (product.pricePaise / 100).toFixed(2);
      form.elements.stock.value = String(product.stock);
      form.elements.featured.checked = Boolean(product.featured);
      document.getElementById("product-submit").textContent = "Save product";
      document.getElementById("cancel-edit").classList.remove("hidden");
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const editCategory = event.target.closest("[data-edit-category]");
    if (editCategory) {
      const category = flattenCategories(categories).find((item) => item.id === Number(editCategory.dataset.editCategory));
      if (!category) return;
      const form = document.getElementById("category-form");
      form.elements.id.value = String(category.id);
      form.elements.name.value = category.name;
      form.elements.slug.value = category.slug;
      form.elements.parentId.value = category.parentId || "";
      form.elements.displayOrder.value = String(category.displayOrder);
      form.elements.description.value = category.description || "";
      form.elements.imageUrl.value = category.imageUrl || "";
      document.getElementById("category-submit").textContent = "Save category";
      document.getElementById("category-edit-cancel").classList.remove("hidden");
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const categoryActive = event.target.closest("[data-category-active]");
    if (categoryActive) {
      categoryActive.disabled = true;
      try {
        await Store.apiRequest(`/api/admin/categories/${categoryActive.dataset.categoryActive}`, {
          method: "PATCH",
          body: JSON.stringify({ active: categoryActive.dataset.active === "true" })
        });
        Store.showNotice(notice, "Category status updated.", "success");
        await reloadFromCurrentUser();
      } catch (error) {
        Store.showNotice(notice, error.message);
        categoryActive.disabled = false;
      }
      return;
    }
    const deleteCategory = event.target.closest("[data-delete-category]");
    if (deleteCategory) {
      if (!window.confirm("Delete this category? Categories with products or subcategories cannot be deleted.")) return;
      deleteCategory.disabled = true;
      try {
        await Store.apiRequest(`/api/admin/categories/${deleteCategory.dataset.deleteCategory}`, { method: "DELETE" });
        Store.showNotice(notice, "Category deleted.", "success");
        await reloadFromCurrentUser();
      } catch (error) {
        Store.showNotice(notice, error.message);
        deleteCategory.disabled = false;
      }
      return;
    }
    const deleteButton = event.target.closest("[data-delete-product]");
    if (deleteButton) {
      const productId = deleteButton.dataset.deleteProduct;
      if (!window.confirm("Delete this product from the catalog?")) return;
      deleteButton.disabled = true;
      try {
        await Store.apiRequest(`/api/admin/products/${productId}`, { method: "DELETE" });
        Store.showNotice(notice, "Product deleted.", "success");
        await reloadFromCurrentUser();
      } catch (error) {
        Store.showNotice(notice, error.message);
        deleteButton.disabled = false;
      }
      return;
    }
    const updateButton = event.target.closest("[data-update-order]");
    if (updateButton) {
      const orderId = updateButton.dataset.updateOrder;
      const select = root.querySelector(`[data-order-status="${orderId}"]`);
      if (!select || !select.value) return;
      updateButton.disabled = true;
      try {
        const carrier = root.querySelector(`[data-carrier="${orderId}"]`);
        const tracking = root.querySelector(`[data-tracking="${orderId}"]`);
        await Store.apiRequest(`/api/admin/orders/${orderId}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: select.value,
            trackingCarrier: carrier ? carrier.value : "",
            trackingCode: tracking ? tracking.value : ""
          })
        });
        Store.showNotice(notice, `Order #${orderId} updated.`, "success");
        await reloadFromCurrentUser();
      } catch (error) {
        Store.showNotice(notice, error.message);
        updateButton.disabled = false;
      }
      return;
    }
    const sellerStatus = event.target.closest("[data-seller-status]");
    if (sellerStatus) {
      sellerStatus.disabled = true;
      try {
        await Store.apiRequest(`/api/admin/sellers/${sellerStatus.dataset.sellerStatus}`, {
          method: "PATCH",
          body: JSON.stringify({ status: sellerStatus.dataset.status })
        });
        Store.showNotice(notice, `Seller ${sellerStatus.dataset.status}.`, "success");
        await reloadFromCurrentUser();
      } catch (error) {
        Store.showNotice(notice, error.message);
        sellerStatus.disabled = false;
      }
      return;
    }
    const payoutButton = event.target.closest("[data-seller-payout]");
    if (payoutButton) {
      const reference = window.prompt("Enter the completed bank transfer UTR/reference. Transfer the amount shown before recording it.");
      if (!reference) return;
      payoutButton.disabled = true;
      try {
        await Store.apiRequest(`/api/admin/sellers/${payoutButton.dataset.sellerPayout}/payouts`, {
          method: "POST",
          body: JSON.stringify({ reference })
        });
        Store.showNotice(notice, "Manual seller payout recorded.", "success");
        await reloadFromCurrentUser();
      } catch (error) {
        Store.showNotice(notice, error.message);
        payoutButton.disabled = false;
      }
      return;
    }
    const reviewButton = event.target.closest("[data-review-status]");
    if (reviewButton) {
      reviewButton.disabled = true;
      try {
        await Store.apiRequest(`/api/admin/reviews/${reviewButton.dataset.reviewStatus}`, {
          method: "PATCH",
          body: JSON.stringify({ status: reviewButton.dataset.status })
        });
        Store.showNotice(notice, "Review moderation updated.", "success");
        await reloadFromCurrentUser();
      } catch (error) {
        Store.showNotice(notice, error.message);
        reviewButton.disabled = false;
      }
      return;
    }
    const returnButton = event.target.closest("[data-return-status]");
    if (returnButton) {
      returnButton.disabled = true;
      try {
        await Store.apiRequest(`/api/admin/returns/${returnButton.dataset.returnStatus}`, {
          method: "PATCH",
          body: JSON.stringify({ status: returnButton.dataset.status })
        });
        Store.showNotice(notice, `Return request ${returnButton.dataset.status}.`, "success");
        await reloadFromCurrentUser();
      } catch (error) {
        Store.showNotice(notice, error.message);
        returnButton.disabled = false;
      }
      return;
    }
    const couponButton = event.target.closest("[data-coupon-toggle]");
    if (couponButton) {
      couponButton.disabled = true;
      try {
        await Store.apiRequest(`/api/admin/coupons/${couponButton.dataset.couponToggle}`, {
          method: "PATCH",
          body: JSON.stringify({ active: couponButton.dataset.active === "true" })
        });
        Store.showNotice(notice, "Coupon state updated.", "success");
        await loadCoupons();
      } catch (error) {
        Store.showNotice(notice, error.message);
        couponButton.disabled = false;
      }
    }
  });

  root.addEventListener("change", (event) => {
    const select = event.target.closest("[data-category-level]");
    if (select) setProductCategory(Number(select.value) || null);
  });

  async function reloadFromCurrentUser() {
    const session = await Store.getSession();
    clearProductFormIfPresent();
    await loadDashboard(session.user);
  }

  function clearProductFormIfPresent() {
    if (document.getElementById("product-form")) clearProductForm();
  }

  async function start() {
    try {
      const session = await Store.getSession();
      if (session.user?.role === "admin") await loadDashboard(session.user);
      else renderLogin();
    } catch (error) {
      Store.showNotice(notice, error.message);
    }
  }

  start();
})();

(() => {
  const root = document.getElementById("seller-view");
  const notice = document.getElementById("seller-notice");
  let dashboard;

  function sellerCategoryOptions(selectedId = "") {
    return `<option value="">Choose a category</option>${(dashboard?.categories || []).map((category) =>
      `<option value="${category.id}" ${category.id === Number(selectedId) ? "selected" : ""}>${Store.escapeHtml(category.pathLabel)}</option>`
    ).join("")}`;
  }

  function renderApplication(user) {
    root.innerHTML = `
      <section class="account-card seller-application">
        <p class="eyebrow">Join our marketplace</p><h1>Open your store<span>.</span></h1>
        <p class="account-intro">Use your regular customer account—no administrator account is needed. Apply with your shop details; the platform administrator must approve your application before products can be listed.</p>
        ${user ? `<form id="seller-application-form" class="checkout-form">
          <label>Store name<input name="storeName" minlength="2" maxlength="100" required></label>
          <label>Indian mobile number<input name="phone" type="tel" inputmode="numeric" pattern="[6-9][0-9]{9}" maxlength="10" placeholder="10-digit number" required></label>
          <label>GSTIN <span class="field-hint">Optional for this demo; confirm applicable tax registration with an advisor.</span><input name="gstin" maxlength="15" pattern="[0-9A-Za-z]{15}" autocomplete="off"></label>
          <button class="button button-dark" type="submit">Submit seller application</button>
        </form>` : '<p>Sign in or create a customer account before applying as a seller.</p><a class="button button-dark" href="/account.html?next=seller">Sign in / create account</a>'}
      </section>`;
  }

  function renderStatus(status, user) {
    root.innerHTML = `<section class="account-card seller-status"><p class="eyebrow">Seller application</p><h1>Application ${Store.escapeHtml(status)}<span>.</span></h1>
      <p class="account-intro">${status === "pending" ? "The store administrator will review your application. Your seller tools will become available after approval." : `Your seller account is currently ${Store.escapeHtml(status)}. Contact the store administrator if you need help.`}</p>
      ${status === "rejected" && user ? '<button class="button button-dark" id="seller-reapply" type="button">Update details and reapply</button>' : ""}
      <a class="text-button" href="/">Return to the shop ↗</a></section>`;
    const reapplyButton = document.getElementById("seller-reapply");
    if (reapplyButton) reapplyButton.addEventListener("click", () => renderApplication(user));
  }

  function renderProducts() {
    if (!dashboard.products.length) return '<p class="empty-admin">No products listed yet.</p>';
    return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead><tbody>
      ${dashboard.products.map((product) => `<tr><td><div class="admin-product"><img src="${Store.escapeHtml(product.imageUrl)}" alt=""><div>      <strong>${Store.escapeHtml(product.name)}</strong><span>${Store.escapeHtml(product.categoryPathLabel || product.category)}</span></div></div></td>
      <td>${Store.formatMoney(product.pricePaise)}</td><td>${product.stock}</td><td class="admin-row-actions"><button class="text-button" type="button" data-seller-edit="${product.id}">Edit</button><button class="text-button admin-delete" type="button" data-seller-delete="${product.id}">Delete</button></td></tr>`).join("")}
    </tbody></table></div>`;
  }

  function renderOrders() {
    if (!dashboard.orders.length) return '<p class="empty-admin">Orders containing your products will appear here.</p>';
    return `<div class="admin-orders">${dashboard.orders.map((order) => `<article class="admin-order-card">
      <div class="admin-order-top"><div><p class="product-category">Order #${order.id} · ${new Date(order.createdAt + " UTC").toLocaleDateString(undefined, { dateStyle: "medium" })}</p>
      <strong>${Store.escapeHtml(order.status)}</strong></div><div class="admin-order-controls"><span class="order-status">${Store.escapeHtml(order.paymentStatus)}</span></div></div>
      <ul class="admin-order-items">${order.items.map((item) => `<li>${Store.escapeHtml(item.productName)} <span>× ${item.quantity} · Seller earnings ${Store.formatMoney(item.sellerPayoutPaise)}</span></li>`).join("")}</ul>
      <p class="admin-payment-info">Payment: ${Store.escapeHtml(order.paymentMethod === "razorpay" ? "Online" : "Cash on delivery")} · Order status: ${Store.escapeHtml(order.orderStatus)}</p>
      ${order.trackingCode ? `<p class="admin-payment-info">Tracking: ${Store.escapeHtml(order.trackingCarrier || "Carrier")} · ${Store.escapeHtml(order.trackingCode)}</p>` : ""}
      <p class="admin-address"><strong>Delivery:</strong> ${Store.escapeHtml(order.shippingName)} — ${Store.escapeHtml(order.shippingAddress)}</p>
      ${order.status === "pending_payment" ? '<p class="admin-note">Waiting for online payment confirmation before fulfillment.</p>' : ""}
      ${order.status === "placed" ? `<button class="button button-dark" type="button" data-seller-fulfillment="${order.id}" data-next-status="processing">Start processing</button>` : ""}
      ${order.status === "processing" ? `<div class="seller-fulfillment-controls"><input data-seller-carrier="${order.id}" maxlength="100" placeholder="Courier name" value="${Store.escapeHtml(order.trackingCarrier || "")}"><input data-seller-tracking="${order.id}" maxlength="100" placeholder="Tracking / AWB number" value="${Store.escapeHtml(order.trackingCode || "")}"><button class="button button-dark" type="button" data-seller-fulfillment="${order.id}" data-next-status="shipped">Mark shipped</button></div>` : ""}
      ${order.status === "shipped" ? `<button class="button button-dark" type="button" data-seller-fulfillment="${order.id}" data-next-status="delivered">Confirm delivery</button>` : ""}
    </article>`).join("")}</div>`;
  }

  function renderDashboard(data) {
    dashboard = data;
    root.innerHTML = `
      <div class="admin-heading"><div><p class="eyebrow">${Store.escapeHtml(data.seller.storeName)}</p><h1 class="page-title">Seller studio<span>.</span></h1><p class="account-intro">Commission: ${(data.commissionBasisPoints / 100).toFixed(2)}% · payouts are manually transferred by the retailer.</p></div><a class="text-button" href="/">Back to shop ↗</a></div>
      <section class="admin-stats"><article><span>Products</span><strong>${data.products.length}</strong></article><article><span>Awaiting payout</span><strong>${Store.formatMoney(data.pendingPaise)}</strong></article><article><span>Paid out</span><strong>${Store.formatMoney(data.paidPaise)}</strong></article><article><span>Orders</span><strong>${data.orders.length}</strong></article></section>
      <section class="admin-section"><div class="admin-section-heading"><div><p class="eyebrow">Your catalog</p><h2>Manage products</h2></div></div>
        <form id="seller-product-form" class="admin-product-form"><input type="hidden" name="id">
          <label>Product name<input name="name" minlength="2" maxlength="120" required></label><label>SKU / barcode<input name="sku" maxlength="40" pattern="[A-Za-z0-9_-]{2,40}" placeholder="Optional unique code"></label><label>Category<select name="categoryId" required>${sellerCategoryOptions()}</select></label>
          <label>Price (INR)<input name="price" type="number" min="0.01" max="1000000" step="0.01" required></label><label>Stock<input name="stock" type="number" min="0" max="1000000" step="1" required></label>
          <label class="admin-image-field">Image URL (HTTPS)<input name="imageUrl" type="url" maxlength="500" required></label>
          <label class="admin-description-field">Other product images (up to 8)<textarea name="productImages" maxlength="5000" rows="4" placeholder="female-average | Front view | https://example.com/front-view.jpg"></textarea><span class="field-hint">One per line: profile | view angle | HTTPS image URL. Profiles: general, male-slim/average/athletic/plus, female-petite/average/curvy/plus, kids-2-4/5-8/9-12/13-16. Use seller-provided model photos; do not upload customer photos.</span></label>
          <label class="admin-description-field">Description<textarea name="description" minlength="10" maxlength="2000" rows="3" required></textarea></label>
          <div class="admin-form-actions"><button class="button button-dark" id="seller-product-submit" type="submit">Add product</button><button class="text-button hidden" id="seller-edit-cancel" type="button">Cancel edit</button></div>
        </form><div id="seller-products">${renderProducts()}</div>
      </section>
      <section class="admin-section"><div class="admin-section-heading"><div><p class="eyebrow">Fulfillment</p><h2>Your product orders</h2></div></div>
        <p class="admin-note">Process and ship only your own items, add courier tracking, and confirm delivery. Customer delivery details are shown only for orders containing your products; the platform administrator retains overall order oversight.</p>${renderOrders()}
      </section>
      <section class="admin-section"><div class="admin-section-heading"><div><p class="eyebrow">Payout history</p><h2>Bank transfers recorded</h2></div></div>
        <p class="admin-note">Payout entries confirm transfers recorded by the retailer; the marketplace does not initiate bank payments.</p>
        ${data.payouts.length ? `<div class="admin-orders">${data.payouts.map((payout) => `<article class="admin-order-card"><strong>${Store.formatMoney(payout.amountPaise)}</strong><span class="admin-customer-email">Reference ${Store.escapeHtml(payout.reference)} · ${new Date(payout.createdAt + " UTC").toLocaleDateString()}</span></article>`).join("")}</div>` : '<p class="empty-admin">No payouts have been recorded yet.</p>'}
      </section>`;
  }

  function clearForm() {
    const form = document.getElementById("seller-product-form");
    if (!form) return;
    form.reset();
    form.elements.id.value = "";
    document.getElementById("seller-product-submit").textContent = "Add product";
    document.getElementById("seller-edit-cancel").classList.add("hidden");
  }

  async function loadDashboard() {
    const data = await Store.apiRequest("/api/seller/overview");
    renderDashboard(data);
  }

  root.addEventListener("submit", async (event) => {
    if (event.target.id === "seller-application-form") {
      event.preventDefault();
      const form = event.target;
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        const result = await Store.apiRequest("/api/seller/apply", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
        });
        renderStatus(result.status, user);
        Store.showNotice(notice, "Application submitted for admin approval.", "success");
      } catch (error) {
        Store.showNotice(notice, error.message);
        button.disabled = false;
      }
      return;
    }
    if (event.target.id !== "seller-product-form") return;
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const button = document.getElementById("seller-product-submit");
    const id = form.elements.id.value;
    button.disabled = true;
    try {
      const product = {
        name: data.get("name"), sku: data.get("sku"), categoryId: Number(data.get("categoryId")), description: data.get("description"),
        imageUrl: data.get("imageUrl"), productImages: data.get("productImages"), pricePaise: Math.round(Number(data.get("price")) * 100),
        stock: Number(data.get("stock")), featured: false
      };
      await Store.apiRequest(id ? `/api/seller/products/${id}` : "/api/seller/products", {
        method: id ? "PUT" : "POST", body: JSON.stringify(product)
      });
      Store.showNotice(notice, id ? "Product updated." : "Product added.", "success");
      await loadDashboard();
    } catch (error) {
      Store.showNotice(notice, error.message);
      button.disabled = false;
    }
  });

  root.addEventListener("click", async (event) => {
    if (event.target.id === "seller-edit-cancel") {
      clearForm();
      return;
    }
    const fulfillmentButton = event.target.closest("[data-seller-fulfillment]");
    if (fulfillmentButton) {
      fulfillmentButton.disabled = true;
      const orderId = fulfillmentButton.dataset.sellerFulfillment;
      try {
        await Store.apiRequest(`/api/seller/orders/${orderId}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: fulfillmentButton.dataset.nextStatus,
            trackingCarrier: root.querySelector(`[data-seller-carrier="${orderId}"]`)?.value || "",
            trackingCode: root.querySelector(`[data-seller-tracking="${orderId}"]`)?.value || ""
          })
        });
        Store.showNotice(notice, "Order fulfillment updated.", "success");
        await loadDashboard();
      } catch (error) {
        Store.showNotice(notice, error.message);
        fulfillmentButton.disabled = false;
      }
      return;
    }
    const editButton = event.target.closest("[data-seller-edit]");
    if (editButton) {
      const product = dashboard.products.find((item) => item.id === Number(editButton.dataset.sellerEdit));
      if (!product) return;
      const form = document.getElementById("seller-product-form");
      form.elements.id.value = String(product.id);
      form.elements.name.value = product.name;
      form.elements.sku.value = product.sku || "";
      form.elements.categoryId.value = String(product.categoryId);
      form.elements.description.value = product.description;
      form.elements.imageUrl.value = product.imageUrl;
      form.elements.productImages.value = (product.productImages || (product.additionalImageUrls || []).map((imageUrl) => ({ imageUrl, modelProfile: "general", viewLabel: "Other view" })))
        .map((image) => `${image.modelProfile || "general"} | ${image.viewLabel || "Other view"} | ${image.imageUrl}`).join("\n");
      form.elements.price.value = (product.pricePaise / 100).toFixed(2);
      form.elements.stock.value = String(product.stock);
      document.getElementById("seller-product-submit").textContent = "Save product";
      document.getElementById("seller-edit-cancel").classList.remove("hidden");
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const deleteButton = event.target.closest("[data-seller-delete]");
    if (!deleteButton || !window.confirm("Delete this product from your catalog?")) return;
    deleteButton.disabled = true;
    try {
      await Store.apiRequest(`/api/seller/products/${deleteButton.dataset.sellerDelete}`, { method: "DELETE" });
      Store.showNotice(notice, "Product removed.", "success");
      await loadDashboard();
    } catch (error) {
      Store.showNotice(notice, error.message);
      deleteButton.disabled = false;
    }
  });

  async function start() {
    try {
      const session = await Store.getSession();
      if (!session.user) {
        renderApplication(null);
        return;
      }
      try {
        await loadDashboard();
      } catch (error) {
        if (error.message.includes("Submit a seller application")) renderApplication(session.user);
        else if (error.message.startsWith("Your seller account is")) renderStatus(error.message.replace("Your seller account is ", "").replace(/\.$/, ""), session.user);
        else if (error.message === "An approved seller account is required.") renderStatus("suspended", session.user);
        else throw error;
      }
    } catch (error) {
      Store.showNotice(notice, error.message);
    }
  }
  start();
})();

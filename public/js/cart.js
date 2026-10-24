(() => {
  const cartLayout = document.getElementById("cart-layout");
  const notice = document.getElementById("cart-notice");
  let session;
  let paymentOptions;
  let products = [];
  let savedAddresses = [];
  let appliedCoupon = "";
  let couponQuote = null;

  function formatAddress(address) {
    return `${address.line1}${address.line2 ? `, ${address.line2}` : ""}, ${address.city}, ${address.state} ${address.postalCode} · Phone: +91 ${address.phone}`;
  }

  async function loadCart() {
    const cart = Store.getCart();
    if (cart.length === 0) {
      cartLayout.innerHTML = '<div class="empty-cart"><span class="empty-bag-icon">✳</span><h2>Your bag is taking a little rest.</h2><p>There’s plenty of room for something lovely.</p><a class="button button-dark" href="/">Find your favorite things</a></div>';
      return;
    }
    try {
      [session, paymentOptions] = await Promise.all([
        Store.getSession(),
        Store.apiRequest("/api/payment-options")
      ]);
      savedAddresses = session.user ? await Store.apiRequest("/api/account/addresses") : [];
      const results = await Promise.all(cart.map((item) => Store.apiRequest(`/api/products/${item.id}`).then((product) => ({ ...product, quantity: item.quantity })).catch(() => null)));
      products = results.filter(Boolean);
      if (products.length !== cart.length) {
        Store.saveCart(products.map(({ id, quantity }) => ({ id, quantity })));
      }
      renderCart();
    } catch (error) {
      cartLayout.innerHTML = `<p class="notice notice-error">${Store.escapeHtml(error.message)}</p>`;
    }
  }

  function renderCart() {
    if (products.length === 0) return loadCart();
    const subtotal = products.reduce((sum, product) => sum + product.pricePaise * product.quantity, 0);
    if (couponQuote && couponQuote.subtotalPaise !== subtotal) {
      couponQuote = null;
      appliedCoupon = "";
    }
    const discount = couponQuote ? couponQuote.discountPaise : 0;
    cartLayout.innerHTML = `
      <section class="cart-items" aria-label="Items in your bag">
        <div class="cart-table-head"><span>Product</span><span>Quantity</span><span>Total</span></div>
        ${products.map((product) => `
          <article class="cart-item">
            <a href="/product.html?id=${product.id}" class="cart-item-image"><img src="${Store.escapeHtml(product.imageUrl)}" alt="${Store.escapeHtml(product.name)}"></a>
            <div class="cart-item-main"><p class="product-category">${Store.escapeHtml(product.category)}</p><a class="product-name" href="/product.html?id=${product.id}">${Store.escapeHtml(product.name)}</a><span class="cart-item-price">${Store.formatMoney(product.pricePaise)}</span>
              <button class="text-button remove-item" type="button" data-remove="${product.id}">Remove</button>
            </div>
            <div class="quantity-control"><button type="button" data-adjust="-1" data-id="${product.id}" aria-label="Decrease quantity">−</button><span>${product.quantity}</span><button type="button" data-adjust="1" data-id="${product.id}" aria-label="Increase quantity" ${product.quantity >= 20 ? "disabled" : ""}>+</button></div>
            <strong class="line-total">${Store.formatMoney(product.pricePaise * product.quantity)}</strong>
          </article>`).join("")}
      </section>
      <aside class="order-summary">
        <h2>Order summary</h2>
        <div class="summary-line"><span>Product total</span><strong>${Store.formatMoney(subtotal)}</strong></div>
        ${discount ? `<div class="summary-line coupon-discount"><span>Coupon ${Store.escapeHtml(appliedCoupon)}</span><strong>− ${Store.formatMoney(discount)}</strong></div>` : ""}
        <div class="summary-line order-total"><span>Order total</span><strong>${Store.formatMoney(subtotal - discount)}</strong></div>
        <p class="shipping-hint">Delivery charges, if applicable, will be confirmed by the store before dispatch.</p>
        ${session.user ? `<form id="coupon-form" class="coupon-form"><label>Coupon code<input name="code" value="${Store.escapeHtml(appliedCoupon)}" maxlength="32" placeholder="Enter coupon code"></label><button class="text-button" type="submit">${couponQuote ? "Update" : "Apply"}</button>${couponQuote ? '<button class="text-button" type="button" id="remove-coupon">Remove</button>' : ""}</form>` : ""}
        ${session.user ? checkoutForm(session.user) : '<div class="sign-in-prompt"><p>Sign in to finish your order.</p><a class="button button-dark full-button" href="/account.html?next=cart">Sign in or create an account</a></div>'}
      </aside>`;
  }

  function checkoutForm(user) {
    const defaultAddress = savedAddresses.find((address) => address.isDefault) || savedAddresses[0];
    const shippingAddress = defaultAddress ? formatAddress(defaultAddress) : "";
    const razorpayChoice = paymentOptions.razorpayEnabled
      ? `<label class="payment-choice"><input type="radio" name="paymentMethod" value="razorpay"><span><strong>Pay online</strong><small>UPI, cards, netbanking &amp; more via Razorpay</small></span></label>`
      : `<label class="payment-choice payment-unavailable"><input type="radio" name="paymentMethod" value="razorpay" disabled><span><strong>Pay online</strong><small>Razorpay merchant keys are not configured yet</small></span></label>`;
    return `<form id="checkout-form" class="checkout-form">
      ${savedAddresses.length ? `<label>Saved address<select id="saved-address-select"><option value="">Choose an address</option>${savedAddresses.map((address) => `<option value="${address.id}" ${address.id === defaultAddress.id ? "selected" : ""}>${Store.escapeHtml(address.recipientName)} · ${Store.escapeHtml(address.city)}, ${Store.escapeHtml(address.postalCode)}</option>`).join("")}</select></label>` : `<p class="field-hint">Save delivery addresses in <a class="text-button" href="/account.html">your account</a> for faster checkout.</p>`}
      <label>Deliver to<input name="shippingName" id="shipping-name" value="${Store.escapeHtml(defaultAddress ? defaultAddress.recipientName : user.name)}" maxlength="100" required></label>
      <label>Delivery address<textarea name="shippingAddress" id="shipping-address" rows="3" maxlength="300" placeholder="House/flat, street, city, state, PIN code" required>${Store.escapeHtml(shippingAddress)}</textarea></label>
      <fieldset class="payment-methods"><legend>Payment method</legend>
        <label class="payment-choice"><input type="radio" name="paymentMethod" value="cash_on_delivery" checked><span><strong>Cash on delivery</strong><small>Pay the delivery person when your order arrives</small></span></label>
        ${razorpayChoice}
      </fieldset>
      <button class="button button-dark full-button" type="submit" id="checkout-button">Place COD order <span aria-hidden="true">↗</span></button>
      <p class="secure-note">All product prices and online payments are in Indian rupees (INR).</p>
    </form>`;
  }

  function finishOrder(order, paymentMethod) {
    Store.saveCart([]);
    cartLayout.innerHTML = `<div class="order-success"><span class="empty-bag-icon">✳</span><p class="eyebrow">Order #${order.id}</p><h2>That’s a good choice.</h2><p>${paymentMethod === "razorpay" ? "Your online payment was verified successfully." : "Pay the delivery person in cash when your order arrives."}</p><a class="button button-dark" href="/account.html">View your orders</a></div>`;
  }

  async function startRazorpayPayment(data, form) {
    if (!paymentOptions.razorpayEnabled || !window.Razorpay) {
      throw new Error("Online payments are unavailable. Please choose cash on delivery.");
    }
    const order = await Store.apiRequest("/api/payments/razorpay/orders", {
      method: "POST",
      body: JSON.stringify({
        shippingName: data.get("shippingName"),
        shippingAddress: data.get("shippingAddress"),
        couponCode: appliedCoupon,
        items: products.map((product) => ({ productId: product.id, quantity: product.quantity }))
      })
    });

    const gateway = new window.Razorpay({
      key: order.razorpayKeyId,
      amount: order.totalPaise,
      currency: "INR",
      name: "Corner Store",
      description: `Order #${order.id}`,
      order_id: order.razorpayOrderId,
      prefill: { name: data.get("shippingName"), email: session.user.email },
      theme: { color: "#526148" },
      handler: async (paymentResult) => {
        const button = document.getElementById("checkout-button");
        if (button) {
          button.disabled = true;
          button.textContent = "Verifying payment…";
        }
        try {
          const verified = await Store.apiRequest("/api/payments/razorpay/verify", {
            method: "POST",
            body: JSON.stringify({ orderId: order.id, ...paymentResult })
          });
          finishOrder(verified, "razorpay");
        } catch (error) {
          Store.showNotice(notice, `${error.message} Your order may still be awaiting payment verification. Check your account or contact the store before paying again.`);
          if (button) {
            button.disabled = false;
            button.textContent = "Retry checkout";
          }
        }
      },
      modal: {
        ondismiss: () => {
          Store.showNotice(notice, `Payment window closed. Order #${order.id} is still awaiting payment. Check your orders before starting another payment.`);
          const button = document.getElementById("checkout-button");
          if (button) {
            button.disabled = false;
            button.textContent = "Try payment again";
          }
        }
      }
    });
    gateway.on("payment.failed", (event) => {
      const message = event.error?.description || "Payment was not completed.";
      Store.showNotice(notice, `${message} Your order is awaiting payment. If money was deducted, contact the store before trying again.`);
      const button = document.getElementById("checkout-button");
      if (button) {
        button.disabled = false;
        button.textContent = "Try payment again";
      }
    });
    gateway.open();
  }

  cartLayout.addEventListener("change", (event) => {
    if (event.target.id === "saved-address-select") {
      const address = savedAddresses.find((item) => String(item.id) === event.target.value);
      if (address) {
        document.getElementById("shipping-name").value = address.recipientName;
        document.getElementById("shipping-address").value = formatAddress(address);
      }
      return;
    }
    if (event.target.name !== "paymentMethod") return;
    const button = document.getElementById("checkout-button");
    if (button) button.innerHTML = event.target.value === "razorpay"
      ? 'Continue to online payment <span aria-hidden="true">↗</span>'
      : 'Place COD order <span aria-hidden="true">↗</span>';
  });

  cartLayout.addEventListener("click", (event) => {
    if (event.target.id === "remove-coupon") {
      appliedCoupon = "";
      couponQuote = null;
      renderCart();
      return;
    }
    const removeButton = event.target.closest("[data-remove]");
    if (removeButton) {
      products = products.filter((product) => product.id !== Number(removeButton.dataset.remove));
      appliedCoupon = "";
      couponQuote = null;
      Store.saveCart(products.map(({ id, quantity }) => ({ id, quantity })));
      if (products.length) renderCart();
      else loadCart();
      return;
    }
    const adjustButton = event.target.closest("[data-adjust]");
    if (!adjustButton) return;
    const product = products.find((item) => item.id === Number(adjustButton.dataset.id));
    if (!product) return;
    const nextQuantity = product.quantity + Number(adjustButton.dataset.adjust);
    if (nextQuantity < 1 || nextQuantity > 20) return;
    product.quantity = nextQuantity;
    appliedCoupon = "";
    couponQuote = null;
    Store.saveCart(products.map(({ id, quantity }) => ({ id, quantity })));
    renderCart();
  });

  cartLayout.addEventListener("submit", async (event) => {
    if (event.target.id === "coupon-form") {
      event.preventDefault();
      const form = event.target;
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        const quote = await Store.apiRequest("/api/coupons/quote", {
          method: "POST",
          body: JSON.stringify({
            code: new FormData(form).get("code"),
            items: products.map((product) => ({ productId: product.id, quantity: product.quantity }))
          })
        });
        couponQuote = quote;
        appliedCoupon = quote.code;
        Store.showNotice(notice, `Coupon applied. You save ${Store.formatMoney(quote.discountPaise)}.`, "success");
        renderCart();
      } catch (error) {
        Store.showNotice(notice, error.message);
        button.disabled = false;
      }
      return;
    }
    if (event.target.id !== "checkout-form") return;
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector("button[type=submit]");
    const data = new FormData(form);
    const method = data.get("paymentMethod");
    button.disabled = true;
    button.textContent = method === "razorpay" ? "Preparing secure payment…" : "Placing your order…";
    notice.classList.add("hidden");
    try {
      if (method === "razorpay") {
        await startRazorpayPayment(data, form);
        return;
      }
      const order = await Store.apiRequest("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          shippingName: data.get("shippingName"),
          shippingAddress: data.get("shippingAddress"),
          couponCode: appliedCoupon,
          items: products.map((product) => ({ productId: product.id, quantity: product.quantity }))
        })
      });
      finishOrder(order, "cash_on_delivery");
    } catch (error) {
      Store.showNotice(notice, error.message);
      button.disabled = false;
      button.innerHTML = method === "razorpay"
        ? 'Continue to online payment <span aria-hidden="true">↗</span>'
        : 'Place COD order <span aria-hidden="true">↗</span>';
    }
  });

  loadCart();
})();

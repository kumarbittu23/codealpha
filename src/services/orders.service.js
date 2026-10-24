const crypto = require("node:crypto");
const ordersRepository = require("../repositories/orders.repository");
const { validateOrderInput, handleOrderError } = require("./marketplace.shared");

function validateCouponQuote(body) {
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const items = body.items;
  if (!/^[A-Z0-9_-]{3,32}$/.test(code) || !Array.isArray(items) || items.length < 1 || items.length > 50) {
    return { error: "Enter a valid coupon code and cart." };
  }
  const quantities = new Map();
  for (const item of items) {
    const id = Number(item?.productId);
    const quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
      return { error: "Cart contains an invalid quantity." };
    }
    quantities.set(id, (quantities.get(id) || 0) + quantity);
  }
  if ([...quantities.values()].some((quantity) => quantity > 20)) {
    return { error: "Maximum quantity is 20 per product." };
  }
  return { value: { code, quantities } };
}

function validateReturnRequest(rawOrderId, rawReason) {
  const id = Number(rawOrderId);
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  if (!Number.isSafeInteger(id) || id < 1) return { error: "Invalid order ID." };
  if (reason.length < 10 || reason.length > 500) {
    return { error: "Describe the return reason in 10–500 characters." };
  }
  return { value: { id, reason } };
}

function validatePaymentDetails(body) {
  const localOrderId = Number(body.orderId);
  const razorpayOrderId = typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : "";
  const razorpayPaymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
  const suppliedSignature = typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";
  if (!Number.isSafeInteger(localOrderId) || localOrderId < 1 || !razorpayOrderId || !razorpayPaymentId || !suppliedSignature) {
    return { error: "Payment verification details are incomplete." };
  }
  return { value: { localOrderId, razorpayOrderId, razorpayPaymentId, suppliedSignature } };
}

function verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, suppliedSignature }) {
  const signature = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest();
  const provided = Buffer.from(suppliedSignature, "hex");
  return provided.length === signature.length && crypto.timingSafeEqual(provided, signature);
}

async function callRazorpayApi(endpoint, options = {}) {
  const credentials = `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`;
  const authorization = Buffer.from(credentials).toString("base64");
  const result = await fetch(`https://api.razorpay.com/v1${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
  const body = await result.json();
  if (!result.ok) {
    console.error("Razorpay API request failed:", body.error?.code || result.status);
    throw new Error("Online payment service could not process the request. Please try cash on delivery or try again.");
  }
  return body;
}

module.exports = {
  validateCouponQuote,
  validateReturnRequest,
  validatePaymentDetails,
  verifyPaymentSignature,
  calculateCartQuote: ordersRepository.calculateCartQuote,
  validateOrderInput,
  saveOrder: ordersRepository.saveOrder,
  handleOrderError,
  callRazorpayApi,
  cancelCustomerOrder: ordersRepository.cancelCustomerOrder,
  findCustomerOrder: ordersRepository.findCustomerOrder,
  createReturnRequest: ordersRepository.createReturnRequest,
  findPaymentOrder: ordersRepository.findPaymentOrder,
  markPaymentCaptured: ordersRepository.markPaymentCaptured
};

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { verifyProviderSignature, verifyCheckoutSignature } = require("../src/services/payment.service");

test("Razorpay provider webhook signature accepts exact raw payload", () => {
  const secret = "test-webhook-secret";
  const rawBody = Buffer.from('{"id":"evt_test","event":"payment.captured"}', "utf8");
  const signature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  assert.equal(verifyProviderSignature(rawBody, signature, secret), true);
});

test("Razorpay provider and checkout signatures reject tampering", () => {
  const secret = "test-provider-secret";
  const rawBody = Buffer.from('{"id":"evt_test","event":"payment.failed"}', "utf8");
  const validSignature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  assert.equal(verifyProviderSignature(rawBody, `${validSignature.slice(0, -1)}0`, secret), false);
  assert.equal(verifyProviderSignature(Buffer.from("tampered"), validSignature, secret), false);

  const checkoutSignature = crypto.createHmac("sha256", secret).update("order_test|pay_test").digest("hex");
  assert.equal(verifyCheckoutSignature("order_test", "pay_test", checkoutSignature, secret), true);
  assert.equal(verifyCheckoutSignature("order_test", "pay_other", checkoutSignature, secret), false);
});

const imageSignatures = {
  "image/jpeg": (imageData) => imageData[0] === 0xff && imageData[1] === 0xd8 && imageData[2] === 0xff,
  "image/png": (imageData) => imageData.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (imageData) => imageData.toString("ascii", 0, 4) === "RIFF" && imageData.toString("ascii", 8, 12) === "WEBP"
};

function validateReview(body) {
  const rating = Number(body.rating);
  const reviewBody = typeof body.body === "string" ? body.body.trim() : "";
  if (!Number.isSafeInteger(rating) || rating < 1 || rating > 5) return { error: "Choose a rating from 1 to 5." };
  if (reviewBody.length < 10 || reviewBody.length > 1500) {
    return { error: "Review must be between 10 and 1,500 characters." };
  }
  const image = validateReviewImage(body.imageData);
  if (image.error) return image;
  return { value: { rating, body: reviewBody, ...image.value } };
}

function validateReviewImage(value) {
  if (value === undefined || value === null || value === "") {
    return { value: { imageMime: null, imageData: null } };
  }
  if (typeof value !== "string" || value.length > 1000000) {
    return { error: "Review image must be a JPEG, PNG, or WebP smaller than 700 KB." };
  }
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return { error: "Upload a JPEG, PNG, or WebP image." };
  const imageData = Buffer.from(match[2], "base64");
  if (imageData.length === 0 || imageData.length > 700 * 1024 || imageData.toString("base64") !== match[2]) {
    return { error: "Review image must be smaller than 700 KB." };
  }
  if (!imageSignatures[match[1]](imageData)) return { error: "The uploaded file does not match its image type." };
  return { value: { imageMime: match[1], imageData: match[2] } };
}

function validateModeration(reviewIdValue, statusValue) {
  const id = Number(reviewIdValue);
  const status = typeof statusValue === "string" ? statusValue : "";
  if (!Number.isSafeInteger(id) || id < 1 || !["approved", "hidden"].includes(status)) {
    return { error: "Provide a valid review ID and moderation status." };
  }
  return { value: { id, status } };
}

module.exports = { validateReview, validateModeration };

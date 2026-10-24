const database = require("../config/database");
const formatRupees = require("../utils/currency");

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function readCategories(includeInactive = false) {
  const rows = database.prepare(`
    SELECT id, name, slug, parent_id AS parentId, description, image_url AS imageUrl,
      active, display_order AS displayOrder
    FROM categories
    ${includeInactive ? "" : "WHERE active = 1"}
    ORDER BY display_order, name COLLATE NOCASE
  `).all();
  const byId = new Map(rows.map((row) => [row.id, { ...row, children: [] }]));
  const roots = [];
  for (const category of byId.values()) {
    const parent = category.parentId === null ? null : byId.get(category.parentId);
    if (parent) parent.children.push(category);
    else if (category.parentId === null) roots.push(category);
  }
  function addPaths(categories, parentPath = [], parentLabels = []) {
    for (const category of categories) {
      category.path = [...parentPath, category.slug];
      category.pathLabel = [...parentLabels, category.name].join(" / ");
      addPaths(category.children, category.path, [...parentLabels, category.name]);
    }
  }
  addPaths(roots);
  return roots;
}

function flattenCategories(categories, parentPath = []) {
  return categories.flatMap((category) => {
    const path = [...parentPath, category.slug];
    return [{ ...category, path, pathString: path.join("/") }, ...flattenCategories(category.children, path)];
  });
}

function makeCategorySlug(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function categoryById(categoryId) {
  return database.prepare(`
    SELECT id, name, slug, parent_id AS parentId, description, image_url AS imageUrl,
      active, display_order AS displayOrder
    FROM categories WHERE id = ?
  `).get(categoryId);
}

function categoryForProduct(categoryId, legacyName) {
  if (categoryId !== undefined && categoryId !== null && categoryId !== "") {
    const id = Number(categoryId);
    if (!Number.isSafeInteger(id) || id < 1) return { error: "Choose a valid product category." };
    const selected = categoryById(id);
    const activePathCategory = flattenCategories(readCategories()).find((category) => category.id === id);
    if (!selected || !activePathCategory) return { error: "Choose an active product category." };
    if (activePathCategory.children.some((category) => category.active)) {
      return { error: "Choose the most specific active category for this product." };
    }
    return { categoryId: selected.id, category: selected.name };
  }
  const legacyMappings = { Home: "home-decor", Accessories: "fashion-accessories", Stationery: "notebooks-diaries", Bath: "bath-body" };
  const candidate = typeof legacyName === "string" ? legacyName.trim() : "";
  if (!candidate || candidate.length > 80) return { error: "Choose a product category." };
  const mappedSlug = legacyMappings[candidate];
  const selected = mappedSlug
    ? database.prepare("SELECT id, name FROM categories WHERE slug = ? AND active = 1").get(mappedSlug)
    : database.prepare("SELECT id, name FROM categories WHERE name = ? COLLATE NOCASE AND active = 1 LIMIT 1").get(candidate);
  if (!selected) return { error: "Choose a category from the active category list." };
  if (!flattenCategories(readCategories()).some((category) => category.id === selected.id)) {
    return { error: "Choose a category from the active category list." };
  }
  if (database.prepare("SELECT 1 FROM categories WHERE parent_id = ? AND active = 1 LIMIT 1").get(selected.id)) {
    return { error: "Choose the most specific active category for this product." };
  }
  return { categoryId: selected.id, category: selected.name };
}

function additionalProductImages(productId) {
  return database.prepare(`
    SELECT image_url AS imageUrl, model_profile AS modelProfile, view_label AS viewLabel
    FROM product_images
    WHERE product_id = ? ORDER BY display_order, id
  `).all(productId);
}

function saveAdditionalProductImages(productId, images) {
  database.transaction(() => {
    database.prepare("DELETE FROM product_images WHERE product_id = ?").run(productId);
    const insert = database.prepare(`
      INSERT INTO product_images (product_id, image_url, model_profile, view_label, display_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    images.forEach((image, index) => insert.run(productId, image.imageUrl, image.modelProfile, image.viewLabel, index));
  });
}























function validateOrderInput(body) {
  const shippingName = typeof body.shippingName === "string" ? body.shippingName.trim() : "";
  const shippingAddress = typeof body.shippingAddress === "string" ? body.shippingAddress.trim() : "";
  const couponCode = typeof body.couponCode === "string" ? body.couponCode.trim().toUpperCase() : "";
  const items = body.items;
  if (shippingName.length < 2 || shippingName.length > 100) return { error: "Enter a valid name for delivery." };
  if (shippingAddress.length < 8 || shippingAddress.length > 300) return { error: "Enter a delivery address between 8 and 300 characters." };
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) return { error: "Your cart is empty or contains too many items." };

  const quantities = new Map();
  for (const item of items) {
    const id = Number(item?.productId);
    const quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
      return { error: "Your cart contains an invalid quantity." };
    }
    quantities.set(id, (quantities.get(id) || 0) + quantity);
  }
  if ([...quantities.values()].some((quantity) => quantity > 20)) {
    return { error: "You can order at most 20 of each product." };
  }
  return { shippingName, shippingAddress, quantities, couponCode };
}

function handleOrderError(error, response) {
  if (error.message.includes("not have enough stock") || error.message.includes("no longer available")) {
    response.status(409).json({ error: error.message });
    return true;
  }
  if (error.message === "The order amount is invalid.") {
    response.status(400).json({ error: error.message });
    return true;
  }
  if (error.message.startsWith("Your cart total changed")) {
    response.status(409).json({ error: error.message });
    return true;
  }
  if (error.message.startsWith("Coupon code") || error.message.startsWith("That coupon") || error.message.startsWith("Your cart must total")) {
    response.status(400).json({ error: error.message });
    return true;
  }
  return false;
}


function readAdminProduct(body, currentProductId = 0) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Provide product details." };
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sku = typeof body.sku === "string" ? body.sku.trim().toUpperCase() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
  const rawAdditionalImages = body.productImages === undefined
    ? body.additionalImageUrls === undefined ? [] : body.additionalImageUrls
    : body.productImages;
  const pricePaise = Number(body.pricePaise);
  const stock = Number(body.stock);
  let parsedImage;
  try {
    parsedImage = new URL(imageUrl);
  } catch {
    return { error: "Enter a valid HTTPS image URL." };
  }

  if (name.length < 2 || name.length > 120) return { error: "Product name must be between 2 and 120 characters." };
  if (sku && !/^[A-Z0-9_-]{2,40}$/.test(sku)) return { error: "SKU must be 2–40 letters, numbers, dashes, or underscores." };
  if (sku && database.prepare("SELECT 1 FROM products WHERE sku = ? AND id != ?").get(sku, currentProductId)) {
    return { error: "That SKU/barcode is already assigned to another product." };
  }
  if (description.length < 10 || description.length > 2000) return { error: "Description must be between 10 and 2,000 characters." };
  if (!Number.isSafeInteger(pricePaise) || pricePaise < 1 || pricePaise > 100000000) return { error: "Price must be a positive rupee amount." };
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000) return { error: "Stock must be a whole number from 0 to 1,000,000." };
  if (parsedImage.protocol !== "https:" || imageUrl.length > 500) return { error: "Enter a valid HTTPS image URL under 500 characters." };
  const imageValues = Array.isArray(rawAdditionalImages)
    ? rawAdditionalImages
    : typeof rawAdditionalImages === "string" ? rawAdditionalImages.split(/\r?\n/) : null;
  if (!imageValues || imageValues.length > 8) return { error: "Add up to 8 additional product images." };
  const supportedProfiles = new Set([
    "general", "male-slim", "male-average", "male-athletic", "male-plus",
    "female-petite", "female-average", "female-curvy", "female-plus",
    "kids-2-4", "kids-5-8", "kids-9-12", "kids-13-16"
  ]);
  const productImages = [];
  for (const value of imageValues) {
    let rawUrl = value;
    let modelProfile = "general";
    let viewLabel = "Other view";
    if (typeof value === "string") {
      const parts = value.trim().split("|").map((part) => part.trim());
      if (parts.length === 3) {
        [modelProfile, viewLabel, rawUrl] = parts;
      } else if (parts.length !== 1) {
        return { error: "Use one image URL per line, or profile|view angle|HTTPS image URL." };
      } else {
        rawUrl = parts[0];
      }
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      rawUrl = value.imageUrl;
      modelProfile = typeof value.modelProfile === "string" ? value.modelProfile : "general";
      viewLabel = typeof value.viewLabel === "string" ? value.viewLabel.trim() : "Other view";
    } else {
      return { error: "Each product image must include an HTTPS URL." };
    }
    const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
    if (!url) continue;
    if (!supportedProfiles.has(modelProfile)) return { error: "Choose a valid model preview profile for each image." };
    if (viewLabel.length < 2 || viewLabel.length > 40) return { error: "Image view label must be 2–40 characters." };
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { error: "Each additional product image must be a valid HTTPS URL." };
    }
    if (parsed.protocol !== "https:" || url.length > 500) return { error: "Each additional product image must be a valid HTTPS URL under 500 characters." };
    if (!productImages.some((image) => image.imageUrl === url) && url !== imageUrl) {
      productImages.push({ imageUrl: url, modelProfile, viewLabel });
    }
  }

  const category = categoryForProduct(body.categoryId, body.category);
  if (category.error) return { error: category.error };
  return {
    product: {
      name,
      sku: sku || null,
      category: category.category,
      categoryId: category.categoryId,
      description,
      imageUrl,
      productImages,
      additionalImageUrls: productImages.map((image) => image.imageUrl),
      pricePaise,
      stock,
      featured: body.featured === true ? 1 : 0
    }
  };
}

function adminProductQuery() {
  return `
    SELECT products.id, products.name, products.sku, products.category, products.category_id AS categoryId,
      categories.name AS categoryName, categories.slug AS categorySlug, categories.active AS categoryActive,
      products.description, products.price_paise AS pricePaise, products.image_url AS imageUrl,
      products.stock, products.featured, products.seller_id AS sellerId
    FROM products LEFT JOIN categories ON categories.id = products.category_id
  `;
}

module.exports = {
  publicUser,
  readCategories,
  flattenCategories,
  makeCategorySlug,
  categoryById,
  categoryForProduct,
  additionalProductImages,
  saveAdditionalProductImages,
  validateOrderInput,
  handleOrderError,
  readAdminProduct,
  adminProductQuery
};

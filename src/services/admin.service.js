const repository = require("../repositories/admin.repository");
const { makeCategorySlug } = require("./marketplace.shared");

function validateCategory(body, existing = null, id = null) {
  const name = body.name === undefined && existing
    ? existing.name
    : typeof body.name === "string" ? body.name.trim() : "";
  const description = body.description === undefined && existing
    ? existing.description
    : typeof body.description === "string" ? body.description.trim() : "";
  const imageUrl = body.imageUrl === undefined && existing
    ? existing.imageUrl
    : typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
  const slugInput = body.slug === undefined && existing
    ? existing.slug
    : typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : name;
  const slug = makeCategorySlug(slugInput);
  const parentId = body.parentId === undefined && existing
    ? existing.parentId
    : body.parentId === null || body.parentId === "" || body.parentId === undefined
      ? null : Number(body.parentId);
  const active = existing
    ? body.active === undefined ? existing.active : body.active === true ? 1 : body.active === false ? 0 : null
    : 1;
  const displayOrder = body.displayOrder === undefined
    ? existing ? existing.displayOrder : 0
    : Number(body.displayOrder);

  if (name.length < 2 || name.length > 80) {
    return { error: existing ? "Provide a valid category name, slug, and description." : "Category name must be 2 to 80 characters.", status: 400 };
  }
  if (!slug || slug.length > 80) {
    return { error: existing ? "Provide a valid category name, slug, and description." : "Enter a valid category URL slug.", status: 400 };
  }
  if (description.length > 500) {
    return { error: existing ? "Provide a valid category name, slug, and description." : "Category description must be 500 characters or fewer.", status: 400 };
  }
  if (active === null) return { error: "Category active must be true or false.", status: 400 };
  if (imageUrl) {
    try {
      if (new URL(imageUrl).protocol !== "https:" || imageUrl.length > 500) throw new Error("invalid image URL");
    } catch {
      return { error: "Category image URL must use HTTPS and be under 500 characters.", status: 400 };
    }
  }
  if (parentId !== null && (!Number.isSafeInteger(parentId) || !repository.hasActiveCategoryParent(parentId))) {
    return { error: "Choose an active parent category.", status: 400 };
  }
  if (!Number.isSafeInteger(displayOrder) || displayOrder < 0 || displayOrder > 100000) {
    return { error: "Display order must be a whole number between 0 and 100,000.", status: 400 };
  }
  if (id !== null && (parentId === id || (parentId !== null && repository.isCategoryDescendant(id, parentId)))) {
    return { error: "A category cannot be its own ancestor.", status: 400 };
  }
  if (repository.categorySlugExists(slug, id)) {
    return { error: "That category URL slug is already in use.", status: 409 };
  }
  return { category: { name, slug, parentId, description, imageUrl, active, displayOrder } };
}

function createCategory(body) {
  return validateCategory(body);
}

function updateCategory(id, body) {
  const existing = repository.findCategory(id);
  if (!existing) return { error: "Category not found.", status: 404 };
  return validateCategory(body, existing, id);
}

module.exports = { createCategory, updateCategory };

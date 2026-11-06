const { getAdminRepository } = require("../repositories/admin-repository-store");
const adminRepository = getAdminRepository();
const adminService = require("../services/admin.service");

function createAdminController() {
  return {
    async getOverview(request, response, next) {
      try { response.json(await adminRepository.getOverview()); } catch (error) { next(error); }
    },
    async createCategory(request, response, next) {
      const input = await adminService.createCategory(request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      try {
        response.status(201).json(await adminRepository.createCategory(input.category));
      } catch (error) {
        if (error.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed: categories\.slug/.test(error.message)) {
          return response.status(409).json({ error: "That category URL slug is already in use." });
        }
        throw error;
      }
    },
    async updateCategory(request, response, next) {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid category ID." });
      const input = await adminService.updateCategory(id, request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      try {
        response.json(await adminRepository.updateCategory(id, input.category));
      } catch (error) {
        if (error.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed: categories\.slug/.test(error.message)) {
          return response.status(409).json({ error: "That category URL slug is already in use." });
        }
        throw error;
      }
    },
    async deleteCategory(request, response, next) {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid category ID." });
      if (!await adminRepository.findCategory(id)) return response.status(404).json({ error: "Category not found." });
      const result = await adminRepository.deleteCategory(id);
      if (!result.deleted) {
        return response.status(409).json({
          error: `Category cannot be deleted while it has ${result.childCount ? "subcategories" : ""}${result.childCount && result.productCount ? " or " : ""}${result.productCount ? "products" : ""}. Reassign products or deactivate the category instead.`
        });
      }
      response.status(204).end();
    },
    async createProduct(request, response, next) {
      const input = await adminService.readProduct(request.body);
      if (input.error) return response.status(400).json({ error: input.error });
      const product = await adminRepository.createProduct(input.product);
      if (!product) return response.status(503).json({ error: "Platform seller is not configured." });
      response.status(201).json(product);
    },
    async updateProduct(request, response, next) {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid product ID." });
      const input = await adminService.readProduct(request.body, id);
      if (input.error) return response.status(400).json({ error: input.error });
      const updated = await adminRepository.updateProduct(id, input.product);
      if (!updated) return response.status(404).json({ error: "Product not found." });
      response.json(updated);
    },
    async deleteProduct(request, response, next) {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid product ID." });
      const result = await adminRepository.deleteProduct(id);
      if (result === "not_found") return response.status(404).json({ error: "Product not found." });
      if (result === "has_orders") return response.status(409).json({ error: "This product is part of an order and cannot be deleted. Set its stock to zero instead." });
      response.status(204).end();
    },
    async updateSeller(request, response, next) {
      const input = await adminService.updateSeller(Number(request.params.id), request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      response.json(input.result);
    },
    async updateCommission(request, response, next) {
      const input = await adminService.updateCommission(request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      response.json(input.result);
    },
    async createPayout(request, response, next) {
      const input = await adminService.createPayout(Number(request.params.id), request.body, request.session.user.id);
      if (input.error) return response.status(input.status).json({ error: input.error });
      response.status(201).json(input.result);
    },
    async createCoupon(request, response, next) {
      const input = adminService.createCoupon(request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      try {
        response.status(201).json(await adminRepository.createCoupon(input.coupon));
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return response.status(409).json({ error: "A coupon with this code already exists." });
        throw error;
      }
    },
    async listCoupons(request, response, next) {
      response.json(await adminRepository.listCoupons());
    },
    async updateCoupon(request, response, next) {
      const input = await adminService.updateCoupon(Number(request.params.id), request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      response.json(input.result);
    },
    async updateReturn(request, response, next) {
      const input = await adminService.updateReturn(Number(request.params.id), request.body, request.session.user.id);
      if (input.error) return response.status(input.status).json({ error: input.error });
      response.json(input.result);
    },
    async updateOrder(request, response, next) {
      const input = await adminService.updateOrder(Number(request.params.id), request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      response.json(input.result);
    }
  };
}

module.exports = createAdminController;

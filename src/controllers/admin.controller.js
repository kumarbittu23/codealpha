const adminRepository = require("../repositories/admin.repository");
const adminService = require("../services/admin.service");

function createAdminController() {
  return {
    getOverview(request, response) {
      response.json(adminRepository.getOverview());
    },
    createCategory(request, response) {
      const input = adminService.createCategory(request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      try {
        response.status(201).json(adminRepository.createCategory(input.category));
      } catch (error) {
        if (error.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed: categories\.slug/.test(error.message)) {
          return response.status(409).json({ error: "That category URL slug is already in use." });
        }
        throw error;
      }
    },
    updateCategory(request, response) {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid category ID." });
      const input = adminService.updateCategory(id, request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      try {
        response.json(adminRepository.updateCategory(id, input.category));
      } catch (error) {
        if (error.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed: categories\.slug/.test(error.message)) {
          return response.status(409).json({ error: "That category URL slug is already in use." });
        }
        throw error;
      }
    },
    deleteCategory(request, response) {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid category ID." });
      if (!adminRepository.findCategory(id)) return response.status(404).json({ error: "Category not found." });
      const result = adminRepository.deleteCategory(id);
      if (!result.deleted) {
        return response.status(409).json({
          error: `Category cannot be deleted while it has ${result.childCount ? "subcategories" : ""}${result.childCount && result.productCount ? " or " : ""}${result.productCount ? "products" : ""}. Reassign products or deactivate the category instead.`
        });
      }
      response.status(204).end();
    },
    createProduct(request, response) {
      const input = adminService.readProduct(request.body);
      if (input.error) return response.status(400).json({ error: input.error });
      const product = adminRepository.createProduct(input.product);
      if (!product) return response.status(503).json({ error: "Platform seller is not configured." });
      response.status(201).json(product);
    },
    updateProduct(request, response) {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid product ID." });
      const input = adminService.readProduct(request.body, id);
      if (input.error) return response.status(400).json({ error: input.error });
      const updated = adminRepository.updateProduct(id, input.product);
      if (!updated) return response.status(404).json({ error: "Product not found." });
      response.json(updated);
    },
    deleteProduct(request, response) {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid product ID." });
      const result = adminRepository.deleteProduct(id);
      if (result === "not_found") return response.status(404).json({ error: "Product not found." });
      if (result === "has_orders") return response.status(409).json({ error: "This product is part of an order and cannot be deleted. Set its stock to zero instead." });
      response.status(204).end();
    },
    updateSeller(request, response) {
      const input = adminService.updateSeller(Number(request.params.id), request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      response.json(input.result);
    },
    updateCommission(request, response) {
      const input = adminService.updateCommission(request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      response.json(input.result);
    },
    createPayout(request, response) {
      const input = adminService.createPayout(Number(request.params.id), request.body, request.session.user.id);
      if (input.error) return response.status(input.status).json({ error: input.error });
      response.status(201).json(input.result);
    },
    createCoupon(request, response) {
      const input = adminService.createCoupon(request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      try {
        response.status(201).json(adminRepository.createCoupon(input.coupon));
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return response.status(409).json({ error: "A coupon with this code already exists." });
        throw error;
      }
    },
    listCoupons(request, response) {
      response.json(adminRepository.listCoupons());
    },
    updateCoupon(request, response) {
      const input = adminService.updateCoupon(Number(request.params.id), request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      response.json(input.result);
    },
    updateReturn(request, response) {
      const input = adminService.updateReturn(Number(request.params.id), request.body, request.session.user.id);
      if (input.error) return response.status(input.status).json({ error: input.error });
      response.json(input.result);
    },
    updateOrder(request, response) {
      const input = adminService.updateOrder(Number(request.params.id), request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      response.json(input.result);
    }
  };
}

module.exports = createAdminController;

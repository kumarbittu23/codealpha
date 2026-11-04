const bcrypt = require("bcryptjs");
const { getAccountRepository } = require("../repositories/account-repository-store");
const accountService = require("../services/account.service");
const { publicUser } = require("../services/marketplace.shared");

function createAccountController() {
  return {
    async listOrders(request, response, next) {
      try {
        response.json(await getAccountRepository().listOrders(request.session.user.id));
      } catch (error) { next(error); }
    },
    updateProfile: async (request, response, next) => {
      const result = accountService.validateProfile(request.body);
      if (result.error) return response.status(400).json({ error: result.error });
      const { name, email, currentPassword, newPassword } = result.value;
      const userId = request.session.user.id;
      const accountRepository = getAccountRepository();
      const storedUser = await accountRepository.findPasswordHash(userId);
      if (newPassword || email !== request.session.user.email) {
        if (!currentPassword || !storedUser || !await bcrypt.compare(currentPassword, storedUser.password_hash)) {
          return response.status(403).json({ error: "Enter your current password to change your email or password." });
        }
      }
      try {
        const passwordHash = newPassword ? await bcrypt.hash(newPassword, 12) : storedUser.password_hash;
        await accountRepository.updateProfile(userId, { name, email, passwordHash });
        request.session.user.name = name;
        request.session.user.email = email;
        response.json({ user: publicUser(request.session.user) });
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.code === "23505") {
          return response.status(409).json({ error: "That email address is already used by another account." });
        }
        next(error);
      }
    },
    async getRewards(request, response, next) {
      try {
      const totals = await getAccountRepository().getRewardTotals(request.session.user.id);
      response.json({
        points: Math.floor(totals.deliveredTotalPaise / 10000),
        deliveredOrderCount: totals.deliveredOrderCount,
        walletBalancePaise: 0,
        walletEnabled: false,
        pointsPerHundredRupees: 1
      });
      } catch (error) { next(error); }
    },
    async listAddresses(request, response, next) {
      try { response.json(await getAccountRepository().listAddresses(request.session.user.id)); }
      catch (error) { next(error); }
    },
    async createAddress(request, response, next) {
      const result = accountService.validateAddress(request.body);
      if (result.error) return response.status(400).json({ error: result.error });
      const userId = request.session.user.id;
      try {
      const repository = getAccountRepository();
      const isDefault = request.body.isDefault === true || (await repository.listAddresses(userId)).length === 0;
      response.status(201).json(await repository.createAddress(userId, result.value, isDefault));
      } catch (error) { next(error); }
    },
    async deleteAddress(request, response, next) {
      const id = Number(request.params.id);
      try {
        const repository = getAccountRepository();
        if (!(await repository.deleteAddress(request.session.user.id, id))) {
          return response.status(404).json({ error: "Address not found." });
        }
        response.status(204).end();
      } catch (error) { next(error); }
    },
    async listWishlist(request, response, next) {
      try { response.json(await getAccountRepository().listWishlist(request.session.user.id)); }
      catch (error) { next(error); }
    },
    async addWishlistItem(request, response, next) {
      const productId = Number(request.params.productId);
      try {
        const repository = getAccountRepository();
        if (!(await repository.isWishlistProductAvailable(productId))) {
          return response.status(404).json({ error: "Product not found." });
        }
        await repository.addToWishlist(request.session.user.id, productId);
        response.status(201).json({ success: true });
      } catch (error) { next(error); }
    },
    async removeWishlistItem(request, response, next) {
      try {
        await getAccountRepository().removeFromWishlist(request.session.user.id, Number(request.params.productId));
        response.status(204).end();
      } catch (error) { next(error); }
    }
  };
}

module.exports = createAccountController;
